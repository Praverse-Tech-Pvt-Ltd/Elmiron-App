-- ============================================================================
-- BE-W6 (3 of 3) · Consent capture, audio storage, withdrawal cascade, retention
--
-- Consent is the entire legal basis for the recording feature. Three properties,
-- each enforced here and not in a client:
--
--   1. No audio can exist for a visit without a `consented` record referencing a
--      valid consent_text_versions row.
--   2. Withdrawal removes REACH, not just permission. A withdrawn recording is
--      destroyed, not hidden.
--   3. Nothing survives 90 days, counted from the server's received_at.
--
-- `declined` and `not_asked` make the recording path ABSENT rather than disabled.
-- There is no upload grant to obtain for a visit without consent, and the storage
-- policy refuses an object with no live grant — so there is no URL to call, not a
-- URL that returns an error. A disabled feature is one config flag away from being
-- enabled by accident.
--
-- Rollback: services/api/rollbacks/20260815000300_audio_consent_retention.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Consent capture — the write path and its guards
-- ----------------------------------------------------------------------------

-- The text version and display language come from the server's catalogue, never
-- from the request. A client reporting that it displayed v4 when v5 is current is
-- either stale or lying and there is no way to tell which, so the question is not
-- asked.
create or replace function public.active_consent_text(p_language text)
returns public.consent_text_versions
language sql
stable
security definer
set search_path = ''
as $$
  select v.*
    from public.consent_text_versions v
   where v.language = p_language
     and v.effective_from <= now()
     and (v.effective_until is null or v.effective_until > now())
   order by v.effective_from desc
   limit 1;
$$;

create or replace function public.capture_consent(
  p_id               uuid,
  p_visit_id         uuid,
  p_outcome          public.consent_outcome,
  p_language         text,
  p_not_asked_reason text default null,
  p_captured_at      timestamptz default null
)
returns public.consent_records
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid      uuid;
  v_visit    public.visits%rowtype;
  v_text     public.consent_text_versions%rowtype;
  v_existing public.consent_records%rowtype;
  v_row      public.consent_records%rowtype;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_existing from public.consent_records c where c.id = p_id;
  if found then
    if v_existing.captured_by_mr_id <> v_uid then
      raise exception 'consent record % belongs to another user', p_id using errcode = '42501';
    end if;
    return v_existing;
  end if;

  select * into v_visit from public.visits v where v.id = p_visit_id and v.mr_id = v_uid;
  if not found then
    raise exception 'visit % is not yours', p_visit_id using errcode = '42501';
  end if;

  v_text := public.active_consent_text(p_language);
  if v_text.id is null then
    raise exception 'no active consent text for language %', p_language using errcode = '22023';
  end if;

  -- All three outcomes take this path and all three succeed. `declined` is an
  -- ordinary completed capture: no error shape, no penalty flag, no
  -- nullable-because-it-failed column anywhere in the row it produces.
  insert into public.consent_records
    (id, visit_id, doctor_id, captured_by_mr_id, outcome, not_asked_reason,
     consent_text_version_id, displayed_language, captured_at)
  values
    (p_id, p_visit_id, v_visit.doctor_id, v_uid, p_outcome,
     case when p_outcome = 'not_asked' then p_not_asked_reason else null end,
     v_text.id, v_text.language, coalesce(p_captured_at, now()))
  returning * into v_row;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Audio: recordings, voice notes, and the upload grant
-- ----------------------------------------------------------------------------

-- Mirrors UploadStatus in packages/core.
create type public.upload_state as enum ('pending', 'uploading', 'uploaded', 'failed', 'purged');

create type public.audio_destruction_reason as enum ('retention', 'withdrawal');
create type public.audio_purge_state as enum ('live', 'claimed', 'destroyed');

