-- ============================================================================
-- `BE-W219` -- `team_exceptions` answers only about the reps the caller may see
-- ============================================================================
--
-- WHAT WAS OPEN
--
-- `team_exceptions()` (`20260815000200`) is SECURITY DEFINER, so no policy runs behind its body:
-- the body IS the boundary. Two of its five branches (`missed_visits`, `no_recent_sync`) were
-- scoped through `visible_user_ids()`. The other three were not:
--
--   * `rejects`              read `sync_items`       for EVERY rep of EVERY organisation;
--   * `consent`              read `consent_records`  for EVERY rep of EVERY organisation;
--   * `org_default_captures` read `check_ins`        for EVERY rep of EVERY organisation.
--
-- So any signed-in user -- a rep, or another company's manager -- who called the function learned
-- other companies' rep ids with their rejection counts, consent rates and capture counts. And
-- `team_median` was a median over every tenant's reps, so one company's consent behaviour moved
-- another company's anomaly line.
--
-- The function predates the tenant boundary (`20260908000900`), which scoped `visible_user_ids()`
-- and therefore the two branches that used it; nothing went back for the three that did not.
-- `FE-W202` then put the function on a console page, where the foreign rows drew as "Unknown rep".
--
-- THE FIX
--
-- One rule for all five branches: a row is about a rep in `scope`, or it is not read. `scope` is
-- unchanged -- active `mr` profiles among `visible_user_ids()`, which is the caller's own
-- organisation and, for a manager, their own subtree. The median is now a median of the caller's
-- visible reps, which is what "team median" always claimed to be.
--
-- Nothing else changes: same name, arguments, return shape, thresholds and grant. No score, rank,
-- percentile or ordering is added (`constraints.md`).
--
-- Rollback: services/api/rollbacks/20261113000100_team_exceptions_scoped.down.sql
-- ============================================================================

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
  -- `BE-W219`: scoped. Was every rep of every organisation.
  rejects as (
    select i.mr_id,
           count(*) filter (where i.status in ('rejected', 'dead_lettered'))::numeric as bad,
           count(*)::numeric as total
      from public.sync_items i, day
     where i.mr_id in (select scope.id from scope)
       and (i.client_created_at at time zone 'Asia/Kolkata')::date = day.d
     group by i.mr_id
  ),
  -- `BE-W219`: scoped. Was every rep of every organisation -- and so was the median below.
  consent as (
    select cr.captured_by_mr_id as mr_id,
           count(*) filter (where cr.outcome = 'consented')::numeric as yes,
           count(*)::numeric as total
      from public.consent_records cr, day
     where cr.captured_by_mr_id in (select scope.id from scope)
       and (cr.captured_at at time zone 'Asia/Kolkata')::date = day.d
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
  -- `BE-W219`: scoped. Was every rep of every organisation.
  org_default_captures as (
    select c.mr_id, count(*)::integer as n, min(c.occurred_at) as first_at
      from public.check_ins c, day
     where c.mr_id in (select scope.id from scope)
       and c.shift_window_source = 'org_default'
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
  'Exception-first manager view. Every branch reads only the reps in visible_user_ids() '
  '(BE-W219): the caller''s own organisation, and a manager''s own subtree. Thresholds come '
  'from public.app_thresholds at query time. No score, rank, percentile or ordering of medical '
  'representatives against one another, and it must not grow one.';

-- The guard -- fails the deploy if a `create or replace` kept an unscoped body. Three branches
-- were unscoped, so the scoping predicate must appear at least three times.
do $$
declare
  v_src text;
  v_hits integer;
begin
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'team_exceptions';
  v_hits := (length(v_src) - length(replace(v_src, 'in (select scope.id from scope)', '')))
            / length('in (select scope.id from scope)');
  if v_hits < 3 then
    raise exception 'BE-W219: team_exceptions has % scoped branch(es) of the 3 required', v_hits;
  end if;
end;
$$;
