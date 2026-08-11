-- ============================================================================
-- BE-W7 (4 of 5) · Reconciling the database against storage after a restore
--
-- THE FAILURE THIS EXISTS FOR
--
-- Supabase's documentation settles two things. Deleting an object through the
-- Storage API is permanent and not recoverable. And database backups do not include
-- objects stored via the Storage API — the database holds only metadata about them,
-- so restoring an old backup does not bring back objects deleted after it.
--
-- Both of those are usually quoted as reassurance. Put together they are a hazard,
-- and it runs the opposite way to the one anybody worries about.
--
-- A point-in-time restore rewinds THE DATABASE and not THE OBJECTS. So a restore to
-- a moment before a consent withdrawal:
--
--   * un-withdraws the consent — the withdrawal row disappears and the ledger now
--     says the doctor consented and never withdrew;
--   * leaves the audio genuinely gone, because objects do not come back;
--   * and leaves metadata pointing at objects that no longer exist.
--
-- The first is a compliance failure rather than an inconvenience. A restore
-- silently rewrites the record of what a doctor agreed to, which is the exact thing
-- the consent ledger exists to prove.
--
-- THE ONE THAT IS WORSE, AND IS NOT IN THE PROMPT
--
-- The mirror case. An upload that completed AFTER the restore point has its row
-- rewound away while the object stays in the bucket. The result is audio in storage
-- with no recording row, no consent record and no retention clock — a file nobody
-- knows about, held with no lawful basis and no expiry. That is a live breach
-- rather than a stale row, so this reconciliation checks BOTH directions.
--
-- WHY THE STORAGE API AND NOT `storage.objects`
--
-- `storage.objects` is an ordinary table in the same database, so a restore rewinds
-- it alongside everything else. Comparing `public.recordings` against it after a
-- restore compares two things that were rewound together and finds nothing. The
-- object store is the only witness that did not travel back, so the worker walks it
-- over HTTP. See services/api/scripts/reconcile-after-restore.mjs.
--
-- Rollback: services/api/rollbacks/20260816000400_restore_reconciliation.down.sql
-- ============================================================================

create type public.restore_finding_kind as enum (
  -- The database believes it holds audio. Storage does not have it.
  'row_without_object',
  -- Storage holds audio. No live row references it.
  'object_without_row'
);

create type public.restore_finding_resolution as enum (
  -- The destruction the restore erased has been re-applied to the row.
  'reapplied',
  -- The object had no lawful basis to exist and has been destroyed.
  'destroyed_object',
  -- Cannot be fixed by a machine. See the quarantine below.
  'quarantined'
);

-- ----------------------------------------------------------------------------
-- 1. Runs and findings
-- ----------------------------------------------------------------------------

create table public.restore_reconciliation_runs (
  id             uuid primary key,
  started_at     timestamptz not null default clock_timestamp(),
  finished_at    timestamptz,
  rows_checked   integer not null default 0,
  objects_seen   integer not null default 0,
  finding_count  integer not null default 0,
  -- Set by the operator. A reconciliation with no stated cause is somebody running
  -- a compliance tool to see what it does.
  note           text
);

comment on table public.restore_reconciliation_runs is
  'One row per reconciliation. A PITR restore on this project is a compliance event '
  'and every one of them should leave a run here.';

create table public.restore_reconciliation_findings (
  id               bigint generated always as identity primary key,
  run_id           uuid not null references public.restore_reconciliation_runs (id) on delete restrict,
  kind             public.restore_finding_kind not null,
  resolution       public.restore_finding_resolution not null,
  object_kind      text check (object_kind in ('recording', 'voice_note', 'upload_partial')),
  object_id        uuid,
  visit_id         uuid,
  doctor_id        uuid,
  -- Hashed, exactly as in audio_destruction_log. A compliance record must not
  -- become the copy that outlives the thing it describes.
  storage_key_hash text,
  detail           jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default clock_timestamp()
);

create index restore_findings_run_idx   on public.restore_reconciliation_findings (run_id);
create index restore_findings_visit_idx on public.restore_reconciliation_findings (visit_id);