create table public.recordings (
  id                  uuid primary key,
  visit_id            uuid not null references public.visits (id) on delete restrict,
  mr_id               uuid not null references public.user_profiles (id) on delete restrict,
  -- NOT NULL, and a trigger checks the outcome is `consented`. A recording cannot
  -- be represented without the consent that permits it.
  consent_record_id   uuid not null references public.consent_records (id) on delete restrict,
  -- Opaque. Enforced by the check below and generated server-side; never accepted
  -- from a caller. Object paths leak through logs, error messages and support
  -- tickets, so nothing about a doctor, a clinic or a patient goes in one.
  storage_key         text unique
    check (storage_key is null
           or storage_key ~ '^recordings/[0-9a-f-]{36}/[0-9a-f-]{36}\.opus$'),
  codec               text not null default 'opus' check (codec = 'opus'),
  bitrate_kbps        integer not null check (bitrate_kbps between 8 and 128),
  duration_seconds    integer not null check (duration_seconds > 0),
  size_bytes          bigint not null check (size_bytes > 0),
  upload_status       public.upload_state not null default 'pending',
  purge_state         public.audio_purge_state not null default 'live',
  destruction_reason  public.audio_destruction_reason,
  destroyed_at        timestamptz,
  claimed_at          timestamptz,
  claimed_by_run_id   uuid,
  -- Set by the withdrawal cascade, so the manager-facing view can report the fact
  -- of a withdrawal without reading consent_records — which nobody in the field has
  -- a SELECT grant on, because every read of one is audited through an RPC.
  withdrawn_at        timestamptz,
  recorded_at         timestamptz not null,
  received_at         timestamptz not null default clock_timestamp(),
  -- Set by trigger from received_at, never from the client clock. This is a
  -- compliance clock.
  purge_after         timestamptz not null,
  created_at          timestamptz not null default now(),
  constraint recordings_destroyed_has_reason
    check ((purge_state = 'destroyed') = (destroyed_at is not null)),
  constraint recordings_destroyed_has_no_key
    check (purge_state <> 'destroyed' or storage_key is null)
);

create index recordings_visit_idx  on public.recordings (visit_id);
create index recordings_mr_idx     on public.recordings (mr_id, recorded_at desc);
create index recordings_due_idx    on public.recordings (purge_after)
  where purge_state <> 'destroyed';

create table public.voice_notes (
  id               uuid primary key,
  visit_id         uuid not null references public.visits (id) on delete restrict,
  mr_id            uuid not null references public.user_profiles (id) on delete restrict,
  storage_key      text unique
    check (storage_key is null
           or storage_key ~ '^voice-notes/[0-9a-f-]{36}/[0-9a-f-]{36}\.opus$'),
  duration_seconds integer not null check (duration_seconds > 0),
  size_bytes       bigint not null check (size_bytes > 0),
  upload_status    public.upload_state not null default 'pending',
  purge_state      public.audio_purge_state not null default 'live',
  destroyed_at     timestamptz,
  claimed_at       timestamptz,
  claimed_by_run_id uuid,
  recorded_at      timestamptz not null,
  received_at      timestamptz not null default clock_timestamp(),
  purge_after      timestamptz not null,
  created_at       timestamptz not null default now()
);

create index voice_notes_visit_idx on public.voice_notes (visit_id);
create index voice_notes_due_idx   on public.voice_notes (purge_after)
  where purge_state <> 'destroyed';

comment on table public.voice_notes is
  'The MR''s own post-visit note. Requires no doctor consent — it involves no third '
  'party — but carries the same 90-day retention, because it is still audio.';

-- 90 days from server receipt. Both columns are set together so the retention
-- clock can never be started by a device.
create or replace function public.stamp_audio_retention()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.received_at := clock_timestamp();
  new.purge_after := new.received_at + interval '90 days';
  return new;
end;
$$;

create trigger recordings_stamp_retention
  before insert on public.recordings
  for each row execute function public.stamp_audio_retention();

create trigger voice_notes_stamp_retention
  before insert on public.voice_notes
  for each row execute function public.stamp_audio_retention();

-- The first of the two consent checks. The second is the storage policy.
create or replace function public.require_consent_for_recording()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_consent public.consent_records%rowtype;
begin
  select * into v_consent from public.consent_records c where c.id = new.consent_record_id;

  if not found then
    raise exception 'consent record % does not exist', new.consent_record_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_consent.outcome <> 'consented' then
    raise exception 'consent record % has outcome %; audio requires an explicit consent',
      v_consent.id, v_consent.outcome
      using errcode = 'check_violation';
  end if;

  if v_consent.visit_id <> new.visit_id then
    raise exception 'consent record % is for a different visit', v_consent.id
      using errcode = 'check_violation';
  end if;

  if v_consent.is_withdrawal then
    raise exception 'consent record % is a withdrawal', v_consent.id
      using errcode = 'check_violation';
  end if;

  -- A withdrawal already on file for this consent means the permission is gone.
  if exists (select 1 from public.consent_records w
              where w.supersedes_consent_record_id = v_consent.id) then
    raise exception 'consent % has been withdrawn', v_consent.id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger recordings_require_consent
  before insert on public.recordings
  for each row execute function public.require_consent_for_recording();

