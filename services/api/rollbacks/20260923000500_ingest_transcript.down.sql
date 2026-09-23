-- Rollback for MR-53 D1 -- removes the only door a TranscriptV1 has. The tables stay: they predate
-- this (MR-14) and the withdrawal cascade deletes from them.

drop function if exists public.ingest_transcript(jsonb);
