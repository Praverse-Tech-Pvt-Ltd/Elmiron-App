-- Rollback for 20260816000300_resumable_upload.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- Restores the BE-W6 upload path: a single-use, fifteen-minute grant, one object per
-- grant, no resume, no chunks, and no partial-upload cleanup.
--
-- Restated in full below, because Postgres has no way to patch part of a function
-- body: issue_recording_upload_grant, cascade_consent_withdrawal,
-- claim_expired_audio, confirm_audio_destroyed, audio_purge_health,
-- sync_rejection_explanation (BE-W5), apply_sync_item (BE-W4) and sync_push (BE-W5).
--
-- WHAT THIS ROLLBACK CANNOT UNDO. Any object written by a resumable upload stays in
-- the bucket, and any grant row that was mid-flight loses the columns describing how
-- far it got. Empty the `audio` bucket through the storage API before rolling this
-- back if the intention is a clean state — a row delete does not delete an object,
-- which is the whole reason the purge worker exists.

-- Functions first: several take or return the upload_grants composite type, and the
-- columns below are part of it.
drop function if exists public.my_upload_queue(uuid);
drop function if exists public.begin_upload(uuid, text, bigint, integer);
drop function if exists public.resume_upload(uuid);
drop function if exists public.record_upload_progress(uuid, bigint);
drop function if exists public.complete_upload(uuid, uuid, integer, bigint, timestamptz, integer);
drop function if exists public.abandon_upload(uuid, text);
drop function if exists public.assert_upload_still_permitted(public.upload_grants);
drop function if exists public.close_stale_upload_sessions();
drop function if exists public.audio_purge_is_stalled();
drop function if exists public.audio_storage_bytes(uuid);

-- The BE-W6 grant: issued fresh every time, consumed on first write.
drop function if exists public.issue_recording_upload_grant(uuid, bigint, integer);

create or replace function public.issue_recording_upload_grant(
  p_visit_id         uuid,
  p_size_bytes       bigint,
  p_duration_seconds integer
)
returns public.upload_grants
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_max_bytes    constant bigint  := 25 * 1024 * 1024;
  c_max_seconds  constant integer := 2 * 60 * 60;
  v_uid     uuid;
  v_visit   public.visits%rowtype;
  v_consent public.consent_records%rowtype;
  v_row     public.upload_grants%rowtype;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > c_max_bytes then
    raise exception 'size must be between 1 and % bytes', c_max_bytes using errcode = '22023';
  end if;
  if p_duration_seconds is null or p_duration_seconds <= 0 or p_duration_seconds > c_max_seconds then
    raise exception 'duration must be between 1 and % seconds', c_max_seconds using errcode = '22023';
  end if;

  select * into v_visit from public.visits v where v.id = p_visit_id and v.mr_id = v_uid;
  if not found then
    raise exception 'visit % is not yours', p_visit_id using errcode = '42501';
  end if;

  select * into v_consent
    from public.consent_records c
   where c.visit_id = p_visit_id
     and c.outcome = 'consented'
     and c.is_withdrawal = false
     and not exists (select 1 from public.consent_records w
                      where w.supersedes_consent_record_id = c.id)
   order by c.captured_at desc
   limit 1;

  if v_consent.id is null then
    raise exception 'visit % has no standing consent; there is no upload path', p_visit_id
      using errcode = '42501',
            hint = 'A declined or withdrawn visit has no recording endpoint at all.';
  end if;

  insert into public.upload_grants
    (visit_id, mr_id, kind, storage_key, max_bytes, max_duration_seconds, expires_at)
  values
    (p_visit_id, v_uid, 'recording',
     'recordings/' || gen_random_uuid()::text || '/' || gen_random_uuid()::text || '.opus',
     p_size_bytes, p_duration_seconds, now() + interval '15 minutes')
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.issue_recording_upload_grant(uuid, bigint, integer) to authenticated;

-- The storage policies: INSERT only, and a blanket read refusal. No UPDATE policy,
-- so no second chunk — which is what made resumable upload impossible before BE-W7.
drop policy if exists audio_select_live_upload_only   on storage.objects;
drop policy if exists audio_update_requires_live_grant on storage.objects;
drop policy if exists audio_insert_requires_live_grant on storage.objects;

