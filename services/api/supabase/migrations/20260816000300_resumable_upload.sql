-- ============================================================================
-- BE-W7 (3 of 5) · Resumable upload, and the queue the MR can actually read
--
-- The shape of the problem, again in one sentence: an MR uploads a four-minute
-- recording over a mobile network from a clinic corridor, and if a failed upload
-- restarts from zero they will abandon it and the recording is lost.
--
-- THE CONTRADICTION, AND HOW IT IS RESOLVED
--
-- BE-W6 made the upload grant single-use and short-lived. A resumable upload is
-- long-lived by definition. Those two cannot both be true unless the design says
-- which.
--
-- The decision: THE GRANT COVERS THE WHOLE OBJECT, AND ITS VALIDITY IS RE-CHECKED
-- ON EVERY RESUME AND EVERY CHUNK.
--
-- Not a grant per chunk. A grant is a permission to write ONE object at ONE key,
-- and the key is unique — a per-chunk grant would have to re-issue the same key
-- repeatedly, which makes "single-use" meaningless rather than stricter. What
-- "single-use" has to mean for a resumable upload is that the grant is consumed
-- when the object is FINALISED, not when the first byte lands.
--
-- So the grant's lifetime is two clocks, not one:
--
--   * `expires_at`      — slides forward on each chunk. A stalled upload dies in
--                         fifteen minutes and its partial object is purged.
--   * `hard_expires_at` — fixed at issue, twenty-four hours, and the sliding clock
--                         can never pass it. Without this a device that heartbeats
--                         forever holds a permission forever.
--
-- And consent is re-read at every resume and every chunk. A grant that was valid at
-- 11am is not valid at 4pm if the doctor withdrew at noon. Bytes already in flight
-- do not make a dead permission live again — the withdrawal cascade revokes open
-- grants directly, and the partial object goes with the rest.
--
-- A PARTIAL UPLOAD IS AN OBJECT, NOT SCRATCH. It occupies storage, it may contain
-- audio, and if the visit was abandoned there is no recording row binding it to a
-- consent record at all. It is therefore destroyed by the same worker, through the
-- same claim/confirm machinery, as everything else.
--
-- Rollback: services/api/rollbacks/20260816000300_resumable_upload.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The grant becomes the session
-- ----------------------------------------------------------------------------

-- Deliberately not a second table. A grant is "permission to write one object" and
-- a session is "the writing of that one object" — they have the same lifetime, the
-- same key and the same consent basis. Splitting them would create two rows that
-- can disagree about whether an upload is still allowed, and the whole point of
-- BE-W6's design is that there is exactly one answer to that question.
create type public.upload_session_state as enum (
  'open',       -- bytes may be written
  'completed',  -- finalised; a recordings or voice_notes row now exists
  'abandoned',  -- the device gave up, or the sliding clock ran out
  'revoked'     -- consent went away underneath it
);

alter table public.upload_grants
  add column state            public.upload_session_state not null default 'open',
  add column bytes_received   bigint  not null default 0 check (bytes_received >= 0),
  add column chunk_count      integer not null default 0 check (chunk_count >= 0),
  add column last_progress_at timestamptz,
  -- The ceiling the sliding clock may never pass.
  add column hard_expires_at  timestamptz,
  add column closed_at        timestamptz,
  add column closed_reason    text,
  -- The partial object is purged through exactly the same machinery as a recording.
  add column purge_state      public.audio_purge_state not null default 'live',
  add column claimed_at       timestamptz,
  add column claimed_by_run_id uuid,
  add column destroyed_at     timestamptz;

-- Backfill before the NOT NULL: any grant issued by BE-W6 is already older than its
-- fifteen-minute window, so its hard ceiling is in the past and the purge will
-- collect its partial object on the next run. That is the correct treatment of a
-- grant nobody can prove is still wanted.
update public.upload_grants set hard_expires_at = issued_at + interval '24 hours'
 where hard_expires_at is null;