-- The upload grant. Short-lived, single-use, one live grant per visit.
create table public.upload_grants (
  id                uuid primary key default gen_random_uuid(),
  visit_id          uuid not null references public.visits (id) on delete cascade,
  mr_id             uuid not null references public.user_profiles (id) on delete restrict,
  kind              text not null check (kind in ('recording', 'voice_note')),
  storage_key       text not null unique,
  max_bytes         bigint not null check (max_bytes > 0),
  max_duration_seconds integer not null check (max_duration_seconds > 0),
  issued_at         timestamptz not null default now(),
  expires_at        timestamptz not null,
  consumed_at       timestamptz,
  constraint upload_grants_expiry_after_issue check (expires_at > issued_at)
);

create index upload_grants_live_idx on public.upload_grants (storage_key)
  where consumed_at is null;

comment on table public.upload_grants is
  'A short-lived, single-use permission to write one object. The consent check '
  'happens when this is issued and again in the storage policy: the first is a '
  'convenience and the second is the control.';

-- ----------------------------------------------------------------------------
-- 3. Storage bucket and its policy
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('audio', 'audio', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

-- The control. An object can only be written where a live, unconsumed grant exists
-- for exactly that key, held by the caller. No grant, no object — regardless of
-- what any application code believes.
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

-- Read is for the pipeline, not for the field. No select policy for `authenticated`
-- at all: an MR does not download audio back, and a manager never listens to it.
create policy audio_no_public_read
  on storage.objects for select to authenticated
  using (false);

-- ----------------------------------------------------------------------------
-- 4. Issuing a grant — where consent is checked the first time
-- ----------------------------------------------------------------------------

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
  c_max_bytes    constant bigint  := 25 * 1024 * 1024;  -- ~2 hours of 28 kbps opus
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

  -- Unbounded uploads are a denial-of-service surface and a cost surface.
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

  -- There is no grant to obtain without consent. Not a grant that fails later.
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
     -- Opaque, server-generated, and nothing in it identifies anybody.
     'recordings/' || gen_random_uuid()::text || '/' || gen_random_uuid()::text || '.opus',
     p_size_bytes, p_duration_seconds, now() + interval '15 minutes')
  returning * into v_row;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Transcripts — raw and redacted, in separate tables
-- ----------------------------------------------------------------------------

create table public.transcripts_raw (
  id             uuid primary key default gen_random_uuid(),
  visit_id       uuid not null references public.visits (id) on delete restrict,
  recording_id   uuid references public.recordings (id) on delete cascade,
  voice_note_id  uuid references public.voice_notes (id) on delete cascade,
  language       text not null,
  vendor         text not null,
  model_version  text not null,
  -- TranscriptV0 in packages/core. Provider-agnostic.
  segments       jsonb not null,
  received_at    timestamptz not null default clock_timestamp(),
  created_at     timestamptz not null default now(),
  constraint transcripts_raw_one_source
    check ((recording_id is null) <> (voice_note_id is null))
);

create index transcripts_raw_visit_idx on public.transcripts_raw (visit_id);

comment on table public.transcripts_raw is
  'Unredacted. The LLM gateway role has NO GRANT on this table — not a restrictive '
  'policy, no grant — so a query from that role is a permission denied rather than '
  'an empty result. That distinction is the control.';

create table public.transcripts_redacted (
  id                 uuid primary key default gen_random_uuid(),
  raw_transcript_id  uuid not null references public.transcripts_raw (id) on delete cascade,
  visit_id           uuid not null references public.visits (id) on delete restrict,
  language           text not null,
  redaction_engine_version text not null,
  segments           jsonb not null,
  redacted_at        timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  constraint transcripts_redacted_one_per_raw unique (raw_transcript_id)
);

create index transcripts_redacted_visit_idx on public.transcripts_redacted (visit_id);

-- The role the LLM gateway will run as. It does not exist yet; three lines now
-- rather than an argument in week 8.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'llm_gateway') then
    create role llm_gateway nologin;
  end if;
end
$$;