create policy audio_insert_requires_live_grant
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'audio'
    and exists (
      select 1 from public.upload_grants g
       where g.storage_key = storage.objects.name
         and g.mr_id = (select auth.uid())
         and g.consumed_at is null
         and g.expires_at > now()
    )
  );

create policy audio_no_public_read
  on storage.objects for select to authenticated
  using (false);

drop function if exists public.has_live_upload_grant(text);

-- The columns, and everything constraining them.
drop index if exists public.upload_grants_one_open_per_visit_kind;
drop index if exists public.upload_grants_purgeable_idx;

alter table public.upload_grants
  drop constraint if exists upload_grants_hard_expiry_after_issue,
  drop constraint if exists upload_grants_sliding_within_hard,
  drop constraint if exists upload_grants_closed_has_state,
  drop constraint if exists upload_grants_completed_is_consumed,
  drop constraint if exists upload_grants_destroyed_has_timestamp;

alter table public.upload_grants
  drop column if exists state,
  drop column if exists bytes_received,
  drop column if exists chunk_count,
  drop column if exists last_progress_at,
  drop column if exists hard_expires_at,
  drop column if exists closed_at,
  drop column if exists closed_reason,
  drop column if exists purge_state,
  drop column if exists claimed_at,
  drop column if exists claimed_by_run_id,
  drop column if exists destroyed_at;

drop type if exists public.upload_session_state;

-- The destruction log stops accepting partials.
--
-- NOT VALID, and that is not a shortcut. `audio_destruction_log` is append-only, so
-- any `upload_partial` row already in it is a permanent record of an object that was
-- really destroyed. A validating constraint would refuse to apply against that
-- history, and the only ways to make it apply are to rewrite or delete the rows —
-- which is precisely what the append-only trigger exists to prevent.
--
-- So the constraint binds new rows and leaves the record of what happened intact.
-- Found by verify:rollbacks, which is the entire reason rollback files get executed
-- rather than merely written.
alter table public.audio_destruction_log
  drop constraint if exists audio_destruction_log_object_kind_check;

alter table public.audio_destruction_log
  add constraint audio_destruction_log_object_kind_check
    check (object_kind in ('recording', 'voice_note')) not valid;

-- The BE-W6 cascade, with no grant revocation.
create or replace function public.cascade_consent_withdrawal()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_recording public.recordings%rowtype;
  v_raw_count integer := 0;
  v_red_count integer := 0;
  v_ana_count integer := 0;
begin
  if not new.is_withdrawal or new.supersedes_consent_record_id is null then
    return new;
  end if;

  for v_recording in
    select * from public.recordings r
     where r.consent_record_id = new.supersedes_consent_record_id
       and r.purge_state <> 'destroyed'
  loop
    with removed as (
      delete from public.transcripts_redacted t
       where t.raw_transcript_id in (
         select r.id from public.transcripts_raw r where r.recording_id = v_recording.id)
      returning 1)
    select count(*) into v_red_count from removed;

    with removed as (
      delete from public.transcripts_raw t where t.recording_id = v_recording.id returning 1)
    select count(*) into v_raw_count from removed;

    with removed as (
      delete from public.analyses a where a.visit_id = v_recording.visit_id returning 1)
    select count(*) into v_ana_count from removed;

    update public.recordings
       set purge_state = 'claimed',
           destruction_reason = 'withdrawal',
           withdrawn_at = new.captured_at,
           purge_after = clock_timestamp(),
           claimed_at = null,
           claimed_by_run_id = null
     where id = v_recording.id;

    insert into public.audio_destruction_log
      (object_kind, object_id, visit_id, reason, storage_key_hash, derived_rows_destroyed)
    values
      ('recording', v_recording.id, v_recording.visit_id, 'withdrawal',
       case when v_recording.storage_key is null then null
            else public.sha256_hex(v_recording.storage_key) end,
       jsonb_build_object('transcriptsRaw', v_raw_count,
                          'transcriptsRedacted', v_red_count,
                          'analyses', v_ana_count));
  end loop;

  return new;
end;
$$;