alter table public.upload_grants
  alter column hard_expires_at set not null,
  add constraint upload_grants_hard_expiry_after_issue check (hard_expires_at > issued_at),
  add constraint upload_grants_sliding_within_hard     check (expires_at <= hard_expires_at),
  add constraint upload_grants_closed_has_state
    check ((state = 'open') = (closed_at is null)),
  add constraint upload_grants_completed_is_consumed
    check (state <> 'completed' or consumed_at is not null),
  add constraint upload_grants_destroyed_has_timestamp
    check ((purge_state = 'destroyed') = (destroyed_at is not null));

-- At most one open session per visit per kind. This is what makes resume-after-kill
-- work: the device that lost its memory asks the server what it was doing and there
-- is exactly one answer.
create unique index upload_grants_one_open_per_visit_kind
  on public.upload_grants (visit_id, kind) where state = 'open';

create index upload_grants_purgeable_idx
  on public.upload_grants (hard_expires_at) where purge_state <> 'destroyed';

comment on column public.upload_grants.hard_expires_at is
  'Fixed at issue. The sliding expires_at can be extended by progress but never '
  'past this. A device that heartbeats forever must not hold a permission forever.';

-- ----------------------------------------------------------------------------
-- 2. Two ceilings that are not about one upload
-- ----------------------------------------------------------------------------

insert into public.app_thresholds (key, value, unit, note) values
  ('audio_storage_ceiling_bytes', '4294967296'::jsonb, 'bytes',
   'Per-MR ceiling on live audio plus reserved in-flight uploads. Four gibibytes is '
   'roughly six times ninety days of normal capture, so it bounds a runaway device '
   'without firing during ordinary work.'),
  ('purge_max_silence_hours', '48'::jsonb, 'hours',
   'How long an object may sit past its purge_after before the retention worker is '
   'treated as stopped. The purge runs daily, so this is two missed runs.');

-- Reserved, not just stored. An open session has not written its bytes yet but it
-- has promised to, and a ceiling that only counts what already landed lets a device
-- open two hundred sessions and blow straight through it.
create or replace function public.audio_storage_bytes(p_mr_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'liveBytes', coalesce(
      (select sum(r.size_bytes) from public.recordings r
        where r.mr_id = p_mr_id and r.purge_state <> 'destroyed'), 0)
      + coalesce(
      (select sum(n.size_bytes) from public.voice_notes n
        where n.mr_id = p_mr_id and n.purge_state <> 'destroyed'), 0),
    'reservedBytes', coalesce(
      (select sum(g.max_bytes) from public.upload_grants g
        where g.mr_id = p_mr_id and g.state = 'open'), 0));
$$;

-- If retention has stopped, intake stops.
--
-- This is the answer to "a health function nobody calls is the scheduler problem
-- wearing a different hat". The scheduler and its watchdog both live outside the
-- database and both can be switched off; this cannot, because it is on the write
-- path. The system refuses to take in new audio once it has demonstrably stopped
-- destroying old audio, so the 90-day promise degrades into a refusal rather than
-- into a silent breach.
--
-- Deliberately NOT expressed as "no successful run recently". On a fresh database
-- there has never been a run and nothing is overdue, and that is healthy. The only
-- honest signal is an object that should already be gone and is not.
create or replace function public.audio_purge_is_stalled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.recordings r
     where r.purge_state <> 'destroyed'
       and r.purge_after <= now() - make_interval(hours =>
             public.threshold_number('purge_max_silence_hours', null, 48)::integer)
    union all
    select 1 from public.voice_notes n
     where n.purge_state <> 'destroyed'
       and n.purge_after <= now() - make_interval(hours =>
             public.threshold_number('purge_max_silence_hours', null, 48)::integer));
$$;

comment on function public.audio_purge_is_stalled() is
  'True when an object is past its purge date by more than the configured silence '
  'window. Checked on the upload path: if retention has stopped, intake stops too.';

