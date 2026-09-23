-- ============================================================================
-- MR-52 C1 -- BE-W111: the stored object is named for what it actually contains.
-- ============================================================================
--
-- `begin_upload` named every object `.opus`, `recordings.codec` defaulted to `'opus'` and both
-- `storage_key` CHECKs demanded that suffix. The phone records **AAC in an MP4 container**
-- (`expo-audio`'s `RecordingPresets.HIGH_QUALITY` on Android writes `.m4a`), which MR-51 D uploaded
-- with `contentType: audio/mp4` -- so Storage held the true type beside a key that said otherwise.
--
-- **Why this is not cosmetic.** The key is what a transcription vendor is handed. A vendor that
-- believes the extension will either refuse the file or decode it as Opus and return noise, and the
-- failure would look like a bad recording rather than a bad name. `C7` keeps the AI layer, so this
-- is on the path to the first bake-off (`BE-W32`).
--
-- WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT:
--
--   * `begin_upload` mints `.m4a`, because that is what the only producer writes.
--   * Both CHECKs accept `.opus` OR `.m4a`. Widened rather than swapped: rows already stored under
--     the old name are still valid, and `analysis_overrides`-style history is not rewritten. MR-51's
--     three uploaded objects carry `.opus` keys and keep working.
--   * `recordings.codec` accepts `aac` as well as `opus`, and DEFAULTS to `aac` -- `complete_upload`
--     inserts without naming it, so the default is what a recording would claim. No recording row
--     exists yet (the feature is unbuilt under `C3`), so nothing is restated by this.
--
-- **What is still owed, and registered rather than guessed:** when a second container genuinely
-- exists, the format belongs in `begin_upload`'s arguments -- the caller says what it is about to
-- send and the server decides whether that is allowed. One producer writing one container does not
-- justify that signature change today.
--
-- Rollback: services/api/rollbacks/20260923000200_audio_container_named_truthfully.down.sql

alter table public.voice_notes drop constraint voice_notes_storage_key_check;
alter table public.voice_notes add constraint voice_notes_storage_key_check
  check (storage_key is null
         or storage_key ~ '^voice-notes/[0-9a-f-]{36}/[0-9a-f-]{36}\.(opus|m4a)$');

alter table public.recordings drop constraint recordings_storage_key_check;
alter table public.recordings add constraint recordings_storage_key_check
  check (storage_key is null
         or storage_key ~ '^recordings/[0-9a-f-]{36}/[0-9a-f-]{36}\.(opus|m4a)$');

alter table public.recordings drop constraint recordings_codec_check;
alter table public.recordings add constraint recordings_codec_check
  check (codec in ('opus', 'aac'));
alter table public.recordings alter column codec set default 'aac';

-- Only the extension changes. Every check, ceiling and expiry below is the live definition's.
CREATE OR REPLACE FUNCTION public.begin_upload(p_visit_id uuid, p_kind text, p_size_bytes bigint, p_duration_seconds integer)
 RETURNS upload_grants
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
       -- MR-52 C1 / BE-W111: the container the phone actually writes.
       || gen_random_uuid()::text || '/' || gen_random_uuid()::text || '.m4a',
     p_size_bytes, p_duration_seconds, now() + c_slide, now() + c_hard)
  returning * into v_row;

  return v_row;
end;
$function$;

do $$
declare
  v_def text := pg_get_functiondef('public.begin_upload(uuid, text, bigint, integer)'::regprocedure);
begin
  if position('''.m4a''' in v_def) = 0 then
    raise exception 'MR-52 C1: begin_upload does not mint the real container';
  end if;
  if position('''.opus''' in v_def) > 0 then
    raise exception 'MR-52 C1: begin_upload still mints .opus';
  end if;

  -- Both names remain STORABLE, or the objects MR-51 uploaded stop being valid rows.
  if not exists (
    select 1 from pg_constraint
     where conname = 'voice_notes_storage_key_check'
       and pg_get_constraintdef(oid) like '%(opus|m4a)%'
  ) then
    raise exception 'MR-52 C1: voice_notes_storage_key_check does not accept both names';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'recordings_codec_check' and pg_get_constraintdef(oid) like '%aac%'
  ) then
    raise exception 'MR-52 C1: recordings_codec_check does not accept aac';
  end if;
end;
$$;
