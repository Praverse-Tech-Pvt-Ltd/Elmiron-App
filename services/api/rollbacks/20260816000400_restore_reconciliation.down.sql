-- Rollback for 20260816000400_restore_reconciliation.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- Removes the post-restore reconciliation and the quarantine that goes with it.
--
-- READ THIS BEFORE RUNNING IT. Dropping `visit_audio_quarantine` releases every
-- quarantined visit at once, and a quarantined visit is one whose consent state
-- could not be trusted after a restore. Rolling this back is therefore a decision to
-- resume recording those doctors without the question having been answered. Read
-- `restore_reconciliation_findings` first — it is dropped here too, so anything
-- worth keeping has to come out before this runs.
--
-- `begin_upload` is restored to its 20260816000300 body, without the quarantine
-- check. That migration is still applied at this point in the reverse order and
-- drops the function itself a step later.

drop function if exists public.clear_audio_quarantine(uuid, text);
drop function if exists public.finish_restore_reconciliation(uuid, integer, integer);
drop function if exists public.reconcile_object_without_row(uuid, text);
drop function if exists public.reconcile_row_without_object(uuid, text, uuid);
drop function if exists public.begin_restore_reconciliation(uuid, text);

-- The 20260816000300 body: no quarantine check.
create or replace function public.begin_upload(
  p_visit_id         uuid,
  p_kind             text,
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
  c_slide        constant interval := interval '15 minutes';
  c_hard         constant interval := interval '24 hours';
  v_uid      uuid;
  v_visit    public.visits%rowtype;
  v_consent  public.consent_records%rowtype;
  v_existing public.upload_grants%rowtype;
  v_usage    jsonb;
  v_ceiling  numeric;
  v_row      public.upload_grants%rowtype;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_kind not in ('recording', 'voice_note') then
    raise exception 'unknown upload kind %', p_kind using errcode = '22023';
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

  if p_kind = 'recording' then
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
  end if;

  select * into v_existing
    from public.upload_grants g
   where g.visit_id = p_visit_id and g.kind = p_kind and g.state = 'open'
   for update;

  if found then
    if v_existing.mr_id <> v_uid then
      raise exception 'an upload for visit % belongs to another user', p_visit_id
        using errcode = '42501';
    end if;

    if v_existing.hard_expires_at <= now() then
      update public.upload_grants
         set state = 'abandoned', closed_at = clock_timestamp(),
             closed_reason = 'hard expiry passed before the upload finished'
       where id = v_existing.id;
      raise exception 'the upload grant for visit % expired at %',
        p_visit_id, v_existing.hard_expires_at using errcode = '22023';
    end if;

    update public.upload_grants
       set expires_at = least(now() + c_slide, hard_expires_at)
     where id = v_existing.id
    returning * into v_row;
    return v_row;
  end if;

  if public.audio_purge_is_stalled() then
    raise exception 'the audio retention worker has stopped; no new upload will be accepted'
      using errcode = '22023',
            hint = 'Objects are past their purge date. Run the retention worker before capturing more.';
  end if;

  v_usage   := public.audio_storage_bytes(v_uid);
  v_ceiling := public.threshold_number('audio_storage_ceiling_bytes', null, 4294967296);

  if ((v_usage ->> 'liveBytes')::numeric
      + (v_usage ->> 'reservedBytes')::numeric
      + p_size_bytes) > v_ceiling then
    raise exception 'this upload would put you over the audio storage ceiling of % bytes', v_ceiling
      using errcode = '22023',
            hint = 'Live recordings and in-flight uploads both count. Finish or abandon what is queued.';
  end if;

  insert into public.upload_grants
    (visit_id, mr_id, kind, storage_key, max_bytes, max_duration_seconds,
     expires_at, hard_expires_at)
  values
    (p_visit_id, v_uid, p_kind,
     case when p_kind = 'recording' then 'recordings/' else 'voice-notes/' end
       || gen_random_uuid()::text || '/' || gen_random_uuid()::text || '.opus',
     p_size_bytes, p_duration_seconds, now() + c_slide, now() + c_hard)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.begin_upload(uuid, text, bigint, integer) to authenticated;

drop function if exists public.visit_is_quarantined(uuid);

-- Clearances before the quarantine table, findings before the runs: the foreign
-- keys are `on delete restrict` on purpose, so this order is the schema telling us
-- what depends on what.
drop trigger if exists visit_audio_quarantine_clearances_reject_mutation on public.visit_audio_quarantine_clearances;
drop trigger if exists visit_audio_quarantine_clearances_audit           on public.visit_audio_quarantine_clearances;
drop trigger if exists visit_audio_quarantine_clearances_stamp_received_at on public.visit_audio_quarantine_clearances;
drop table if exists public.visit_audio_quarantine_clearances;

drop table if exists public.visit_audio_quarantine;

drop trigger if exists restore_findings_reject_mutation on public.restore_reconciliation_findings;
drop table if exists public.restore_reconciliation_findings;
drop table if exists public.restore_reconciliation_runs;

drop type if exists public.restore_finding_resolution;
drop type if exists public.restore_finding_kind;