-- ----------------------------------------------------------------------------
-- 3. Opening a session
-- ----------------------------------------------------------------------------

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
  c_max_bytes    constant bigint  := 25 * 1024 * 1024;  -- ~2 hours of 28 kbps opus
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

  -- Bounds are validated BEFORE an existing session is looked for. Otherwise a
  -- caller could open a legitimate session and then push an absurd size past the
  -- check by asking again, because the second call would short-circuit to the row
  -- that already exists.
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

  -- A recording needs standing consent. A voice note does not: it involves no third
  -- party. Both are still audio and both are still purged at ninety days.
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

  -- Resume after the app was killed, not merely after a dropped connection. The
  -- device has lost whatever it knew; the server still holds the key and the byte
  -- count, so it asks rather than starting again.
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
      -- Close it here rather than handing back a permission that is already dead.
      -- The partial object is left for the purge worker, which is the only thing
      -- that can delete an object.
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

  -- If retention has stopped, intake stops. Checked here rather than only in a
  -- monitor, because a monitor can be switched off and this cannot.
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
     -- Opaque, server-generated, and nothing in it identifies anybody.
     case when p_kind = 'recording' then 'recordings/' else 'voice-notes/' end
       || gen_random_uuid()::text || '/' || gen_random_uuid()::text || '.opus',
     p_size_bytes, p_duration_seconds, now() + c_slide, now() + c_hard)
  returning * into v_row;

  return v_row;
end;
$$;

-- The BE-W6 entry point, now a thin wrapper. One code path, so the consent check
-- cannot be right in one of them and wrong in the other.
create or replace function public.issue_recording_upload_grant(
  p_visit_id         uuid,
  p_size_bytes       bigint,
  p_duration_seconds integer
)
returns public.upload_grants
language sql
volatile
security definer
set search_path = ''
as $$
  select * from public.begin_upload(p_visit_id, 'recording', p_size_bytes, p_duration_seconds);
$$;

-- ----------------------------------------------------------------------------
-- 4. Resuming and progressing — where consent is re-read
-- ----------------------------------------------------------------------------

-- Shared by resume and progress so there is exactly one definition of "is this
-- upload still allowed". Two copies of that question is how one of them ends up
-- being the lenient one.
create or replace function public.assert_upload_still_permitted(p_grant public.upload_grants)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- CONSENT IS CHECKED FIRST, and the order is the whole point.
  --
  -- The withdrawal cascade sets the session to `revoked`, so a state-first ordering
  -- always trips on the state and tells the MR "this grant is revoked; it accepts no
  -- more bytes". That is technically true, useless, and reads as a system fault they
  -- caused. It also maps to `validation_failed` in the queue, whose sentence is 'the
  -- server refused the contents of this item' — so the MR is told their recording
  -- was malformed when in fact the doctor changed their mind.
  --
  -- Found by a test that asserted the rejection code rather than only the refusal.
  if p_grant.kind = 'recording'
     and not exists (
       select 1 from public.consent_records c
        where c.visit_id = p_grant.visit_id
          and c.outcome = 'consented'
          and c.is_withdrawal = false
          and not exists (select 1 from public.consent_records w
                           where w.supersedes_consent_record_id = c.id)) then
    raise exception 'consent has been withdrawn for visit %; this upload is no longer permitted',
      p_grant.visit_id using errcode = '42501';
  end if;

  if p_grant.state <> 'open' then
    raise exception 'the upload grant % is %; it accepts no more bytes',
      p_grant.id, p_grant.state using errcode = '22023';
  end if;

  if p_grant.hard_expires_at <= now() or p_grant.expires_at <= now() then
    raise exception 'the upload grant % expired at %',
      p_grant.id, least(p_grant.expires_at, p_grant.hard_expires_at) using errcode = '22023';
  end if;
end;
$$;

create or replace function public.resume_upload(p_grant_id uuid)
returns public.upload_grants
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_slide constant interval := interval '15 minutes';
  v_uid   uuid;
  v_grant public.upload_grants%rowtype;
  v_row   public.upload_grants%rowtype;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_grant from public.upload_grants g where g.id = p_grant_id and g.mr_id = v_uid
   for update;
  if not found then
    raise exception 'upload grant % is not yours', p_grant_id using errcode = '42501';
  end if;

  perform public.assert_upload_still_permitted(v_grant);

  update public.upload_grants
     set expires_at = least(now() + c_slide, hard_expires_at)
   where id = p_grant_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.resume_upload(uuid) is
  'The server is the source of truth for how many bytes landed. A device that was '
  'killed mid-upload asks this rather than trusting its own memory, which is what '
  'makes resume work across a process death and not only across a dropped socket.';

