-- Rollback for 20260815000300_audio_consent_retention.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- WARNING. This drops the consent-to-audio link, the destruction log and the
-- retention clock. Storage objects are NOT removed by it — a row delete does not
-- touch an object — so running this leaves audio in the bucket with nothing left
-- that knows it should be destroyed. Run the purge to completion first.

drop function if exists public.audio_purge_health();
drop function if exists public.finish_audio_purge_run(uuid, integer);
drop function if exists public.record_audio_purge_failure(uuid, text);
drop function if exists public.confirm_audio_destroyed(uuid, text, uuid);
drop function if exists public.claim_expired_audio(uuid, integer);

drop view if exists public.visit_recording_status;

drop trigger if exists consent_records_cascade_withdrawal on public.consent_records;
drop function if exists public.cascade_consent_withdrawal();

drop trigger if exists audio_destruction_log_reject_mutation on public.audio_destruction_log;
drop table if exists public.audio_destruction_log;
drop table if exists public.audio_purge_runs;

drop table if exists public.transcripts_redacted;
drop table if exists public.transcripts_raw;

-- The role is dropped last, after everything it could hold a grant on is gone.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'llm_gateway') then
    execute 'revoke all on schema public from llm_gateway';
    execute 'revoke llm_gateway from postgres';
    execute 'drop role llm_gateway';
  end if;
end
$$;

-- The storage policy references upload_grants, so it is dropped before the table it
-- depends on. Postgres reports that as a dependency error rather than cascading.
drop policy if exists audio_no_public_read              on storage.objects;
drop policy if exists audio_insert_requires_live_grant  on storage.objects;

-- The bucket and its objects are deliberately NOT removed here. Supabase refuses a
-- SQL delete of storage rows — "this prevents accidental data loss from orphaned
-- objects" — and it is right to: deleting the row would leave the file behind in
-- the storage backend with nothing left that knows it exists.
--
-- Empty the bucket through the storage API first, which is what
-- scripts/purge-expired-audio.mjs does, then drop it by hand:
--
--   pnpm --filter @elmiron/api purge:audio
--   -- then, once it reports nothing left:
--   delete from storage.buckets where id = 'audio';

drop function if exists public.issue_recording_upload_grant(uuid, bigint, integer);
drop table if exists public.upload_grants;

drop trigger if exists recordings_require_consent  on public.recordings;
drop function if exists public.require_consent_for_recording();

drop trigger if exists voice_notes_stamp_retention on public.voice_notes;
drop trigger if exists recordings_stamp_retention  on public.recordings;
drop function if exists public.stamp_audio_retention();

drop table if exists public.voice_notes;
drop table if exists public.recordings;

drop type if exists public.audio_purge_state;
drop type if exists public.audio_destruction_reason;
drop type if exists public.upload_state;

drop function if exists public.capture_consent(uuid, uuid, public.consent_outcome, text, text, timestamptz);
drop function if exists public.active_consent_text(text);