-- The BE-W6 claim: recordings and voice notes only.
create or replace function public.claim_expired_audio(p_run_id uuid, p_limit integer default 100)
returns table (object_kind text, object_id uuid, storage_key text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_stale constant interval := interval '15 minutes';
begin
  insert into public.audio_purge_runs (id) values (p_run_id)
  on conflict (id) do nothing;

  return query
  with claimed_recordings as (
    update public.recordings r
       set purge_state = 'claimed',
           destruction_reason = coalesce(r.destruction_reason, 'retention'),
           claimed_at = clock_timestamp(),
           claimed_by_run_id = p_run_id
     where r.id in (
       select r2.id from public.recordings r2
        where r2.purge_state <> 'destroyed'
          and r2.purge_after <= now()
          and (r2.claimed_at is null or r2.claimed_at < now() - c_stale)
        order by r2.purge_after
        limit p_limit
        for update skip locked)
    returning 'recording'::text as kind, r.id, r.storage_key
  ),
  claimed_notes as (
    update public.voice_notes n
       set purge_state = 'claimed',
           claimed_at = clock_timestamp(),
           claimed_by_run_id = p_run_id
     where n.id in (
       select n2.id from public.voice_notes n2
        where n2.purge_state <> 'destroyed'
          and n2.purge_after <= now()
          and (n2.claimed_at is null or n2.claimed_at < now() - c_stale)
        order by n2.purge_after
        limit p_limit
        for update skip locked)
    returning 'voice_note'::text as kind, n.id, n.storage_key
  )
  select * from claimed_recordings
  union all
  select * from claimed_notes;
end;
$$;

create or replace function public.confirm_audio_destroyed(
  p_run_id      uuid,
  p_object_kind text,
  p_object_id   uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_visit  uuid;
  v_reason public.audio_destruction_reason;
  v_hash   text;
  v_raw    integer := 0;
  v_red    integer := 0;
begin
  if p_object_kind = 'recording' then
    select r.visit_id,
           coalesce(r.destruction_reason, 'retention'),
           case when r.storage_key is null then null else public.sha256_hex(r.storage_key) end
      into v_visit, v_reason, v_hash
      from public.recordings r
     where r.id = p_object_id and r.purge_state <> 'destroyed';

    if not found then
      return;
    end if;

    with removed as (
      delete from public.transcripts_redacted t
       where t.raw_transcript_id in (
         select x.id from public.transcripts_raw x where x.recording_id = p_object_id)
      returning 1)
    select count(*) into v_red from removed;

    with removed as (
      delete from public.transcripts_raw t where t.recording_id = p_object_id returning 1)
    select count(*) into v_raw from removed;

    update public.recordings
       set purge_state = 'destroyed',
           destroyed_at = clock_timestamp(),
           storage_key = null,
           upload_status = 'purged'
     where id = p_object_id;

    insert into public.audio_destruction_log
      (run_id, object_kind, object_id, visit_id, reason, storage_key_hash, derived_rows_destroyed)
    values
      (p_run_id, 'recording', p_object_id, v_visit, v_reason, v_hash,
       jsonb_build_object('transcriptsRaw', v_raw, 'transcriptsRedacted', v_red));

  elsif p_object_kind = 'voice_note' then
    select n.visit_id,
           case when n.storage_key is null then null else public.sha256_hex(n.storage_key) end
      into v_visit, v_hash
      from public.voice_notes n
     where n.id = p_object_id and n.purge_state <> 'destroyed';

    if not found then
      return;
    end if;

    with removed as (
      delete from public.transcripts_redacted t
       where t.raw_transcript_id in (
         select x.id from public.transcripts_raw x where x.voice_note_id = p_object_id)
      returning 1)
    select count(*) into v_red from removed;

    with removed as (
      delete from public.transcripts_raw t where t.voice_note_id = p_object_id returning 1)
    select count(*) into v_raw from removed;

    update public.voice_notes
       set purge_state = 'destroyed',
           destroyed_at = clock_timestamp(),
           storage_key = null,
           upload_status = 'purged'
     where id = p_object_id;

    insert into public.audio_destruction_log
      (run_id, object_kind, object_id, visit_id, reason, storage_key_hash, derived_rows_destroyed)
    values
      (p_run_id, 'voice_note', p_object_id, v_visit, 'retention', v_hash,
       jsonb_build_object('transcriptsRaw', v_raw, 'transcriptsRedacted', v_red));
  else
    raise exception 'unknown object kind %', p_object_kind using errcode = '22023';
  end if;

  update public.audio_purge_runs
     set destroyed_count = destroyed_count + 1
   where id = p_run_id;
end;
$$;

create or replace function public.audio_purge_health()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'lastSuccessfulRunAt', (select max(finished_at) from public.audio_purge_runs
                             where finished_at is not null and failed_count = 0),
    'lastRunAt',           (select max(started_at) from public.audio_purge_runs),
    'overdueObjectCount',  (select count(*) from public.recordings
                             where purge_state <> 'destroyed' and purge_after <= now())
                         + (select count(*) from public.voice_notes
                             where purge_state <> 'destroyed' and purge_after <= now()),
    'destroyedTotal',      (select count(*) from public.audio_destruction_log));
$$;

-- The BE-W5 explanation set, without the three upload sentences.
create or replace function public.sync_rejection_explanation(p_code public.sync_rejection_code)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_code
    when 'outside_shift_window' then
      'This was captured outside the working hours configured for the territory. '
      'If the hours are wrong, that is a configuration fix, not a re-do.'
    when 'outside_geofence' then
      'The recorded position was outside the clinic''s geofence.'
    when 'not_your_record' then
      'This refers to a visit or record belonging to someone else.'
    when 'missing_reference' then
      'Something this refers to — a visit, a doctor, a consent version — is not on the server.'
    when 'validation_failed' then
      'The server refused the contents of this item.'
    when 'unsupported_entity' then
      'This kind of item is not accepted by sync yet.'
    when 'malformed_item' then
      'The item was missing its id, entity or entity id.'
    when 'internal_error' then
      'The server failed while applying this item. It is safe to retry.'
    else null
  end;
$$;

-- The BE-W4 body: recording and voice_note refused as unsupported entities.
create or replace function public.apply_sync_item(
  p_entity    public.sync_entity_kind,
  p_entity_id uuid,
  p_payload   jsonb
)
returns text[]
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid      uuid;
  v_warnings text[] := '{}';
  v_beat_plan uuid;
begin
  v_uid := (select auth.uid());

  case p_entity
    when 'visit' then
      v_beat_plan := nullif(p_payload ->> 'beatPlanId', '')::uuid;
      if v_beat_plan is not null and public.beat_plan_is_stale(v_beat_plan) then
        v_warnings := array_append(v_warnings, 'stale_beat_plan');
      end if;

      insert into public.visits (id, mr_id, doctor_id, beat_plan_id, clinic_address_id,
                                 status, scheduled_for, started_at, completed_at)
      values (p_entity_id,
              v_uid,
              (p_payload ->> 'doctorId')::uuid,
              v_beat_plan,
              nullif(p_payload ->> 'clinicAddressId', '')::uuid,
              coalesce(nullif(p_payload ->> 'status', ''), 'planned')::public.visit_status,
              nullif(p_payload ->> 'scheduledFor', '')::timestamptz,
              nullif(p_payload ->> 'startedAt', '')::timestamptz,
              nullif(p_payload ->> 'completedAt', '')::timestamptz)
      on conflict (id) do nothing;

    when 'check_in' then
      perform public.record_check_in(
        p_entity_id,
        (p_payload ->> 'visitId')::uuid,
        (p_payload ->> 'latitude')::double precision,
        (p_payload ->> 'longitude')::double precision,
        (p_payload ->> 'occurredAt')::timestamptz,
        nullif(p_payload ->> 'accuracyMetres', '')::double precision,
        coalesce(nullif(p_payload ->> 'source', ''), 'automatic')::public.capture_source);

    when 'check_out' then
      perform public.record_check_out(
        p_entity_id,
        (p_payload ->> 'visitId')::uuid,
        (p_payload ->> 'latitude')::double precision,
        (p_payload ->> 'longitude')::double precision,
        (p_payload ->> 'occurredAt')::timestamptz,
        nullif(p_payload ->> 'accuracyMetres', '')::double precision,
        coalesce(nullif(p_payload ->> 'source', ''), 'automatic')::public.capture_source);

    when 'call_report' then
      if nullif(p_payload ->> 'supersedesCallReportId', '') is not null then
        perform public.revise_call_report(
          p_entity_id,
          (p_payload ->> 'supersedesCallReportId')::uuid,
          coalesce(p_payload ->> 'summary', ''),
          coalesce((select array_agg(value::text::uuid)
                      from jsonb_array_elements_text(coalesce(p_payload -> 'productIdsDiscussed', '[]'::jsonb)) value),
                   '{}'::uuid[]),
          nullif(p_payload ->> 'objectionsRaised', ''),
          nullif(p_payload ->> 'nextStep', ''),
          coalesce(nullif(p_payload ->> 'status', ''), 'submitted')::public.call_report_status);
      else
        insert into public.call_reports (id, visit_id, mr_id, summary, product_ids_discussed,
                                         objections_raised, next_step, status, draft_source)
        values (p_entity_id,
                (p_payload ->> 'visitId')::uuid,
                v_uid,
                coalesce(p_payload ->> 'summary', ''),
                coalesce((select array_agg(value::text::uuid)
                            from jsonb_array_elements_text(coalesce(p_payload -> 'productIdsDiscussed', '[]'::jsonb)) value),
                         '{}'::uuid[]),
                nullif(p_payload ->> 'objectionsRaised', ''),
                nullif(p_payload ->> 'nextStep', ''),
                coalesce(nullif(p_payload ->> 'status', ''), 'draft')::public.call_report_status,
                coalesce(nullif(p_payload ->> 'draftSource', ''), 'manual')::public.call_report_draft_source)
        on conflict (id) do nothing;
      end if;

    when 'consent_record' then
      insert into public.consent_records (id, visit_id, doctor_id, captured_by_mr_id, outcome,
                                          not_asked_reason, consent_text_version_id,
                                          displayed_language, supersedes_consent_record_id,
                                          is_withdrawal, captured_at)
      values (p_entity_id,
              (p_payload ->> 'visitId')::uuid,
              (p_payload ->> 'doctorId')::uuid,
              v_uid,
              (p_payload ->> 'outcome')::public.consent_outcome,
              nullif(p_payload ->> 'notAskedReason', ''),
              (p_payload ->> 'consentTextVersionId')::uuid,
              p_payload ->> 'displayedLanguage',
              nullif(p_payload ->> 'supersedesConsentRecordId', '')::uuid,
              coalesce((p_payload ->> 'isWithdrawal')::boolean, false),
              (p_payload ->> 'capturedAt')::timestamptz)
      on conflict (id) do nothing;

    when 'sample_and_input' then
      insert into public.samples_and_inputs (id, visit_id, mr_id, doctor_id, kind, item_name,
                                             quantity, declared_value_inr, occurred_at)
      values (p_entity_id,
              (p_payload ->> 'visitId')::uuid,
              v_uid,
              (p_payload ->> 'doctorId')::uuid,
              (p_payload ->> 'kind')::public.sample_or_input_kind,
              p_payload ->> 'itemName',
              (p_payload ->> 'quantity')::integer,
              coalesce((p_payload ->> 'declaredValueInr')::numeric, 0),
              (p_payload ->> 'occurredAt')::timestamptz)
      on conflict (id) do nothing;

    else
      raise exception 'entity % is not yet accepted by sync', p_entity
        using errcode = '0A000';
  end case;

  return v_warnings;
end;
$$;

-- The BE-W5 body: no upload branches in the rejection mapping.
create or replace function public.sync_push(p_batch_id uuid, p_items jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_max_attempts constant integer := 5;
  v_uid       uuid;
  v_item      jsonb;
  v_item_id   uuid;
  v_entity    public.sync_entity_kind;
  v_entity_id uuid;
  v_existing  public.sync_items%rowtype;
  v_attempts  integer;
  v_forgiven  integer;
  v_status    public.sync_item_status;
  v_code      public.sync_rejection_code;
  v_detail    text;
  v_warnings  text[];
  v_results   jsonb := '[]'::jsonb;
  v_sqlstate  text;
  v_message   text;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be a json array' using errcode = '22023';
  end if;

  insert into public.sync_batches (id, mr_id, item_count, submitted_at)
  values (p_batch_id, v_uid, jsonb_array_length(p_items), now())
  on conflict (id) do nothing;

  for v_item in select value from jsonb_array_elements(p_items) value loop
    v_status   := null;
    v_code     := null;
    v_detail   := null;
    v_warnings := '{}';

    begin
      v_item_id   := (v_item ->> 'id')::uuid;
      v_entity    := (v_item ->> 'entity')::public.sync_entity_kind;
      v_entity_id := (v_item ->> 'entityId')::uuid;
      if v_item_id is null or v_entity is null or v_entity_id is null then
        raise exception 'missing id, entity or entityId' using errcode = '22023';
      end if;
    exception when others then
      v_results := v_results || jsonb_build_object(
        'id', v_item ->> 'id',
        'status', 'rejected',
        'rejectionCode', 'malformed_item',
        'rejectionDetail', 'id, entity and entityId are required',
        'warnings', '[]'::jsonb);
      continue;
    end;

    select * into v_existing from public.sync_items s where s.id = v_item_id;

    if found and v_existing.status in ('accepted', 'duplicate') then
      v_results := v_results || jsonb_build_object(
        'id', v_item_id, 'status', 'duplicate',
        'rejectionCode', null, 'rejectionDetail', null,
        'warnings', to_jsonb(v_existing.warnings));
      continue;
    end if;

    if found and v_existing.status = 'dead_lettered' then
      v_results := v_results || jsonb_build_object(
        'id', v_item_id, 'status', 'dead_lettered',
        'rejectionCode', v_existing.rejection_code,
        'rejectionDetail', v_existing.rejection_detail,
        'warnings', to_jsonb(v_existing.warnings));
      continue;
    end if;

    v_attempts := coalesce(v_existing.attempt_count, 0) + 1;
    v_forgiven := coalesce(v_existing.attempts_forgiven, 0);

    if (v_attempts - v_forgiven) > c_max_attempts then
      v_status := 'dead_lettered';
      v_code   := coalesce(v_existing.rejection_code, 'internal_error');
      v_detail := format('gave up after %s attempts: %s', c_max_attempts,
                         coalesce(v_existing.rejection_detail, 'unknown'));
    else
      begin
        v_warnings := public.apply_sync_item(v_entity, v_entity_id, v_item -> 'payload');
        v_status := 'accepted';
      exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
        v_status := 'rejected';
        v_detail := v_message;
        v_code := case
          when v_message ilike '%shift window%'      then 'outside_shift_window'
          when v_sqlstate = '42501'                  then 'not_your_record'
          when v_sqlstate = '0A000'                  then 'unsupported_entity'
          when v_sqlstate in ('23503', '23502')      then 'missing_reference'
          when v_sqlstate in ('23514', '23505', '22023', '22P02') then 'validation_failed'
          else 'internal_error'
        end::public.sync_rejection_code;
      end;
    end if;

    insert into public.sync_items
      (id, batch_id, mr_id, entity, operation, entity_id, payload, status,
       rejection_code, rejection_detail, warnings, attempt_count, attempts_forgiven,
       client_created_at, resolved_at)
    values
      (v_item_id, p_batch_id, v_uid, v_entity,
       coalesce(nullif(v_item ->> 'operation', ''), 'create'),
       v_entity_id, coalesce(v_item -> 'payload', '{}'::jsonb), v_status,
       v_code, v_detail, v_warnings, v_attempts, v_forgiven,
       coalesce((v_item ->> 'clientCreatedAt')::timestamptz, now()),
       case when v_status in ('accepted', 'dead_lettered') then clock_timestamp() end)
    on conflict (id) do update
      set status           = excluded.status,
          batch_id         = excluded.batch_id,
          rejection_code   = excluded.rejection_code,
          rejection_detail = excluded.rejection_detail,
          warnings         = excluded.warnings,
          attempt_count    = excluded.attempt_count,
          resolved_at      = excluded.resolved_at;

    v_results := v_results || jsonb_build_object(
      'id', v_item_id,
      'status', v_status,
      'rejectionCode', v_code,
      'rejectionDetail', v_detail,
      'warnings', to_jsonb(v_warnings));
  end loop;

  return jsonb_build_object(
    'batchId', p_batch_id,
    'results', v_results,
    'serverTime', clock_timestamp());
end;
$$;