create or replace function public.record_upload_progress(
  p_grant_id       uuid,
  p_bytes_received bigint
)
returns public.upload_grants
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_slide constant interval := interval '15 minutes';
  v_uid   uuid;
  v_grant public.upload_grants%rowtype;
  v_row   public.upload_grants%rowtype;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_grant from public.upload_grants g where g.id = p_grant_id and g.mr_id = v_uid
   for update;
  if not found then
    raise exception 'upload grant % is not yours', p_grant_id using errcode = '42501';
  end if;

  perform public.assert_upload_still_permitted(v_grant);

  if p_bytes_received is null or p_bytes_received < 0 then
    raise exception 'bytes_received must not be negative' using errcode = '22023';
  end if;

  if p_bytes_received > v_grant.max_bytes then
    raise exception 'this upload declared % bytes and has now reported %',
      v_grant.max_bytes, p_bytes_received using errcode = '22023';
  end if;

  update public.upload_grants
     set bytes_received   = greatest(bytes_received, p_bytes_received),
         chunk_count      = chunk_count + 1,
         last_progress_at = clock_timestamp(),
         expires_at       = least(now() + c_slide, hard_expires_at)
   where id = p_grant_id
  returning * into v_row;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Finalising, and giving up
-- ----------------------------------------------------------------------------

