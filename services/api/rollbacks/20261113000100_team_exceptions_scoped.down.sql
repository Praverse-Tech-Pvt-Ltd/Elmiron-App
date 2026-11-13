-- Rollback for `BE-W219` (20261113000100_team_exceptions_scoped).
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- What rolling back MEANS, said plainly because it is a defect coming back: three branches of
-- `team_exceptions()` (rejection rate, consent-rate anomaly, organisation-default captures) read
-- EVERY organisation's reps again, for ANY signed-in caller, and the consent "team median" is a
-- median over every tenant. That is the cross-tenant leak this migration closed, restored exactly
-- as `20260815000200` defined it. No row changes.

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
