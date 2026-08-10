-- ============================================================================
-- BE-W6 (2 of 3) · team_exceptions reads its thresholds, and gains two rules
--
-- Separate migration because ALTER TYPE ... ADD VALUE commits the new enum label
-- but cannot use it in the same transaction, and each migration file is one
-- transaction. `org_default_shift_window` was added in 20260815000100.
--
-- Rollback: services/api/rollbacks/20260815000200_exceptions_from_config.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Exceptions
-- ----------------------------------------------------------------------------

create or replace function public.team_exceptions(
  p_date date default null,
  p_stale_sync_hours integer default null
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
  cfg as (
    select coalesce(p_stale_sync_hours::numeric,
                    public.threshold_number('sync_stale_hours', null, 12))         as stale_hours,
           public.threshold_number('rejection_rate_threshold', null, 0.2)          as reject_rate,
           public.threshold_number('rejection_min_items', null, 5)                 as reject_min,
           public.threshold_number('consent_deviation', null, 0.4)                 as consent_dev,
           public.threshold_number('consent_min_captures', null, 3)                as consent_min_caps,
           public.threshold_number('consent_min_team_size', null, 8)               as consent_min_team
  ),
  scope as (
    select p.id from public.user_profiles p
     where p.id in (select public.visible_user_ids()) and p.role = 'mr' and p.is_active
  ),
  -- The comparison group, not the caller's whole visible set. A consent rate is
  -- only meaningful against the peers it is being compared with.
  team_size as (select count(*)::numeric as n from scope),
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
           count(*) filter (where i.status in ('rejected', 'dead_lettered'))::numeric as bad,
           count(*)::numeric as total
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
    select c.mr_id, c.yes / nullif(c.total, 0) as rate, c.total
      from consent c, cfg
     where c.total >= cfg.consent_min_caps
  ),
  team_median as (
    select (percentile_cont(0.5) within group (order by rate))::numeric as median
      from consent_rates
  ),
  -- Captures judged against the organisation default rather than a configured
  -- territory window. Flagged at capture time, surfaced here.
  org_default_captures as (
    select c.mr_id, count(*)::integer as n, min(c.occurred_at) as first_at
      from public.check_ins c, day
     where c.shift_window_source = 'org_default'
       and (c.occurred_at at time zone 'Asia/Kolkata')::date = day.d
     group by c.mr_id
  )
  select cov.mr_id, 'missed_visits'::public.team_exception_kind,
         jsonb_build_object('missed', cov.missed_visit_count, 'planned', cov.planned_visit_count)
    from cov where cov.missed_visit_count > 0

  union all
  select synced.mr_id, 'no_recent_sync'::public.team_exception_kind,
         jsonb_build_object('lastSuccessfulSyncAt', synced.last_at,
                            'thresholdHours', cfg.stale_hours)
    from synced, cfg
   where synced.last_at is null
      or synced.last_at < now() - make_interval(hours => cfg.stale_hours::integer)

  union all
  select rejects.mr_id, 'high_rejection_rate'::public.team_exception_kind,
         jsonb_build_object('rejected', rejects.bad::integer, 'submitted', rejects.total::integer,
                            'thresholdRate', cfg.reject_rate)
    from rejects, cfg
   where rejects.total >= cfg.reject_min and rejects.bad / rejects.total > cfg.reject_rate

  union all
  -- The team-size floor. Below it, nothing is emitted at all: not a low-confidence
  -- signal, not a nulled field. A number nobody can act on still gets acted on.
  select cr.mr_id, 'consent_rate_anomaly'::public.team_exception_kind,
         jsonb_build_object(
           'rate', round(cr.rate, 3),
           'teamMedian', round(tm.median, 3),
           'sampleSize', cr.total::integer,
           'teamSize', ts.n::integer,
           'signal', 'data_quality',
           'note', 'Investigate the territory and the capture flow. This is not a performance measure.')
    from consent_rates cr, team_median tm, team_size ts, cfg
   where tm.median is not null
     and ts.n >= cfg.consent_min_team
     and abs(cr.rate - tm.median) >= cfg.consent_dev

  union all
  select odc.mr_id, 'org_default_shift_window'::public.team_exception_kind,
         jsonb_build_object(
           'captureCount', odc.n,
           'firstAt', odc.first_at,
           'signal', 'unconfigured_territory',
           'note', 'These captures were judged against the organisation default, not '
                   'this territory''s own working hours. Configure the territory window.')
    from org_default_captures odc;
$$;

comment on function public.team_exceptions(date, integer) is
  'Exception-first manager view. Thresholds come from public.app_thresholds at query '
  'time. No score, rank, percentile or ordering of medical representatives against '
  'one another, and it must not grow one.';

-- ----------------------------------------------------------------------------
-- 2. Bulk approval reports its own truncation
-- ----------------------------------------------------------------------------

-- search_doctors was fixed in BE-W5 and this was not. Same failure: a caller
-- submits 250 reports, 200 are decided, and nothing says the other 50 were not.
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
  c_limit constant integer := 200;
  v_total   integer;
  v_ids     uuid[];
  v_id      uuid;
  v_results jsonb := '[]'::jsonb;
  v_decided integer := 0;
  v_failed  integer := 0;
  v_message text;
begin
  v_total := coalesce(array_length(p_call_report_ids, 1), 0);

  if v_total = 0 then
    raise exception 'no call reports supplied' using errcode = '22023';
  end if;

  -- Decide the first N and say so, rather than raising and deciding none or
  -- capping and saying nothing.
  v_ids := p_call_report_ids[1:c_limit];

  foreach v_id in array v_ids loop
    begin
      perform public.approve_call_report(v_id, p_approved, p_reason);
      v_results := v_results || jsonb_build_object('id', v_id, 'decided', true, 'error', null);
      v_decided := v_decided + 1;
    exception when others then
      get stacked diagnostics v_message = message_text;
      v_results := v_results || jsonb_build_object('id', v_id, 'decided', false, 'error', v_message);
      v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object(
    'results', v_results,
    'decidedCount', v_decided,
    'notDecidedCount', v_failed,
    'submittedCount', v_total,
    'truncated', v_total > c_limit,
    'limit', c_limit,
    'serverTime', clock_timestamp());
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Grants
-- ----------------------------------------------------------------------------

alter table public.app_thresholds enable row level security;
alter table public.app_thresholds force row level security;

revoke all on table public.app_thresholds from anon, authenticated;
revoke update, delete, truncate on table public.app_thresholds from service_role;

-- Readable by anyone signed in: an MR needs to know the working hours they are
-- being judged against, and a manager needs to know the thresholds behind an
-- exception. Written only through service_role, which is where an operator sits.
create policy app_thresholds_select_authenticated
  on public.app_thresholds for select to authenticated
  using (true);

grant select on table public.app_thresholds to authenticated;

grant execute on function public.threshold(text, uuid)                  to authenticated;
grant execute on function public.threshold_number(text, uuid, numeric)  to authenticated;
grant execute on function public.resolve_shift_window(uuid)             to authenticated;
