-- Rollback for 20260815000200_exceptions_from_config.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- Returns team_exceptions to hardcoded thresholds and bulk approval to a silent
-- cap. The 'org_default_shift_window' enum label cannot be removed — Postgres has
-- no DROP VALUE — so it survives as an unused label until the type itself is
-- dropped by the BE-W5 rollback below this one.

drop policy if exists app_thresholds_select_authenticated on public.app_thresholds;

create or replace function public.approve_call_reports_bulk(
  p_call_report_ids uuid[],
  p_approved        boolean,
  p_reason          text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_results jsonb := '[]'::jsonb;
  v_message text;
begin
  if array_length(p_call_report_ids, 1) is null then
    raise exception 'no call reports supplied' using errcode = '22023';
  end if;
  if array_length(p_call_report_ids, 1) > 200 then
    raise exception 'at most 200 reports may be decided in one call' using errcode = '22023';
  end if;

  foreach v_id in array p_call_report_ids loop
    begin
      perform public.approve_call_report(v_id, p_approved, p_reason);
      v_results := v_results || jsonb_build_object('id', v_id, 'decided', true, 'error', null);
    exception when others then
      get stacked diagnostics v_message = message_text;
      v_results := v_results || jsonb_build_object('id', v_id, 'decided', false, 'error', v_message);
    end;
  end loop;

  return jsonb_build_object('results', v_results, 'serverTime', clock_timestamp());
end;
$$;

create or replace function public.team_exceptions(
  p_date date default null,
  p_stale_sync_hours integer default 12
)
returns table (
  mr_id          uuid,
  exception_kind public.team_exception_kind,
  detail         jsonb
)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
  with day as (select coalesce(p_date, current_date) as d),
  scope as (
    select p.id from public.user_profiles p
     where p.id in (select public.visible_user_ids()) and p.role = 'mr' and p.is_active
  ),
  cov as (
    select c.mr_id, c.missed_visit_count, c.planned_visit_count
      from day, public.coverage(day.d, day.d) c
  ),
  synced as (
    select s.id as mr_id,
           (select max(i.received_at) from public.sync_items i
             where i.mr_id = s.id and i.status in ('accepted', 'duplicate')) as last_at
      from scope s
  ),
  rejects as (
    select i.mr_id,
           count(*) filter (where i.status in ('rejected', 'dead_lettered'))::integer as bad,
           count(*)::integer as total
      from public.sync_items i, day
     where (i.client_created_at at time zone 'Asia/Kolkata')::date = day.d
     group by i.mr_id
  ),
  consent as (
    select cr.captured_by_mr_id as mr_id,
           count(*) filter (where cr.outcome = 'consented')::numeric as yes,
           count(*)::numeric as total
      from public.consent_records cr, day
     where (cr.captured_at at time zone 'Asia/Kolkata')::date = day.d
     group by cr.captured_by_mr_id
  ),
  consent_rates as (
    select mr_id, yes / nullif(total, 0) as rate, total from consent where total >= 3
  ),
  team_median as (
    select (percentile_cont(0.5) within group (order by rate))::numeric as median
      from consent_rates
  )
  select cov.mr_id, 'missed_visits'::public.team_exception_kind,
         jsonb_build_object('missed', cov.missed_visit_count, 'planned', cov.planned_visit_count)
    from cov where cov.missed_visit_count > 0
  union all
  select synced.mr_id, 'no_recent_sync'::public.team_exception_kind,
         jsonb_build_object('lastSuccessfulSyncAt', synced.last_at, 'thresholdHours', p_stale_sync_hours)
    from synced
   where synced.last_at is null
      or synced.last_at < now() - make_interval(hours => p_stale_sync_hours)
  union all
  select rejects.mr_id, 'high_rejection_rate'::public.team_exception_kind,
         jsonb_build_object('rejected', rejects.bad, 'submitted', rejects.total)
    from rejects
   where rejects.total >= 5 and rejects.bad::numeric / rejects.total > 0.2
  union all
  select cr.mr_id, 'consent_rate_anomaly'::public.team_exception_kind,
         jsonb_build_object(
           'rate', round(cr.rate, 3),
           'teamMedian', round(tm.median, 3),
           'sampleSize', cr.total,
           'signal', 'data_quality',
           'note', 'Investigate the territory and the capture flow. This is not a performance measure.')
    from consent_rates cr, team_median tm
   where tm.median is not null and abs(cr.rate - tm.median) >= 0.4;
$$;
