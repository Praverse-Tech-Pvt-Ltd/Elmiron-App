-- Rollback for 20260816000500_adverse_events.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- READ THIS BEFORE RUNNING IT.
--
-- `adverse_event_reports` holds statutory records. IPC Pharmacovigilance Guidance
-- for MAHs v2.0 §2.8 gives fifteen calendar days from receipt to report a serious
-- adverse event, and the whole reason the table is append-only against every role
-- including service_role is that nothing should be able to make one disappear.
--
-- Dropping the table makes them disappear.
--
-- EXPORT ITS CONTENTS FIRST if there is any chance a real report is in it. A
-- rollback is an engineering operation; destroying a pharmacovigilance record is
-- not, and this file cannot tell the difference between the two situations it might
-- be run in.
--
--   \copy (select * from public.adverse_event_reports) to 'ae-reports.csv' csv header
--
-- The drop below is unguarded on purpose. A rollback that silently refuses to run is
-- worse than one that says plainly what it will destroy.

drop function if exists public.adverse_event_clock_summary();
drop view if exists public.adverse_event_clock;

drop function if exists public.ingest_detected_adverse_event(uuid, uuid, uuid, uuid);
drop function if exists public.report_adverse_event(uuid, uuid, text, timestamptz);

drop trigger if exists adverse_event_reports_audit           on public.adverse_event_reports;
drop trigger if exists adverse_event_reports_reject_mutation on public.adverse_event_reports;
drop trigger if exists adverse_event_reports_stamp_clock     on public.adverse_event_reports;

drop table if exists public.adverse_event_reports;

drop function if exists public.stamp_adverse_event_clock();
drop type if exists public.adverse_event_source;

-- The BE-W6 comment, restored. It justified the ninety-day purge on voice notes by
-- symmetry with recordings; BE-W7 replaced that with the exposure argument, which is
-- the stronger one and is what the reviewer asked for.
comment on table public.voice_notes is
  'The MR''s own post-visit note. Requires no doctor consent — it involves no third '
  'party — but carries the same 90-day retention, because it is still audio.';