create trigger restore_findings_reject_mutation
  before update or delete or truncate on public.restore_reconciliation_findings
  for each statement execute function public.reject_mutation();

comment on table public.restore_reconciliation_findings is
  'Append-only. What a restore broke, and what was done about it — including the '
  'cases where the honest answer was that nothing could be.';

-- ----------------------------------------------------------------------------
-- 2. Quarantine — the part a machine must not fix
-- ----------------------------------------------------------------------------

-- WHY THE WITHDRAWAL IS NOT RE-CREATED.
--
-- When a restore erases a withdrawal, the evidence that it happened is erased with
-- it: the consent row, the destruction log row and the recording's withdrawn_at all
-- lived in the database. The only surviving trace is the object's absence, and
-- absence cannot distinguish a withdrawal from an ordinary ninety-day purge.
--
-- So this does NOT insert a withdrawal row. The consent ledger's entire value is
-- that every row in it is a real thing a real doctor did; a row this system invented
-- because it inferred one is worth less than no row at all, and it would be
-- indistinguishable from a genuine one forever afterwards.
--
-- Instead the visit is quarantined: the system stops behaving as though consent
-- stands, refuses new audio, and puts a named human in front of the question. That
-- is the safe direction to be wrong in — a blocked recording is recoverable and an
-- un-withdrawn consent is not.
create table public.visit_audio_quarantine (
  visit_id     uuid primary key references public.visits (id) on delete cascade,
  finding_id   bigint not null references public.restore_reconciliation_findings (id) on delete restrict,
  reason       text not null,
  quarantined_at timestamptz not null default clock_timestamp()
);

comment on table public.visit_audio_quarantine is
  'Visits whose consent state cannot be trusted after a restore. No upload grant is '
  'issued for a quarantined visit. Cleared only by a named person with a reason.';

-- Append-only, attributed, mandatory reason. Deliberately the same shape as
-- sync_item_reinstatements: a quarantine with no exit is an outage, and an exit
-- with no name on it is not a control.
create table public.visit_audio_quarantine_clearances (
  id                uuid primary key default gen_random_uuid(),
  visit_id          uuid not null references public.visits (id) on delete restrict,
  cleared_by_user_id uuid not null references public.user_profiles (id) on delete restrict,
  reason            text not null check (length(btrim(reason)) > 0),
  created_at        timestamptz not null default now(),
  received_at       timestamptz not null default clock_timestamp()
);

create index visit_audio_quarantine_clearances_visit_idx
  on public.visit_audio_quarantine_clearances (visit_id, created_at desc);

create trigger visit_audio_quarantine_clearances_stamp_received_at
  before insert on public.visit_audio_quarantine_clearances
  for each row execute function public.stamp_received_at();

create trigger visit_audio_quarantine_clearances_audit
  after insert on public.visit_audio_quarantine_clearances
  for each row execute function public.write_audit_row();

create trigger visit_audio_quarantine_clearances_reject_mutation
  before update or delete or truncate on public.visit_audio_quarantine_clearances
  for each statement execute function public.reject_mutation();

-- ----------------------------------------------------------------------------
-- 3. The reconciliation itself
-- ----------------------------------------------------------------------------

