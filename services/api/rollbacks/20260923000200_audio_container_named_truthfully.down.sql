-- Rollback for MR-52 C1 -- restores the .opus naming and the single-codec CHECK, and with them the
-- defect: an AAC/MP4 object named as if it were Opus.
--
-- NOTE: a row stored under a `.m4a` key while the migration was applied violates the narrowed
-- CHECK. The constraint is therefore restored NOT VALID -- existing rows are left alone and new
-- ones are checked -- because a rollback that cannot run is not a rollback.

alter table public.voice_notes drop constraint voice_notes_storage_key_check;
alter table public.voice_notes add constraint voice_notes_storage_key_check
  check (storage_key is null
         or storage_key ~ '^voice-notes/[0-9a-f-]{36}/[0-9a-f-]{36}\.opus$') not valid;

alter table public.recordings drop constraint recordings_storage_key_check;
alter table public.recordings add constraint recordings_storage_key_check
  check (storage_key is null
         or storage_key ~ '^recordings/[0-9a-f-]{36}/[0-9a-f-]{36}\.opus$') not valid;

alter table public.recordings drop constraint recordings_codec_check;
alter table public.recordings add constraint recordings_codec_check check (codec = 'opus') not valid;
alter table public.recordings alter column codec set default 'opus';

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
       || gen_random_uuid()::text || '/' || gen_random_uuid()::text || '.opus',
     p_size_bytes, p_duration_seconds, now() + c_slide, now() + c_hard)
  returning * into v_row;

  return v_row;
end;
$function$;

