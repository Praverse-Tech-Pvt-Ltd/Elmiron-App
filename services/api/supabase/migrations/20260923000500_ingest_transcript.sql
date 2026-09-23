-- ============================================================================
-- MR-53 D1 -- a TranscriptV1 can be written, by a service identity, for a recording.
-- ============================================================================
--
-- `TranscriptV1` has existed since MR-50 B and nothing could write one. The TABLES have existed
-- since MR-14: `transcripts_raw` (visit, recording XOR voice note, language, vendor, model_version,
-- segments jsonb) and `transcripts_redacted` beneath it -- which is why the withdrawal cascade
-- already deletes transcripts. Their shape governs; this adds the door, not a new room.
--
-- **WHO MAY CALL IT: a service identity, and nobody else.** A transcript is not something a rep or
-- a manager produces; it arrives from a speech vendor through a job. `authenticated` is not granted
-- EXECUTE at all, so an MR and an admin -- of any organisation -- are refused by the grant before
-- any row is read. `service_role` bypasses RLS by design and is the identity a worker runs as.
--
-- **WHAT IT REFUSES, and why these and not others (D3).** The failures a vendor actually produces:
-- spans that run past the end of the audio (a segmenter that padded the tail), and segments that
-- overlap (two speakers diarised onto one timeline). Both are silent corruption if stored: a
-- citation would point at a moment that does not exist, and `FindingCitation` is what a manager
-- reads before deciding about somebody's job.
--
-- **AND IT REFUSES A WITHDRAWN CONSENT (D5).** `cascade_consent_withdrawal` destroys transcripts
-- that exist when the doctor changes their mind; without this check a job in flight would write a
-- new one afterwards, and the destruction log would say the audio was destroyed while its words sat
-- in a table. The recording being gone is not enough on its own -- the row survives, marked for
-- destruction, until the purge worker runs.
--
-- Not built, deliberately (D4): any vendor client. There is no vendor and no corpus; that is
-- `BE-W32`, and it waits on the operator.
--
-- Rollback: services/api/rollbacks/20260923000500_ingest_transcript.down.sql