create or replace function public.complete_upload(
  p_grant_id         uuid,
  p_object_id        uuid,
  p_duration_seconds integer,
  p_size_bytes       bigint,
  p_recorded_at      timestamptz,
  p_bitrate_kbps     integer default 28
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid     uuid;
  v_grant   public.upload_grants%rowtype;
  v_consent public.consent_records%rowtype;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_grant from public.upload_grants g where g.id = p_grant_id and g.mr_id = v_uid
   for update;
  if not found then
    raise exception 'upload grant % is not yours', p_grant_id using errcode = '42501';
  end if;

  -- Already finalised. Returning the existing object rather than raising is what
  -- makes the sync queue safe to retry: the device that lost the response resends
  -- and gets the same answer.
  if v_grant.state = 'completed' then
    return jsonb_build_object('kind', v_grant.kind, 'objectId', p_object_id,
                              'storageKey', v_grant.storage_key, 'alreadyCompleted', true);
  end if;

  -- The last consent check, and the one that matters most: everything before it
  -- guarded permission to WRITE bytes, and this one guards permission to KEEP them.
  perform public.assert_upload_still_permitted(v_grant);

  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > v_grant.max_bytes then
    raise exception 'the finalised size % does not fit the grant''s % bytes',
      p_size_bytes, v_grant.max_bytes using errcode = '22023';
  end if;

  if p_duration_seconds is null or p_duration_seconds <= 0
     or p_duration_seconds > v_grant.max_duration_seconds then
    raise exception 'the finalised duration % does not fit the grant''s % seconds',
      p_duration_seconds, v_grant.max_duration_seconds using errcode = '22023';
  end if;

  if v_grant.kind = 'recording' then
    select * into v_consent
      from public.consent_records c
     where c.visit_id = v_grant.visit_id
       and c.outcome = 'consented'
       and c.is_withdrawal = false
       and not exists (select 1 from public.consent_records w
                        where w.supersedes_consent_record_id = c.id)
     order by c.captured_at desc
     limit 1;

    insert into public.recordings
      (id, visit_id, mr_id, consent_record_id, storage_key, bitrate_kbps,
       duration_seconds, size_bytes, upload_status, recorded_at, purge_after)
    values
      (p_object_id, v_grant.visit_id, v_uid, v_consent.id, v_grant.storage_key,
       coalesce(p_bitrate_kbps, 28), p_duration_seconds, p_size_bytes, 'uploaded',
       p_recorded_at, now())
    on conflict (id) do nothing;
  else
    insert into public.voice_notes
      (id, visit_id, mr_id, storage_key, duration_seconds, size_bytes,
       upload_status, recorded_at, purge_after)
    values
      (p_object_id, v_grant.visit_id, v_uid, v_grant.storage_key,
       p_duration_seconds, p_size_bytes, 'uploaded', p_recorded_at, now())
    on conflict (id) do nothing;
  end if;

  -- Single-use means consumed at FINALISATION, not at first byte. Until this line
  -- the storage policy still lets chunks through; after it, nothing more is written
  -- at that key by anybody.
  update public.upload_grants
     set state         = 'completed',
         consumed_at   = clock_timestamp(),
         closed_at     = clock_timestamp(),
         closed_reason = 'upload finalised',
         bytes_received = greatest(bytes_received, p_size_bytes)
   where id = p_grant_id;

  return jsonb_build_object('kind', v_grant.kind, 'objectId', p_object_id,
                            'storageKey', v_grant.storage_key, 'alreadyCompleted', false);
end;
$$;

create or replace function public.abandon_upload(p_grant_id uuid, p_reason text default null)
returns public.upload_grants
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_row public.upload_grants%rowtype;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  update public.upload_grants
     set state         = 'abandoned',
         closed_at     = clock_timestamp(),
         closed_reason = coalesce(nullif(btrim(p_reason), ''), 'abandoned by the device')
   where id = p_grant_id and mr_id = v_uid and state = 'open'
  returning * into v_row;

  if not found then
    raise exception 'upload grant % is not an open upload of yours', p_grant_id
      using errcode = '42501';
  end if;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. The storage policies, updated for chunks
-- ----------------------------------------------------------------------------

-- One definition of "may this caller write at this key, right now". The predicate
-- appears in three policies below, and three copies is how one of them ends up being
-- the lenient one.
--
-- Safe to expose to `authenticated`: it answers only about a key the caller has
-- already named, and only ever about the caller's own grants, so it tells an MR
-- nothing they did not supply.
create or replace function public.has_live_upload_grant(p_storage_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.upload_grants g
     where g.storage_key = p_storage_key
       and g.mr_id = (select auth.uid())
       and g.state = 'open'
       and g.consumed_at is null
       and g.expires_at > now()
       and g.hard_expires_at > now());
$$;

-- BE-W6 allowed INSERT only, plus `audio_no_public_read` — a SELECT policy of
-- `using (false)` — on the reasoning that an MR never downloads audio back and a
-- manager never listens to it. That reasoning is right, and it survives below.
--
-- What it also did, invisibly, was make a resumable upload impossible.
--
-- MEASURED, because assuming would have cost the feature. Supabase Storage does not
-- issue an UPDATE for a chunk write. It issues:
--
--     INSERT INTO storage.objects (...) VALUES (...)
--     ON CONFLICT (name, bucket_id) DO UPDATE SET ... RETURNING *
--
-- Postgres applies SELECT policies to the conflicting row of an upsert, and to any
-- UPDATE whose WHERE clause references columns. Under `using (false)` the existing
-- row is invisible, so the conflict cannot be resolved and the statement fails with
-- "new row violates row-level security policy" — which points at the WITH CHECK on
-- the write rather than at the SELECT policy actually refusing. A plain UPDATE
-- reports "0 rows affected" for the same reason, which is worse, because that reads
-- as success.
--
-- So the blanket read refusal is replaced by one scoped to the only window where
-- reading is needed: the caller's own upload, while it is still in flight.
-- Everything BE-W6 wanted still holds —
--
--   * no MR can read anybody else's object, ever;
--   * no MR can read a COMPLETED recording, including their own, because completing
--     it consumes the grant and closes the session;
--   * no manager and no field role can read audio at all.
--
-- — and the newly readable window covers only bytes the MR is uploading from their
-- own device at that moment. There is a test for each of those three.
drop policy if exists audio_insert_requires_live_grant on storage.objects;
drop policy if exists audio_no_public_read             on storage.objects;

create policy audio_insert_requires_live_grant
  on storage.objects for insert to authenticated
  with check (bucket_id = 'audio' and public.has_live_upload_grant(name));

create policy audio_update_requires_live_grant
  on storage.objects for update to authenticated
  using (bucket_id = 'audio' and public.has_live_upload_grant(name))
  with check (bucket_id = 'audio' and public.has_live_upload_grant(name));

create policy audio_select_live_upload_only
  on storage.objects for select to authenticated
  using (bucket_id = 'audio' and public.has_live_upload_grant(name));

-- ----------------------------------------------------------------------------
-- 7. Withdrawal revokes what is in flight
-- ----------------------------------------------------------------------------

-- The BE-W6 cascade, with one block added. Restated in full because Postgres has no
-- way to patch part of a function body.
--
-- Without this, a withdrawal arriving mid-upload is caught only at the next chunk —
-- and a device that is offline until tomorrow keeps a live permission overnight. The
-- revocation is immediate and in the same transaction as the withdrawal.
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

  -- In flight, and no longer permitted. The partial object is left in place for the
  -- purge worker; SQL cannot delete an object, and pretending otherwise is how a
  -- file survives a deletion that a row says happened.
  update public.upload_grants
     set state         = 'revoked',
         closed_at     = clock_timestamp(),
         closed_reason = 'consent withdrawn while the upload was in flight'
   where visit_id = new.visit_id
     and kind = 'recording'
     and state = 'open';

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

-- ----------------------------------------------------------------------------
-- 8. The purge collects partials too
-- ----------------------------------------------------------------------------

-- Same claim/confirm machinery, one more kind. A partial upload is destroyed when
-- its session is closed unsuccessfully, or when its hard ceiling passes — whichever
-- comes first — so the worst case an abandoned object survives is the hard window
-- plus one purge interval.
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
  ),
  claimed_partials as (
    update public.upload_grants g
       set purge_state = 'claimed',
           claimed_at = clock_timestamp(),
           claimed_by_run_id = p_run_id
     where g.id in (
       select g2.id from public.upload_grants g2
        where g2.purge_state <> 'destroyed'
          -- A completed session's object belongs to a recordings or voice_notes
          -- row now, and THAT row's retention clock governs it. Only unsuccessful
          -- sessions leave an object nobody owns.
          and g2.state in ('abandoned', 'revoked')
          and (g2.claimed_at is null or g2.claimed_at < now() - c_stale)
        order by g2.closed_at
        limit p_limit
        for update skip locked)
    returning 'upload_partial'::text as kind, g.id, g.storage_key
  )
  select * from claimed_recordings
  union all
  select * from claimed_notes
  union all
  select * from claimed_partials;
