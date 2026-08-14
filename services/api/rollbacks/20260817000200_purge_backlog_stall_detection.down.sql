-- Rollback for 20260817000200_purge_backlog_stall_detection.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- app_thresholds is append-only (see 20260817000100's rollback for the same
-- reasoning): the new purge_batch_limit, purge_backlog_multiplier and
-- purge_max_silence_hours rows cannot be DELETEd by any role. They are inert
-- once the function below is restored to its pre-BE-W8-addendum body, and are
-- permanently removed only when 20260815000100's rollback drops the whole
-- app_thresholds table, later in the reverse-migration-order sequence.
--
-- audio_purge_health() is untouched by the forward migration and needs no
-- restoration here -- it already called audio_purge_is_stalled() dynamically
-- (wired up in 20260816000300_resumable_upload.sql), so restoring that one
-- function is sufficient; audio_purge_health()'s `stalled` field picks up the
-- restored definition automatically.

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