CREATE OR REPLACE FUNCTION public.ingest_transcript(p_transcript jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_source_kind text;
  v_recording   public.recordings%rowtype;
  v_voice_note  public.voice_notes%rowtype;
  v_visit_id    uuid;
  v_duration_ms integer;
  v_segments    jsonb;
  v_id          uuid;
  v_previous_end integer := -1;
  v_segment     jsonb;
  v_audit_id    bigint;
begin
  -- Shape first. Every later check reads these, and a missing key must be a named refusal rather
  -- than a null propagating into a comparison that quietly passes.
  if p_transcript is null or jsonb_typeof(p_transcript) <> 'object' then
    raise exception 'a transcript must be a JSON object' using errcode = '22023';
  end if;
  if p_transcript ->> 'schemaVersion' is distinct from 'v1' then
    raise exception 'unsupported transcript schemaVersion %', p_transcript ->> 'schemaVersion'
      using errcode = '22023',
            hint = 'This server accepts TranscriptV1. A vendor sending anything else is a bug.';
  end if;

  v_id := nullif(p_transcript ->> 'id', '')::uuid;
  v_source_kind := p_transcript #>> '{source,kind}';
  v_duration_ms := nullif(p_transcript ->> 'durationMs', '')::integer;
  v_segments := p_transcript -> 'segments';

  if v_id is null then
    raise exception 'a transcript must carry its own id' using errcode = '22023';
  end if;
  if v_duration_ms is null or v_duration_ms < 0 then
    raise exception 'durationMs must be a non-negative whole number' using errcode = '22023';
  end if;
  if v_segments is null or jsonb_typeof(v_segments) <> 'array' then
    raise exception 'segments must be an array' using errcode = '22023';
  end if;

  -- The source decides which table the audio is in, and the CHECK on `transcripts_raw` insists on
  -- exactly one of them.
  if v_source_kind = 'recording' then
    select * into v_recording from public.recordings r
     where r.id = (p_transcript #>> '{source,recordingId}')::uuid;
    if not found then
      raise exception 'recording % has no row', p_transcript #>> '{source,recordingId}'
        using errcode = '42501';
    end if;
    v_visit_id := v_recording.visit_id;

    -- D5. The withdrawal wins, whatever a job already in flight believes.
    if public.standing_consent_for_visit(v_visit_id) is null then
      raise exception 'consent for visit % is not standing; no transcript may be written', v_visit_id
        using errcode = '42501',
              hint = 'A withdrawal destroys transcripts. Writing one afterwards would restore what '
                     'the destruction log says was destroyed.';
    end if;

    if v_recording.purge_state = 'destroyed' then
      raise exception 'recording % has been destroyed', v_recording.id using errcode = '42501';
    end if;

    -- The audio's own length bounds every span below.
    if v_duration_ms > (v_recording.duration_seconds * 1000) then
      raise exception 'the transcript is % ms long but the recording is % ms',
        v_duration_ms, v_recording.duration_seconds * 1000 using errcode = '22023';
    end if;

  elsif v_source_kind = 'voice_note' then
    select * into v_voice_note from public.voice_notes v
     where v.id = (p_transcript #>> '{source,voiceNoteId}')::uuid;
    if not found then
      raise exception 'voice note % has no row', p_transcript #>> '{source,voiceNoteId}'
        using errcode = '42501';
    end if;
    v_visit_id := v_voice_note.visit_id;
    if v_duration_ms > (v_voice_note.duration_seconds * 1000) then
      raise exception 'the transcript is % ms long but the voice note is % ms',
        v_duration_ms, v_voice_note.duration_seconds * 1000 using errcode = '22023';
    end if;
  else
    raise exception 'unknown transcript source %', coalesce(v_source_kind, '(none)')
      using errcode = '22023';
  end if;

  -- The visit the transcript claims must be the audio's own visit. A transcript filed against
  -- another visit would attach one doctor's words to another's record.
  if (p_transcript ->> 'visitId')::uuid is distinct from v_visit_id then
    raise exception 'the transcript names visit % but the audio belongs to visit %',
      p_transcript ->> 'visitId', v_visit_id using errcode = '22023';
  end if;

  -- D3. Spans, in index order: inside the audio, ordered, and not overlapping.
  for v_segment in
    select value from jsonb_array_elements(v_segments)
     order by (value ->> 'index')::integer
  loop
    if (v_segment ->> 'startMs')::integer > (v_segment ->> 'endMs')::integer then
      raise exception 'segment % ends before it starts', v_segment ->> 'id' using errcode = '22023';
    end if;
    if (v_segment ->> 'endMs')::integer > v_duration_ms then
      raise exception 'segment % ends at % ms, past the end of % ms audio',
        v_segment ->> 'id', v_segment ->> 'endMs', v_duration_ms using errcode = '22023';
    end if;
    if (v_segment ->> 'startMs')::integer < v_previous_end then
      raise exception 'segment % starts at % ms, inside the segment before it',
        v_segment ->> 'id', v_segment ->> 'startMs' using errcode = '22023';
    end if;
    v_previous_end := (v_segment ->> 'endMs')::integer;
  end loop;

  -- Every read and write of audio-derived content is logged; this is a write.
  insert into public.audit_log
    (actor_id, actor_role, action, table_name, row_id, reason, request_id, ip_address, occurred_at)
  values
    ((select auth.uid()), public.current_app_role(), 'insert', 'transcripts_raw', v_id::text,
     'transcript ingested from ' || coalesce(p_transcript ->> 'vendor', '(no vendor)'),
     public.current_request_id(), public.current_client_ip(), clock_timestamp())
  returning id into v_audit_id;

  insert into public.transcripts_raw
    (id, visit_id, recording_id, voice_note_id, language, vendor, model_version, segments)
  values
    (v_id, v_visit_id,
     case when v_source_kind = 'recording' then v_recording.id end,
     case when v_source_kind = 'voice_note' then v_voice_note.id end,
     p_transcript ->> 'primaryLanguage',
     p_transcript ->> 'vendor',
     p_transcript ->> 'modelVersion',
     v_segments)
  -- Idempotent: a vendor job that retries after a lost acknowledgement must not double-write.
  on conflict (id) do nothing;

  return jsonb_build_object('transcriptId', v_id, 'visitId', v_visit_id,
                            'segments', jsonb_array_length(v_segments), 'auditLogId', v_audit_id);
end;
$function$;

-- A transcript arrives from a job, never from a phone or a console.
revoke all on function public.ingest_transcript(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_transcript(jsonb) to service_role;

do $$
begin
  if has_function_privilege('authenticated', 'public.ingest_transcript(jsonb)', 'execute') then
    raise exception 'MR-53 D2: ingest_transcript is callable by a signed-in user';
  end if;
  if has_function_privilege('anon', 'public.ingest_transcript(jsonb)', 'execute') then
    raise exception 'MR-53 D2: ingest_transcript is callable by anon';
  end if;
  if not has_function_privilege('service_role', 'public.ingest_transcript(jsonb)', 'execute') then
    raise exception 'MR-53 D2: the service identity cannot call ingest_transcript';
  end if;

  -- A precondition this guard asserts about itself: the table it writes must exist with the
  -- column set this function names, or every refusal above would be untested reasoning.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'transcripts_raw' and column_name = 'segments'
  ) then
    raise exception 'MR-53 D1: transcripts_raw.segments is missing';
  end if;
end;
$$;