end;
$$;

-- Sessions whose sliding or hard clock ran out while nobody was watching.
--
-- THE CLAIM ABOVE CANNOT SEE THEM UNTIL THIS RUNS. A stalled session is still
-- `open`, and `claimed_partials` only collects `abandoned` or `revoked` ones — so
-- an upload the MR simply never returned to would leave its object in the bucket
-- indefinitely, past its retention date, with nothing claiming it. `begin_upload`
-- closes such a session only if the same MR asks for the same visit again, which by
-- definition they did not.
--
-- So the retention worker calls this FIRST, on every run, before claiming. See
-- services/api/scripts/purge-expired-audio.mjs.
create or replace function public.close_stale_upload_sessions()
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with closed as (
    update public.upload_grants
       set state = 'abandoned',
           closed_at = clock_timestamp(),
           closed_reason = 'the upload stopped making progress and its grant expired'
     where state = 'open'
       and (hard_expires_at <= now() or expires_at <= now())
    returning 1)
  select coalesce(count(*), 0)::integer from closed;
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

  elsif p_object_kind = 'upload_partial' then
    select g.visit_id,
           case when g.state = 'revoked' then 'withdrawal'::public.audio_destruction_reason
                else 'abandoned_upload'::public.audio_destruction_reason end,
           case when g.storage_key is null then null else public.sha256_hex(g.storage_key) end
      into v_visit, v_reason, v_hash
      from public.upload_grants g
     where g.id = p_object_id and g.purge_state <> 'destroyed';

    if not found then
      return;
    end if;

    -- The key is NOT nulled the way a recording's is: the grant row carries a
    -- unique-key index that the storage policy reads, and a null there would let a
    -- future grant reissue a path that once held audio. The row is dead either way
    -- — state is closed and purge_state is destroyed — and the log stores the hash
    -- rather than the path, as everywhere else.
    update public.upload_grants
       set purge_state = 'destroyed',
           destroyed_at = clock_timestamp()
     where id = p_object_id;

    insert into public.audio_destruction_log
      (run_id, object_kind, object_id, visit_id, reason, storage_key_hash, derived_rows_destroyed)
    values
      (p_run_id, 'upload_partial', p_object_id, v_visit, v_reason, v_hash, '{}'::jsonb);

  else
    raise exception 'unknown object kind %', p_object_kind using errcode = '22023';
  end if;

  update public.audio_purge_runs
     set destroyed_count = destroyed_count + 1
   where id = p_run_id;
