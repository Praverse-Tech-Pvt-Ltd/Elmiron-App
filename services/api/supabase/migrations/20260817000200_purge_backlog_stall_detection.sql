-- ============================================================================
-- BE-W8 (addendum) · Backlog-based stall detection
--
-- audio_purge_is_stalled() trips on a SINGLE object overdue by more than
-- purge_max_silence_hours. That conflates "the worker is dead" with "the worker
-- is alive but briefly behind on a busy hour" -- and with an hourly cron and a
-- 3-hour threshold, two consecutive GitHub Actions scheduling delays (already
-- observed: 1h46m on a nominal-to-actual gap) are enough to trip it under
-- ordinary load, refusing new audio for the WHOLE fleet.
--
-- (`public.audio_purge_health()` already returns `stalled` and `liveObjectCount`
-- correctly, wired up in 20260816000300_resumable_upload.sql -- that part was
-- never broken. Corrected here after an earlier draft of this migration wrongly
-- claimed it was, from reading only the first `create or replace` of that
-- function and missing the later one.)
--
-- The fix separates two signals that were conflated into one number:
--
--   PRIMARY   (drives begin_upload's refusal, via audio_purge_is_stalled()):
--             backlog size relative to what one run can clear -- more than
--             purge_backlog_multiplier runs' worth of overdue objects sitting
--             unclaimed. This is what "the worker cannot keep up" actually
--             means; a single unlucky object at the back of a busy queue is not
--             that.
--   SECONDARY (a hard ceiling, catches a worker that is truly dead even with a
--             small fleet where the backlog never gets numerically large):
--             purge_max_silence_hours, loosened 3 -> 12. Two missed runs of a
--             genuinely-stopped hourly worker trips this in 2h; 12h is the
--             reviewer's instruction and gives real margin against scheduling
--             jitter while still catching a dead worker well inside a day.
--
-- Also moves the purge batch limit (100) out of a hardcoded JS constant and
-- into app_thresholds, so growing the fleet past the pilot size is a threshold
-- row rather than a code change and a deploy.
--
-- Rollback: services/api/rollbacks/20260817000200_purge_backlog_stall_detection.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. New thresholds. app_thresholds is append-only: these are new rows, and the
--    purge_max_silence_hours row from 20260817000100 is superseded by a later
--    effective_from, not edited.
-- ----------------------------------------------------------------------------

insert into public.app_thresholds (key, value, unit, note) values
  ('purge_batch_limit', '250'::jsonb, 'count',
   'How many objects the retention worker claims per run. Was a hardcoded JS '
   'constant (100); moved here so growing the fleet is a threshold row, not a '
   'code change and a deploy. 250/hour is 3.75x the pilot''s stated arrival rate '
   'of ~1,600 objects/day, and survives the pilot doubling in size unnoticed.'),
  ('purge_backlog_multiplier', '3'::jsonb, 'ratio',
   'The PRIMARY stall signal: more than this many runs'' worth of overdue '
   'objects sitting unclaimed means the worker cannot keep up, not that one '
   'object was unlucky. At batch 250 this is 750 objects backlogged before '
   'begin_upload refuses new audio.'),
  ('purge_max_silence_hours', '12'::jsonb, 'hours',
   'BE-W8 addendum: this is now the SECONDARY signal only -- a hard ceiling on '
   'any single object''s age, catching a genuinely dead worker even when the '
   'fleet is too small for the backlog count to trip purge_backlog_multiplier. '
   'Loosened from 3h (itself loosened from the original 48h daily-cron value) '
   'because a per-object age check that tight trips on ordinary GitHub Actions '
   'scheduling jitter against an hourly cron, refusing the whole fleet for a '
   'delay rather than a real stall.');

-- ----------------------------------------------------------------------------
-- 2. Redefine the stall check. Same name, same signature, same callers
--    (begin_upload via assert_upload_still_permitted, and audio_purge_health()
--    via its own call to this function) -- only the definition of "stalled"
--    changes. Both callers pick up the new semantics automatically.
-- ----------------------------------------------------------------------------

create or replace function public.audio_purge_is_stalled()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_batch_limit  integer := coalesce(public.threshold_number('purge_batch_limit', null, 100)::integer, 100);
  v_multiplier   numeric := coalesce(public.threshold_number('purge_backlog_multiplier', null, 3), 3);
  v_ceiling_hrs  integer := coalesce(public.threshold_number('purge_max_silence_hours', null, 12)::integer, 12);
  v_overdue      bigint;
  v_oldest_age   interval;
begin
  select count(*), max(now() - purge_after)
    into v_overdue, v_oldest_age
    from (
      select purge_after from public.recordings
       where purge_state <> 'destroyed' and purge_after <= now()
      union all
      select purge_after from public.voice_notes
       where purge_state <> 'destroyed' and purge_after <= now()
    ) overdue;

  return coalesce(v_overdue, 0) > (v_batch_limit * v_multiplier)
      or coalesce(v_oldest_age, interval '0') > make_interval(hours => v_ceiling_hrs);
end;
$$;

comment on function public.audio_purge_is_stalled() is
  'True when the backlog exceeds several runs'' worth of claim capacity (the '
  'worker cannot keep up), OR the single oldest overdue object exceeds a hard '
  'silence ceiling (the worker is dead even with a small backlog). Checked on '
  'the upload path: if either fires, intake stops. BE-W8 addendum: previously a '
  'single-object trip-wire that conflated ordinary catch-up lag with a genuine '
  'stall.';
