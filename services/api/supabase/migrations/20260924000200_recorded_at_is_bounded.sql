-- ============================================================================
-- MR-54 - `BE-W96` - `recorded_at` stops being the device's unbounded word
-- ============================================================================
--
-- **The asymmetry.** `capture_consent` bounds `captured_at` in both directions: no capture
-- after the server clock beyond a tolerance (45007, FIX-12 with MR-05 B1's tolerance), and
-- none older than `consent_max_sync_lag_hours` (45008). `complete_upload.p_recorded_at` had
-- NEITHER, so a finalised upload could claim any date, past or future.
--
-- **Why it is more than a wrong-looking date.** `recorded_at` is what a coaching queue
-- orders by, what any later citation of a consultation points at, and what a reader uses to
-- reason about when audio of a named doctor was taken. A recording that claims to predate
-- its own consent, or to have happened next Tuesday, is a record of a real conversation
-- filed under a time that never happened.
--
-- **Two new codes, not the consent ones.** `45009` and `45010` mirror `45007`/`45008` in
-- meaning but are distinct, because the client maps a SQLSTATE straight to a sentence and
-- `45007` says *"your consent was captured in the future"*. Telling a rep their consent was
-- refused when their recording was is precisely the one-sentence-for-four-codes defect that
-- `refusalForSqlState` was built to end. `error-contract.spec.ts` asserts, live from
-- `pg_proc.prosrc`, that every code the database raises is in the client contract, so
-- minting these without adding them to `BY_SQLSTATE` fails CI. That is the point.
--
-- **The thresholds are the consent ones, reused.** Both bound one device's clock. Two
-- unverified numbers for one question is how the one nobody remembers drifts. The caveat is
-- that the keys are NAMED for consent; if audio must ever differ, that is a new dated row.
--
-- **What this does not change:** a refusal here leaves the bytes already in Storage and the
-- grant open until it expires, exactly as the existing size and duration refusals do. That
-- orphan is older than this change and is not addressed by it.
--
-- Rollback: services/api/rollbacks/20260924000200_recorded_at_is_bounded.down.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.complete_upload(p_grant_id uuid, p_object_id uuid, p_duration_seconds integer, p_size_bytes bigint, p_recorded_at timestamp with time zone, p_bitrate_kbps integer DEFAULT 28)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid     uuid;
  v_grant   public.upload_grants%rowtype;
  v_consent public.consent_records%rowtype;
  v_observed_bytes bigint;
  -- MR-54 `BE-W96`
  v_tolerance numeric;
  v_max_lag   numeric;
  v_age       interval;
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

  -- `FE-W46`, MR-37 B2. THE SIZE IS THE SERVER'S OBSERVATION, NOT THE CLIENT'S CLAIM.
  --
  -- The bytes have already landed in Storage by the time this runs, and Storage records how
  -- many arrived: `storage.objects.metadata ->> 'size'`, written from the request it actually
  -- received. Measured on the local stack, 118 of 118 objects carry that key.
  --
  -- `p_size_bytes` is therefore a claim about a fact the server already holds, and the ceiling
  -- it used to feed is a limit on the very client making the claim. The field app has been
  -- sending a literal `1` since the recording screen was written, because the real count was
  -- not available to it -- so every row is worth one byte and `audio_storage_bytes()` sums
  -- exactly those columns. This is the same correction `capture_consent` and `record_check_in`
  -- were both rewritten around: if the server knows, the server decides.
  --
  -- The parameter is kept so the signature, its grants and every caller are unchanged. It is
  -- now ignored for the stored value, which is why no client has to ship for this to take
  -- effect.
  select (o.metadata ->> 'size')::bigint
    into v_observed_bytes
    from storage.objects o
   where o.bucket_id = 'audio'
     and o.name = v_grant.storage_key;

  -- A precondition, asserted rather than assumed. Finalising an upload for which nothing was
  -- ever stored writes a row claiming bytes that do not exist -- and the old version allowed
  -- exactly that, because it never looked.
  if v_observed_bytes is null then
    raise exception 'nothing has been stored at %, so there is nothing to finalise',
      v_grant.storage_key
      using errcode = '22023',
            hint = 'Upload the audio before finalising it. If the upload failed, begin it again.';
  end if;

  if v_observed_bytes <= 0 or v_observed_bytes > v_grant.max_bytes then
    raise exception 'the finalised size % does not fit the grant''s % bytes',
      v_observed_bytes, v_grant.max_bytes using errcode = '22023';
  end if;

  if p_duration_seconds is null or p_duration_seconds <= 0
     or p_duration_seconds > v_grant.max_duration_seconds then
    raise exception 'the finalised duration % does not fit the grant''s % seconds',
      p_duration_seconds, v_grant.max_duration_seconds using errcode = '22023';
  end if;

  -- ---- MR-54 `BE-W96`: recorded_at is the DEVICE's word, and it is now bounded ------
  --
  -- `capture_consent` has bounded `captured_at` in both directions since FIX-12 and MR-05
  -- B1. `recorded_at` had neither bound, so a finalised upload could claim any date, past
  -- or future -- and it is the timestamp the retention reasoning, the coaching queue and
  -- any later citation all read.
  --
  -- **The thresholds are the consent ones, reused deliberately.** Both bound the same
  -- physical thing: one device's clock, on one phone, in one rep's pocket. Minting
  -- `audio_future_tolerance_seconds` beside `consent_future_tolerance_seconds` would give
  -- the operator two unverified numbers to ratify for one question, and the one nobody
  -- remembers is the one that drifts (the MR-52 D4 argument). **The caveat, said rather
  -- than left to be discovered: the keys are NAMED for consent.** If the operator ever
  -- needs audio to differ, that is a new dated row and a change here, not a silent edit.
  if p_recorded_at is null then
    raise exception 'a finalised upload must say when it was recorded' using errcode = '22023';
  end if;

  v_tolerance := coalesce(
    public.threshold_number('consent_future_tolerance_seconds', null, null), 0);
  if p_recorded_at > now() + make_interval(secs => v_tolerance) then
    -- 45009, not 45007. The client maps 45007 to a sentence about a CONSENT, and telling a
    -- rep their consent was refused when their recording was is the exact defect that
    -- `refusalForSqlState` exists to end.
    raise exception 'audio cannot be recorded in the future'
      using errcode = '45009',
            detail = format(
              'recorded_at %s is more than %s seconds after the server clock %s',
              p_recorded_at, v_tolerance::integer, now()),
            hint   = 'The device clock is ahead of the server. Correct it and send again; '
                     'nothing is wrong with the recording itself.';
  end if;

  v_age := now() - p_recorded_at;
  -- Territory-scoped like every other threshold, resolved through the MR's own profile.
  v_max_lag := public.threshold_number(
    'consent_max_sync_lag_hours',
    (select p.territory_id from public.user_profiles p where p.id = v_uid),
    null);
  if v_max_lag is not null and v_age > make_interval(hours => v_max_lag::integer) then
    raise exception 'this recording is older than the server will accept on the device''s word'
      using errcode = '45010',
            detail = format('recorded %s ago, the maximum is %s hours', v_age, v_max_lag::integer),
            hint   = 'Sync sooner. This one cannot be filed on the device''s word, and it '
                     'will not become acceptable by waiting.';
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
       coalesce(p_bitrate_kbps, 28), p_duration_seconds, v_observed_bytes, 'uploaded',
       p_recorded_at, now())
    on conflict (id) do nothing;
  else
    insert into public.voice_notes
      (id, visit_id, mr_id, storage_key, duration_seconds, size_bytes,
       upload_status, recorded_at, purge_after)
    values
      (p_object_id, v_grant.visit_id, v_uid, v_grant.storage_key,
       p_duration_seconds, v_observed_bytes, 'uploaded', p_recorded_at, now())
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
$function$;


-- The guard: both codes must actually be raised by the function this migration just wrote,
-- and the rule it already carried must survive the replacement. A `create or replace` that
-- quietly restored an older body would otherwise pass unnoticed.
do $$
declare
  v_src text;
begin
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_upload';

  if v_src is null then
    raise exception 'BE-W96: complete_upload is missing';
  end if;
  if position('45009' in v_src) = 0 or position('45010' in v_src) = 0 then
    raise exception 'BE-W96: complete_upload does not raise both new codes';
  end if;
  if position('metadata' in v_src) = 0 then
    raise exception
      'BE-W96: complete_upload no longer reads the size Storage observed, so the '
      'replacement has dropped MR-37 B2.';
  end if;
end;
$$;