end;
$$;

-- The log's kind check predates upload partials.
alter table public.audio_destruction_log
  drop constraint if exists audio_destruction_log_object_kind_check;

alter table public.audio_destruction_log
  add constraint audio_destruction_log_object_kind_check
    check (object_kind in ('recording', 'voice_note', 'upload_partial'));

-- Overdue partials belong in the health picture. An object nobody is counting is
-- the reason this function exists at all.
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
    'abandonedPartialCount', (select count(*) from public.upload_grants
                               where purge_state <> 'destroyed'
                                 and state in ('abandoned', 'revoked')),
    'openSessionCount',    (select count(*) from public.upload_grants where state = 'open'),
    -- The watchdog needs this to tell "the worker has stopped" from "there has
    -- never been anything for it to do". Without it, a brand-new deployment with no
    -- audio at all looks identical to one whose retention job died, and an alert
    -- that fires on day one is an alert everybody mutes by day three.
    'liveObjectCount',     (select count(*) from public.recordings where purge_state <> 'destroyed')
                         + (select count(*) from public.voice_notes where purge_state <> 'destroyed'),
    'stalled',             public.audio_purge_is_stalled(),
    'destroyedTotal',      (select count(*) from public.audio_destruction_log));
$$;

-- ----------------------------------------------------------------------------
-- 9. The queue an MR can read
-- ----------------------------------------------------------------------------

-- The audio entities finally arrive in sync. voice_note and recording were declared
-- in the BE-W4 enum and refused by apply_sync_item until the storage layer existed;
-- this is that layer.
--
-- Nothing about dead-lettering, attempt counting, per-item isolation or
-- reinstatement is re-implemented here. An upload is a queue item like any other, so
-- it inherits all of it — including a manager's ability to reverse a dead letter
-- with a mandatory reason.
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

    when 'recording', 'voice_note' then
      -- The bytes are already in storage; this is the finalisation. complete_upload
      -- re-checks consent one last time, so a withdrawal that arrived while the
      -- device was offline stops the row from ever being created.
      if nullif(p_payload ->> 'uploadGrantId', '') is null then
        raise exception 'a % item must carry its uploadGrantId', p_entity
          using errcode = '22023';
      end if;

      perform public.complete_upload(
        (p_payload ->> 'uploadGrantId')::uuid,
        p_entity_id,
        (p_payload ->> 'durationSeconds')::integer,
        (p_payload ->> 'sizeBytes')::bigint,
        coalesce((p_payload ->> 'recordedAt')::timestamptz, now()),
        nullif(p_payload ->> 'bitrateKbps', '')::integer);

    else
      raise exception 'entity % is not yet accepted by sync', p_entity
        using errcode = '0A000';
  end case;

  return v_warnings;
end;
$$;

-- The three new sentences. Each of these would otherwise have landed as
-- `validation_failed` — 'the server refused the contents of this item' — which is
-- untrue and unactionable for all three.
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
    when 'consent_withdrawn' then
      'The doctor withdrew consent for this visit, so the recording cannot be kept. '
      'You did nothing wrong and there is nothing to re-do.'
    when 'upload_expired' then
      'This upload was not finished in time and the recording was not kept. '
      'A recording has to reach the server within a day of being made.'
    else null
  end;
$$;

