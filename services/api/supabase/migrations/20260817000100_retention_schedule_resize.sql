-- ============================================================================
-- BE-W8 · Retention schedule resize
--
-- Part 3.1 measured the purge locally: 5,000 objects drain in 50 runs of ~591ms
-- each at a batch of 100 -- the database is not the bottleneck. The daily cron was.
--
-- Arithmetic against the stated pilot size: 100 MRs x 8 visits/day, each visit
-- producing a doctor recording and an MR voice note, is ~1,600 audio objects/day.
-- At day 90 those start expiring at the same rate they were created. A daily cron
-- at a batch of 100 drains 100/day against an arrival rate of ~1,600/day -- under-
-- provisioned by roughly 16x, on day 91, by arithmetic rather than by accident.
--
-- The failure mode is not silent non-compliance: begin_upload refuses new audio
-- once objects are past purge_after by more than purge_max_silence_hours, so the
-- backstop fires correctly. But it fires for every MR in the fleet at once, three
-- months into the pilot, which is not a discovery anyone wants to make in
-- production. .github/workflows/retention.yml moves to an hourly cron at the same
-- batch of 100 -- 2,400/day against ~1,600/day arrival, 1.5x headroom, and a failed
-- run now costs an hour of drain instead of a day.
--
-- This threshold moves with it. It was seeded at 48 hours (two missed DAILY runs)
-- in 20260816000300_resumable_upload.sql. Two missed HOURLY runs is 2 hours; 3
-- hours keeps that margin plus buffer for ordinary GitHub Actions scheduling
-- jitter, which has already been observed to run 1h46m after its nominal time.
-- app_thresholds is append-only: this is a new row with a later effective_from,
-- not an edit, so the history of what the threshold was before this migration
-- survives.
--
-- Rollback: services/api/rollbacks/20260817000100_retention_schedule_resize.down.sql
-- ============================================================================

insert into public.app_thresholds (key, value, unit, note) values
  ('purge_max_silence_hours', '3'::jsonb, 'hours',
   'BE-W8: the purge cron moved from daily to hourly (see retention.yml) after '
   'Part 3.1 found the daily cadence under-provisioned by ~16x against the stated '
   'pilot arrival rate of ~1,600 audio objects/day. Two missed hourly runs plus '
   'buffer for scheduling jitter.');