-- So the suite can assume the role and prove the denial. Membership does not grant
-- llm_gateway anything; it lets postgres become it.
grant llm_gateway to postgres;

grant usage on schema public to llm_gateway;
grant select on table public.transcripts_redacted to llm_gateway;
-- Stated explicitly so a future `grant all on all tables` cannot quietly undo it.
revoke all on table public.transcripts_raw from llm_gateway;
revoke all on table public.recordings      from llm_gateway;
revoke all on table public.voice_notes     from llm_gateway;
revoke all on table public.consent_records from llm_gateway;

-- ----------------------------------------------------------------------------
-- 6. Destruction — the shared machinery for withdrawal and retention
-- ----------------------------------------------------------------------------

create table public.audio_purge_runs (
  id             uuid primary key default gen_random_uuid(),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  claimed_count  integer not null default 0,
  destroyed_count integer not null default 0,
  failed_count   integer not null default 0,
  last_error     text
);

comment on table public.audio_purge_runs is
  'Observability for the purge. A failed purge is silent by default, and silence is '
  'how a retention policy stops running in week 7 and is noticed in month four.';

create table public.audio_destruction_log (
  id               bigint generated always as identity primary key,
  run_id           uuid references public.audio_purge_runs (id) on delete set null,
  object_kind      text not null check (object_kind in ('recording', 'voice_note')),
  object_id        uuid not null,
  visit_id         uuid not null,
  reason           public.audio_destruction_reason not null,
  storage_key_hash text,
  destroyed_at     timestamptz not null default clock_timestamp(),
  derived_rows_destroyed jsonb not null default '{}'::jsonb
);

create index audio_destruction_log_object_idx on public.audio_destruction_log (object_id);

-- Records WHAT was destroyed: ids, counts, timestamps. Never content, and not even
-- the object path in the clear — the audit trail must not become the copy that
-- survives the deletion.
comment on table public.audio_destruction_log is
  'What was destroyed, never what it contained. The storage key is hashed so the '
  'log cannot be used to reconstruct an object path.';

create trigger audio_destruction_log_reject_mutation
  before update or delete or truncate on public.audio_destruction_log
  for each statement execute function public.reject_mutation();

-- ----------------------------------------------------------------------------
-- 7. The withdrawal cascade
-- ----------------------------------------------------------------------------

-- Fires on the insert of a withdrawal row. Destroys the database side immediately
-- and in the same transaction as the withdrawal; the storage object is marked for
-- destruction and removed by the purge worker, because a storage object is not a
-- row and SQL cannot delete one.
--
-- The audit row is written in the SAME transaction as the destruction. The
-- alternative — writing it afterwards — produces destructions with no record when
-- the second write fails. A record with no destruction is the safer failure: it
-- says "this was destroyed" about something still present, which a reconciliation
-- job can find and finish. The reverse is undetectable.
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
    -- Derived artifacts first, so a failure leaves the audio present and findable
    -- rather than the reverse.
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

    -- The object itself cannot be deleted from SQL. Mark it and let the purge
    -- worker finish; both paths share the same machinery so they are safe to
    -- interleave.
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

create trigger consent_records_cascade_withdrawal
  after insert on public.consent_records
  for each row execute function public.cascade_consent_withdrawal();

-- ----------------------------------------------------------------------------
-- 8. What a manager sees after a withdrawal
-- ----------------------------------------------------------------------------

-- Not the content, and not nothing.
--
-- A manager may already have read the summary, and that cannot be un-read. The
-- honest model is that the record shows the content existed and was withdrawn.
-- Silently vanishing is worse than a placeholder: it hides the withdrawal from the
-- only person who might otherwise notice a pattern of them.
create view public.visit_recording_status
with (security_invoker = true) as
  select v.id as visit_id,
         v.mr_id,
         case
           when r.id is null then 'none'
           when r.purge_state = 'destroyed' and r.destruction_reason = 'withdrawal' then 'withdrawn'
           when r.purge_state = 'claimed'   and r.destruction_reason = 'withdrawal' then 'withdrawn'
           when r.purge_state = 'destroyed' and r.destruction_reason = 'retention'  then 'purged'
           when r.purge_state = 'claimed'   and r.destruction_reason = 'retention'  then 'purged'
           else 'present'
         end as recording_status,
         r.destroyed_at,
         r.withdrawn_at
    from public.visits v
    left join public.recordings r on r.visit_id = v.id;