-- sync_push maps a raised error onto a code. Restated in full — Postgres has no way
-- to patch one branch of a CASE — with only the mapping changed.
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
        -- The two upload branches are matched on the message rather than on a
        -- SQLSTATE, because both are ordinary 42501 and 22023 conditions that
        -- already mean something else here. Each has its own test, so a reworded
        -- message breaks a build rather than quietly degrading an MR's explanation
        -- back to 'the server refused the contents of this item'.
        v_code := case
          when v_message ilike '%consent has been withdrawn%' then 'consent_withdrawn'
          when v_message ilike '%upload grant%expired%'       then 'upload_expired'
          when v_message ilike '%shift window%'               then 'outside_shift_window'
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

-- What the MR sees. One row per upload, in their own words, whether it is in flight,
-- landed, or refused — because queue state is their only evidence that the day's
-- work is safe.
create or replace function public.my_upload_queue(p_mr_id uuid default null)
returns table (
  upload_grant_id  uuid,
  visit_id         uuid,
  mr_id            uuid,
  kind             text,
  state            text,
  bytes_received   bigint,
  declared_bytes   bigint,
  percent_complete integer,
  expires_at       timestamptz,
  hard_expires_at  timestamptz,
  object_id        uuid,
  sync_status      public.sync_item_status,
  rejection_code   public.sync_rejection_code,
  explanation      text,
  attempts_remaining integer,
  was_reinstated   boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id,
         g.visit_id,
         g.mr_id,
         g.kind,
         g.state::text,
         g.bytes_received,
         g.max_bytes,
         least(100, floor(100.0 * g.bytes_received / nullif(g.max_bytes, 0))::integer),
         g.expires_at,
         g.hard_expires_at,
         e.entity_id,
         e.status,
         e.rejection_code,
         -- Every failure carries a reason a person can read. An error code alone
         -- makes an MR ring support to be told a sentence the server already knew.
         coalesce(e.explanation,
                  case g.state
                    when 'revoked'   then 'The doctor withdrew consent while this was uploading, so it was not kept.'
                    when 'abandoned' then 'This upload did not finish in time and was not kept.'
                    when 'open'      then 'Still uploading.'
                    else null
                  end),
         e.attempts_remaining,
         coalesce(e.was_reinstated, false)
    from public.upload_grants g
    left join public.sync_item_explained e
      on e.entity = g.kind::public.sync_entity_kind
     and e.payload ->> 'uploadGrantId' = g.id::text
   where g.mr_id in (select public.visible_user_ids())
     and (p_mr_id is null or g.mr_id = p_mr_id)
   order by g.issued_at desc;
$$;

comment on function public.my_upload_queue(uuid) is
  'Per-item upload state, attributed, with a reason on every failure. Rejections '
  'come from sync_item_explained rather than a second vocabulary — an upload is a '
  'queue item and inherits dead-lettering and reinstatement unchanged.';

-- ----------------------------------------------------------------------------
-- 10. Boundary
-- ----------------------------------------------------------------------------

revoke execute on function public.assert_upload_still_permitted(public.upload_grants)
  from public, anon, authenticated;
revoke execute on function public.close_stale_upload_sessions() from public, anon, authenticated;
revoke execute on function public.audio_storage_bytes(uuid)     from public, anon, authenticated;

grant execute on function public.begin_upload(uuid, text, bigint, integer)                      to authenticated;
grant execute on function public.resume_upload(uuid)                                            to authenticated;
grant execute on function public.record_upload_progress(uuid, bigint)                           to authenticated;
grant execute on function public.complete_upload(uuid, uuid, integer, bigint, timestamptz, integer) to authenticated;
grant execute on function public.abandon_upload(uuid, text)                                     to authenticated;
grant execute on function public.my_upload_queue(uuid)                                          to authenticated;
grant execute on function public.audio_purge_is_stalled()                                       to authenticated;
-- The storage policies call this, and a policy is evaluated as the caller.
grant execute on function public.has_live_upload_grant(text)                                    to authenticated;

-- The gateway reads redacted transcripts and nothing else. Restated for the new
-- surface so a future `grant all on all tables` cannot quietly hand it the upload
-- path, which knows every storage key in flight.
revoke all on table public.upload_grants from llm_gateway;
