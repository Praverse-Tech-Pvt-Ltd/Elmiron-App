-- `BE-W189` -- the retention worker's status, for an admin, read-only.
--
-- **What existed.** `retention_status()` (`BE-W15`) gives the compliance panel four figures: the
-- period and the company's live, overdue and destroyed recordings. The worker that makes the period
-- true (`purge-expired-audio.mjs`, hourly from `retention.yml`) recorded every run in
-- `audio_purge_runs`, and the watchdog (`check-purge-health.mjs`) read them through
-- `audio_purge_health()` -- which is granted to nobody (MR-46 B3) because it counts every company.
-- So no admin could see whether the worker was running at all.
--
-- **What this returns, and what it deliberately does not.**
--   * The PERIOD and the worker's THRESHOLDS: properties of the system, the same for every company,
--     read from the functions and settings that enforce them -- never restated here.
--   * The worker's RUNS: when each started and finished and whether it failed. A run is one system
--     event, not a company's data. Its claimed and destroyed COUNTS are not returned -- they total
--     every company's audio, which is exactly what MR-46 B3 withdrew. What IS returned per run is
--     how many of THIS company's objects it destroyed, from `audio_destruction_log` through the
--     visit's rep.
--   * The company's own live, overdue and destroyed recordings AND voice notes (`retention_status`
--     counts recordings only), and the oldest overdue date.
--   * Which tables are append-only, read from the triggers that make them so: "kept forever" is a
--     claim this returns only where `reject_mutation` enforces it.
--
-- Admin-only (`effective_role()`, the table, not the JWT), refusing rather than emptying, reason
-- required, audited -- `retention_status`'s terms. **No write of any kind**: the purge has no manual
-- trigger by design (`retention.yml`'s header: claim, delete the object, confirm), and a console
-- button would be a second worker.
--
-- Rollback: services/api/rollbacks/20261013000230_console_retention_overview.down.sql

create or replace function public.retention_overview(p_reason text, p_runs integer default 20)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_org      uuid;
  v_audit_id bigint;
  v_runs     integer := least(greatest(coalesce(p_runs, 20), 1), 100);
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if public.effective_role() is distinct from 'admin' then
    raise exception 'only an admin may read retention status'
      using errcode = '42501',
            hint = 'These figures count another person''s recordings. Ask an admin.';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'admin access to retention status requires a reason'
      using errcode = '22023',
            hint = 'Say why the figures are being read. The reason is recorded with the read.';
  end if;
  v_org := public.current_user_organisation_id();

  insert into public.audit_log
    (actor_id, actor_role, action, table_name, row_id, reason, request_id, ip_address, occurred_at)
  values
    (v_uid, public.effective_role(), 'select', 'recordings', null, p_reason,
     public.current_request_id(), public.current_client_ip(), clock_timestamp())
  returning id into v_audit_id;

  return jsonb_build_object(
    'retentionDays', public.audio_retention_days(),
    'thresholds', jsonb_build_object(
      'purgeBatchLimit',       public.threshold_number('purge_batch_limit', null, 100),
      'purgeBacklogMultiplier', public.threshold_number('purge_backlog_multiplier', null, 3),
      'purgeMaxSilenceHours',  public.threshold_number('purge_max_silence_hours', null, 12)),
    'yours', (
      with audio as (
        select 'recording'::text as kind, r.purge_state::text as state, r.purge_after
          from public.recordings r
          join public.user_profiles p on p.id = r.mr_id and p.organisation_id = v_org
        union all
        select 'voice_note', n.purge_state::text, n.purge_after
          from public.voice_notes n
          join public.user_profiles p on p.id = n.mr_id and p.organisation_id = v_org
      )
      select jsonb_build_object(
        'liveRecordings',      count(*) filter (where kind = 'recording' and state <> 'destroyed'),
        'liveVoiceNotes',      count(*) filter (where kind = 'voice_note' and state <> 'destroyed'),
        'overdueRecordings',   count(*) filter (where kind = 'recording' and state <> 'destroyed'
                                                  and purge_after <= now()),
        'overdueVoiceNotes',   count(*) filter (where kind = 'voice_note' and state <> 'destroyed'
                                                  and purge_after <= now()),
        'destroyedRecordings', count(*) filter (where kind = 'recording' and state = 'destroyed'),
        'destroyedVoiceNotes', count(*) filter (where kind = 'voice_note' and state = 'destroyed'),
        'oldestOverdueAt',     min(purge_after) filter (where state <> 'destroyed' and purge_after <= now()))
        from audio),
    'worker', jsonb_build_object(
      'lastRunAt',           (select max(r.started_at) from public.audio_purge_runs r),
      'lastSuccessfulRunAt', (select max(r.finished_at) from public.audio_purge_runs r
                               where r.finished_at is not null and r.failed_count = 0),
      'stalled',             public.audio_purge_is_stalled()),
    'runs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',         r.id,
               'startedAt',  r.started_at,
               'finishedAt', r.finished_at,
               'outcome',    case when r.finished_at is null then 'unfinished'
                                  when r.failed_count > 0 then 'failed'
                                  else 'succeeded' end,
               'destroyedForYou', (
                 select count(*)::integer
                   from public.audio_destruction_log d
                   join public.visits v on v.id = d.visit_id
                   join public.user_profiles p on p.id = v.mr_id and p.organisation_id = v_org
                  where d.run_id = r.id))
             order by r.started_at desc)
        from (select * from public.audio_purge_runs order by started_at desc limit v_runs) r),
      '[]'::jsonb),
    'appendOnlyTables', coalesce((
      select jsonb_agg(distinct c.relname::text)
        from pg_catalog.pg_trigger t
        join pg_catalog.pg_class c on c.oid = t.tgrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        join pg_catalog.pg_proc f on f.oid = t.tgfoid
       where n.nspname = 'public' and f.proname = 'reject_mutation' and not t.tgisinternal),
      '[]'::jsonb),
    'readAt', clock_timestamp(),
    'auditLogId', v_audit_id);
end;
$$;

revoke execute on function public.retention_overview(text, integer) from public, anon;
grant execute on function public.retention_overview(text, integer) to authenticated;