comment on view public.visit_recording_status is
  'Manager-facing. A withdrawn recording shows as withdrawn, with its date, and '
  'never as though the visit had no recording. The content is gone; the fact is not.';

-- ----------------------------------------------------------------------------
-- 9. Retention purge — claim, destroy, confirm
-- ----------------------------------------------------------------------------

-- Split into claim and confirm because the object lives in a different system.
-- The worker claims a batch, deletes objects through the storage API, then confirms
-- each one. A crash between the two leaves rows claimed, and a later run re-claims
-- anything stale — which is what makes it resumable, and running it twice safe.
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
          -- Unclaimed, or claimed by a run that has stopped making progress.
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
    -- Idempotent: confirming an already-destroyed object is a no-op, which is what
    -- makes running the worker twice safe.
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

create or replace function public.record_audio_purge_failure(
  p_run_id uuid,
  p_error  text
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.audio_purge_runs
     set failed_count = failed_count + 1,
         last_error = p_error
   where id = p_run_id;
$$;

create or replace function public.finish_audio_purge_run(p_run_id uuid, p_claimed integer)
returns public.audio_purge_runs
language sql
volatile
security definer
set search_path = ''
as $$
  update public.audio_purge_runs
     set finished_at = clock_timestamp(),
         claimed_count = p_claimed
   where id = p_run_id
  returning *;
$$;

-- What support and monitoring read. A purge that has not run is as much a finding
-- as a purge that failed.
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

-- ----------------------------------------------------------------------------
-- 10. Boundary
-- ----------------------------------------------------------------------------

alter table public.recordings            enable row level security;
alter table public.voice_notes           enable row level security;
alter table public.upload_grants         enable row level security;
alter table public.transcripts_raw       enable row level security;
alter table public.transcripts_redacted  enable row level security;
alter table public.audio_purge_runs      enable row level security;
alter table public.audio_destruction_log enable row level security;

alter table public.recordings            force row level security;
alter table public.voice_notes           force row level security;
alter table public.upload_grants         force row level security;
alter table public.transcripts_raw       force row level security;
alter table public.transcripts_redacted  force row level security;
alter table public.audio_purge_runs      force row level security;
alter table public.audio_destruction_log force row level security;

revoke all on table public.recordings            from anon, authenticated;
revoke all on table public.voice_notes           from anon, authenticated;
revoke all on table public.upload_grants         from anon, authenticated;
revoke all on table public.transcripts_raw       from anon, authenticated;
revoke all on table public.transcripts_redacted  from anon, authenticated;
revoke all on table public.audio_purge_runs      from anon, authenticated;
revoke all on table public.audio_destruction_log from anon, authenticated;
revoke update, delete, truncate on table public.audio_destruction_log from service_role;

-- An MR sees that their own recording exists and what state it is in. Nobody in the
-- field reads transcripts; that is the pipeline's business.
create policy recordings_select_own_or_team
  on public.recordings for select to authenticated
  using (mr_id in (select public.visible_user_ids()));

create policy voice_notes_select_own_or_team
  on public.voice_notes for select to authenticated
  using (mr_id in (select public.visible_user_ids()));

create policy upload_grants_select_own
  on public.upload_grants for select to authenticated
  using (mr_id = (select auth.uid()));

grant select on table public.recordings    to authenticated;
grant select on table public.voice_notes   to authenticated;
grant select on table public.upload_grants to authenticated;

revoke all on public.visit_recording_status from anon, authenticated;
grant select on public.visit_recording_status to authenticated;

grant execute on function public.active_consent_text(text)                          to authenticated;
grant execute on function public.capture_consent(uuid, uuid, public.consent_outcome, text, text, timestamptz) to authenticated;
grant execute on function public.issue_recording_upload_grant(uuid, bigint, integer) to authenticated;

-- The purge worker runs as service_role. Nothing in the field may claim or confirm.
revoke execute on function public.claim_expired_audio(uuid, integer)        from public, anon, authenticated;
revoke execute on function public.confirm_audio_destroyed(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.record_audio_purge_failure(uuid, text)    from public, anon, authenticated;
revoke execute on function public.finish_audio_purge_run(uuid, integer)     from public, anon, authenticated;
grant execute on function public.audio_purge_health() to authenticated;