-- Every key the database believes is live. The worker checks each against what the
-- object store actually holds.
create or replace function public.begin_restore_reconciliation(p_run_id uuid, p_note text default null)
returns table (object_kind text, object_id uuid, visit_id uuid, storage_key text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into public.restore_reconciliation_runs (id, note) values (p_run_id, p_note)
  on conflict (id) do nothing;

  return query
  select 'recording'::text, r.id, r.visit_id, r.storage_key
    from public.recordings r
   where r.purge_state <> 'destroyed' and r.storage_key is not null
  union all
  select 'voice_note'::text, n.id, n.visit_id, n.storage_key
    from public.voice_notes n
   where n.purge_state <> 'destroyed' and n.storage_key is not null
  union all
  select 'upload_partial'::text, g.id, g.visit_id, g.storage_key
    from public.upload_grants g
   where g.purge_state <> 'destroyed' and g.state <> 'completed';
end;
$$;

-- Re-checked at the moment of acting, not at the moment of finding.
--
-- Walking a live bucket produces a SMEAR, not a snapshot: the DB read and the
-- storage walk happen at different times, and an upload that starts between them
-- appears as an object with no row no matter which order they run in. Reversing the
-- order just moves the error to the other direction — a row with no object.
--
-- So neither snapshot is trusted. Every finding is re-verified against both systems
-- immediately before anything is destroyed. Found by a test in another spec file
-- racing this one, which is the only reason it was found at all.
create or replace function public.storage_key_is_referenced(p_storage_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.recordings r
                  where r.storage_key = p_storage_key and r.purge_state <> 'destroyed')
      or exists (select 1 from public.voice_notes n
                  where n.storage_key = p_storage_key and n.purge_state <> 'destroyed')
      or exists (select 1 from public.upload_grants g
                  where g.storage_key = p_storage_key
                    and g.purge_state <> 'destroyed'
                    and g.state <> 'completed');
$$;

comment on function public.storage_key_is_referenced(text) is
  'Whether any live row still claims this object. Re-checked immediately before the '
  'reconciliation destroys an apparent orphan, because the bucket walk that found it '
  'is a smear across time rather than a snapshot.';

-- The database says this is live and the object store does not have it. The audio is
-- gone and it is not coming back, so the row is brought into line — and the visit is
-- quarantined, because the cause may have been a withdrawal whose record went with
-- the restore.
create or replace function public.reconcile_row_without_object(
  p_run_id      uuid,
  p_object_kind text,
  p_object_id   uuid
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_visit    uuid;
  v_doctor   uuid;
  v_hash     text;
  v_finding  bigint;
begin
  if p_object_kind = 'recording' then
    select r.visit_id, public.sha256_hex(coalesce(r.storage_key, ''))
      into v_visit, v_hash
      from public.recordings r
     where r.id = p_object_id and r.purge_state <> 'destroyed';
    if not found then return null; end if;

    -- Re-apply the destruction the restore erased. `restore_reconciled` rather than
    -- `retention` or `withdrawal`: the cause is genuinely unknown and filing it
    -- under either would be a guess written into a compliance record.
    update public.recordings
       set purge_state = 'destroyed',
           destruction_reason = 'restore_reconciled',
           destroyed_at = clock_timestamp(),
           storage_key = null,
           upload_status = 'purged'
     where id = p_object_id;

    delete from public.transcripts_redacted t
     where t.raw_transcript_id in (
       select x.id from public.transcripts_raw x where x.recording_id = p_object_id);
    delete from public.transcripts_raw t where t.recording_id = p_object_id;
    delete from public.analyses a where a.visit_id = v_visit;

    insert into public.audio_destruction_log
      (object_kind, object_id, visit_id, reason, storage_key_hash, derived_rows_destroyed)
    values ('recording', p_object_id, v_visit, 'restore_reconciled', v_hash,
            jsonb_build_object('reconciledAfterRestore', true));

  elsif p_object_kind = 'voice_note' then
    select n.visit_id, public.sha256_hex(coalesce(n.storage_key, ''))
      into v_visit, v_hash
      from public.voice_notes n
     where n.id = p_object_id and n.purge_state <> 'destroyed';
    if not found then return null; end if;

    update public.voice_notes
       set purge_state = 'destroyed',
           destroyed_at = clock_timestamp(),
           storage_key = null,
           upload_status = 'purged'
     where id = p_object_id;

    insert into public.audio_destruction_log
      (object_kind, object_id, visit_id, reason, storage_key_hash, derived_rows_destroyed)
    values ('voice_note', p_object_id, v_visit, 'restore_reconciled', v_hash, '{}'::jsonb);

  elsif p_object_kind = 'upload_partial' then
    select g.visit_id, public.sha256_hex(coalesce(g.storage_key, ''))
      into v_visit, v_hash
      from public.upload_grants g
     where g.id = p_object_id and g.purge_state <> 'destroyed';
    if not found then return null; end if;

    update public.upload_grants
       set purge_state = 'destroyed',
           destroyed_at = clock_timestamp(),
           state = case when state = 'open' then 'abandoned' else state end,
           closed_at = coalesce(closed_at, clock_timestamp()),
           closed_reason = coalesce(closed_reason, 'the partial object was gone after a restore')
     where id = p_object_id;

  else
    raise exception 'unknown object kind %', p_object_kind using errcode = '22023';
  end if;

  select v.doctor_id into v_doctor from public.visits v where v.id = v_visit;

  insert into public.restore_reconciliation_findings
    (run_id, kind, resolution, object_kind, object_id, visit_id, doctor_id,
     storage_key_hash, detail)
  values
    (p_run_id, 'row_without_object',
     -- A recording is the only kind whose disappearance might have been a
     -- withdrawal, so it is the only kind that quarantines a visit. A voice note
     -- involves no third party and a partial was never covered by a consent record.
     case when p_object_kind = 'recording' then 'quarantined'::public.restore_finding_resolution
          else 'reapplied'::public.restore_finding_resolution end,
     p_object_kind, p_object_id, v_visit, v_doctor, v_hash,
     jsonb_build_object('cause', 'unknown: absence cannot distinguish a withdrawal from a purge'))
  returning id into v_finding;

  if p_object_kind = 'recording' then
    -- Quarantine is on the VISIT, not the doctor.
    --
    -- The doctor is the safer scope and it is recorded on the finding for exactly
    -- that reason — a human widening it is one insert. But a missing object can also
    -- be an ordinary storage fault, and blocking every future recording for a doctor
    -- on that evidence turns a possible compliance question into a certain outage
    -- across their whole territory. The visit is the unit the withdrawal was tied
    -- to, so it is the unit blocked automatically.
    insert into public.visit_audio_quarantine (visit_id, finding_id, reason)
    values (v_visit, v_finding,
            'A restore left this visit''s audio destroyed with its consent state '
            'un-rewindable. A withdrawal may have been erased.')
    on conflict (visit_id) do nothing;
  end if;

  update public.restore_reconciliation_runs
     set finding_count = finding_count + 1 where id = p_run_id;

  return v_finding;
end;
$$;

-- Storage holds an object no live row references. There is no consent record behind
-- it, no retention clock on it and no way to acquire either after the fact, so it
-- may not be kept. The worker destroys the object and this records that it did.
create or replace function public.reconcile_object_without_row(
  p_run_id      uuid,
  p_storage_key text
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_finding bigint;
begin
  insert into public.restore_reconciliation_findings
    (run_id, kind, resolution, object_kind, storage_key_hash, detail)
  values
    (p_run_id, 'object_without_row', 'destroyed_object',
     case when p_storage_key like 'voice-notes/%' then 'voice_note' else 'recording' end,
     public.sha256_hex(p_storage_key),
     jsonb_build_object(
       'reason',
       'No live row references this object, so no consent record covers it and no '
       'retention clock governs it. It cannot be kept and its provenance cannot be '
       'recovered.'))
  returning id into v_finding;

  update public.restore_reconciliation_runs
     set finding_count = finding_count + 1 where id = p_run_id;

  return v_finding;
end;
$$;

create or replace function public.finish_restore_reconciliation(
  p_run_id       uuid,
  p_rows_checked integer,
  p_objects_seen integer
)
returns public.restore_reconciliation_runs
language sql
volatile
security definer
set search_path = ''
as $$
  update public.restore_reconciliation_runs
     set finished_at  = clock_timestamp(),
         rows_checked = p_rows_checked,
         objects_seen = p_objects_seen
   where id = p_run_id
  returning *;
$$;

-- ----------------------------------------------------------------------------
-- 4. What quarantine does, and how it ends
-- ----------------------------------------------------------------------------

create or replace function public.visit_is_quarantined(p_visit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.visit_audio_quarantine q where q.visit_id = p_visit_id);
$$;

-- begin_upload restated with the quarantine check. It is the first thing after
-- authentication deliberately: a quarantined visit must not even reveal whether it
-- has standing consent, because the whole finding is that we no longer know.
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

  if public.visit_is_quarantined(p_visit_id) then
    raise exception 'visit % is quarantined after a database restore; its consent state is not trusted',
      p_visit_id
      using errcode = '42501',
            hint = 'A named person must clear the quarantine with a reason before audio resumes.';
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

create or replace function public.clear_audio_quarantine(p_visit_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid  uuid;
  v_role public.app_role;
begin
  v_uid  := (select auth.uid());
  v_role := public.effective_role();

  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if v_role not in ('field_manager', 'admin') then
    raise exception 'only a field_manager or admin may clear an audio quarantine'
      using errcode = '42501';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'clearing a quarantine requires a reason' using errcode = '22023';
  end if;

  if not public.visit_is_quarantined(p_visit_id) then
    raise exception 'visit % is not quarantined', p_visit_id using errcode = '22023';
  end if;

  -- The clearance is written first and is append-only, so the record of who lifted
  -- the block outlives the block itself.
  insert into public.visit_audio_quarantine_clearances (visit_id, cleared_by_user_id, reason)
  values (p_visit_id, v_uid, p_reason);

  delete from public.visit_audio_quarantine where visit_id = p_visit_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Boundary
-- ----------------------------------------------------------------------------

alter table public.restore_reconciliation_runs      enable row level security;
alter table public.restore_reconciliation_findings  enable row level security;
alter table public.visit_audio_quarantine           enable row level security;
alter table public.visit_audio_quarantine_clearances enable row level security;

alter table public.restore_reconciliation_runs      force row level security;
alter table public.restore_reconciliation_findings  force row level security;
alter table public.visit_audio_quarantine           force row level security;
alter table public.visit_audio_quarantine_clearances force row level security;

revoke all on table public.restore_reconciliation_runs       from anon, authenticated;
revoke all on table public.restore_reconciliation_findings   from anon, authenticated;
revoke all on table public.visit_audio_quarantine            from anon, authenticated;
revoke all on table public.visit_audio_quarantine_clearances from anon, authenticated;
revoke update, delete, truncate on table public.restore_reconciliation_findings   from service_role;
revoke update, delete, truncate on table public.visit_audio_quarantine_clearances from service_role;
revoke all on table public.restore_reconciliation_findings   from llm_gateway;
revoke all on table public.visit_audio_quarantine            from llm_gateway;

-- An MR can see that their own visit is blocked and why. Being told "upload failed"
-- with no reason is how an MR concludes the app is broken and stops using it.
create policy visit_audio_quarantine_select_scope
  on public.visit_audio_quarantine for select to authenticated
  using (visit_id in (select v.id from public.visits v
                       where v.mr_id in (select public.visible_user_ids())));

create policy visit_audio_quarantine_clearances_select_scope
  on public.visit_audio_quarantine_clearances for select to authenticated
  using (visit_id in (select v.id from public.visits v
                       where v.mr_id in (select public.visible_user_ids())));

grant select on table public.visit_audio_quarantine            to authenticated;
grant select on table public.visit_audio_quarantine_clearances to authenticated;

-- The reconciliation runs as service_role. Nothing in the field may re-apply a
-- destruction or invent a finding.
revoke execute on function public.begin_restore_reconciliation(uuid, text)          from public, anon, authenticated;
revoke execute on function public.storage_key_is_referenced(text)                   from public, anon, authenticated;
revoke execute on function public.reconcile_row_without_object(uuid, text, uuid)    from public, anon, authenticated;
revoke execute on function public.reconcile_object_without_row(uuid, text)          from public, anon, authenticated;
revoke execute on function public.finish_restore_reconciliation(uuid, integer, integer) from public, anon, authenticated;

grant execute on function public.visit_is_quarantined(uuid)            to authenticated;
grant execute on function public.clear_audio_quarantine(uuid, text)    to authenticated;
