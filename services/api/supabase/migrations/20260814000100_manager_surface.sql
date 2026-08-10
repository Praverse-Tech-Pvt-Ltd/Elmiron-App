-- ============================================================================
-- BE-W5 · Manager surface, approval workflow, and dead-letter reinstatement
--
-- A field manager oversees 8–15 MRs and wants to know what is OFF-PLAN, not what
-- happened. Everything here returns exceptions rather than activity feeds.
--
-- One thing this migration deliberately does NOT contain: any ranking of MRs
-- against each other. No score, no rank, no percentile, no league table. A consent
-- rate that differs from the team is a DATA QUALITY signal to investigate — an MR
-- at 100% while the team sits at 40% is a fraud signal, not a performance win — and
-- surfacing it as a position in a list converts it into the opposite of what it
-- means. There is a test asserting no such column exists.
--
-- Rollback: services/api/rollbacks/20260814000100_manager_surface.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Dead-letter reinstatement — always reversible, always attributed
-- ----------------------------------------------------------------------------

-- Decided by the reviewer: a dead letter is ALWAYS reversible by an authorised
-- action, with a mandatory reason and an audit row. There is deliberately no fault
-- taxonomy and no "somebody else's fault" code set.
--
-- The reasoning, recorded because it will be re-proposed: blame cannot be
-- enumerated in advance. At the point of rejection a wrong shift window and an MR
-- error are indistinguishable — both produce `outside_shift_window`. A taxonomy
-- that looks clean at design time produces arguments in production about which
-- bucket a case belongs in. The control is attribution and visibility, not
-- prevention.

-- Attempts are never rewritten; they are forgiven. The history of how many times
-- an item failed survives a reinstatement, which is the whole point of attributing
-- one.
alter table public.sync_items
  add column attempts_forgiven integer not null default 0 check (attempts_forgiven >= 0),
  add constraint sync_items_forgiven_not_exceeding_attempts
    check (attempts_forgiven <= attempt_count);

create table public.sync_item_reinstatements (
  id                 uuid primary key default gen_random_uuid(),
  sync_item_id       uuid not null references public.sync_items (id) on delete restrict,
  reinstated_by_user_id uuid not null references public.user_profiles (id) on delete restrict,
  -- Mandatory. A reinstatement with no stated reason is an unexplained override of
  -- a control, which is the thing an audit trail exists to prevent.
  reason             text not null check (length(btrim(reason)) > 0),
  attempts_at_reinstatement integer not null,
  created_at         timestamptz not null default now(),
  received_at        timestamptz not null default clock_timestamp()
);

create index sync_item_reinstatements_item_idx
  on public.sync_item_reinstatements (sync_item_id, created_at desc);

create trigger sync_item_reinstatements_stamp_received_at
  before insert on public.sync_item_reinstatements
  for each row execute function public.stamp_received_at();

create trigger sync_item_reinstatements_audit
  after insert on public.sync_item_reinstatements
  for each row execute function public.write_audit_row();

create trigger sync_item_reinstatements_reject_mutation
  before update or delete or truncate on public.sync_item_reinstatements
  for each statement execute function public.reject_mutation();

comment on table public.sync_item_reinstatements is
  'Append-only record of every dead-letter reversal. Attribution and visibility are '
  'the control here; there is no taxonomy of whose fault the original rejection was.';

create or replace function public.reinstate_sync_item(p_sync_item_id uuid, p_reason text)
returns public.sync_items
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid  uuid;
  v_role public.app_role;
  v_item public.sync_items%rowtype;
begin
  v_uid  := (select auth.uid());
  v_role := public.effective_role();

  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if v_role not in ('field_manager', 'admin') then
    raise exception 'only a field_manager or admin may reinstate a queued item'
      using errcode = '42501';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reinstatement requires a reason' using errcode = '22023';
  end if;

  select * into v_item
    from public.sync_items s
   where s.id = p_sync_item_id
     and (v_role = 'admin' or s.mr_id in (select public.visible_user_ids()));

  if v_item.id is null then
    raise exception 'sync item % is not in your scope', p_sync_item_id using errcode = '42501';
  end if;

  if v_item.status <> 'dead_lettered' then
    raise exception 'sync item % is %; only a dead-lettered item can be reinstated',
      p_sync_item_id, v_item.status using errcode = '22023';
  end if;

  insert into public.sync_item_reinstatements
    (sync_item_id, reinstated_by_user_id, reason, attempts_at_reinstatement)
  values (p_sync_item_id, v_uid, p_reason, v_item.attempt_count);

  update public.sync_items
     set status = 'rejected',
         attempts_forgiven = attempt_count,
         resolved_at = null
   where id = p_sync_item_id
  returning * into v_item;

  return v_item;
end;
$$;

-- sync_push has to count attempts against the forgiven baseline, so it is replaced
-- here in full. Only the dead-letter condition changes; everything else is the
-- BE-W4 body, restated because Postgres has no way to patch one line of it.
create or replace function public.sync_push(p_batch_id uuid, p_items jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_max_attempts constant integer := 5;
  v_uid       uuid;
  v_item      jsonb;
  v_item_id   uuid;
  v_entity    public.sync_entity_kind;
  v_entity_id uuid;
  v_existing  public.sync_items%rowtype;
  v_attempts  integer;
  v_forgiven  integer;
  v_status    public.sync_item_status;
  v_code      public.sync_rejection_code;
  v_detail    text;
  v_warnings  text[];
  v_results   jsonb := '[]'::jsonb;
  v_sqlstate  text;
  v_message   text;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be a json array' using errcode = '22023';
  end if;

  insert into public.sync_batches (id, mr_id, item_count, submitted_at)
  values (p_batch_id, v_uid, jsonb_array_length(p_items), now())
  on conflict (id) do nothing;

  for v_item in select value from jsonb_array_elements(p_items) value loop
    v_status   := null;
    v_code     := null;
    v_detail   := null;
    v_warnings := '{}';

    begin
      v_item_id   := (v_item ->> 'id')::uuid;
      v_entity    := (v_item ->> 'entity')::public.sync_entity_kind;
      v_entity_id := (v_item ->> 'entityId')::uuid;
      if v_item_id is null or v_entity is null or v_entity_id is null then
        raise exception 'missing id, entity or entityId' using errcode = '22023';
      end if;
    exception when others then
      v_results := v_results || jsonb_build_object(
        'id', v_item ->> 'id',
        'status', 'rejected',
        'rejectionCode', 'malformed_item',
        'rejectionDetail', 'id, entity and entityId are required',
        'warnings', '[]'::jsonb);
      continue;
    end;

    select * into v_existing from public.sync_items s where s.id = v_item_id;

    if found and v_existing.status in ('accepted', 'duplicate') then
      v_results := v_results || jsonb_build_object(
        'id', v_item_id, 'status', 'duplicate',
        'rejectionCode', null, 'rejectionDetail', null,
        'warnings', to_jsonb(v_existing.warnings));
      continue;
    end if;

    if found and v_existing.status = 'dead_lettered' then
      v_results := v_results || jsonb_build_object(
        'id', v_item_id, 'status', 'dead_lettered',
        'rejectionCode', v_existing.rejection_code,
        'rejectionDetail', v_existing.rejection_detail,
        'warnings', to_jsonb(v_existing.warnings));
      continue;
    end if;

    v_attempts := coalesce(v_existing.attempt_count, 0) + 1;
    v_forgiven := coalesce(v_existing.attempts_forgiven, 0);

    -- Attempts since the last reinstatement, not attempts ever. A reinstated item
    -- gets a fresh budget without losing the record of how many times it failed.
    if (v_attempts - v_forgiven) > c_max_attempts then
      v_status := 'dead_lettered';
      v_code   := coalesce(v_existing.rejection_code, 'internal_error');
      v_detail := format('gave up after %s attempts: %s', c_max_attempts,
                         coalesce(v_existing.rejection_detail, 'unknown'));
    else
      begin
        v_warnings := public.apply_sync_item(v_entity, v_entity_id, v_item -> 'payload');
        v_status := 'accepted';
      exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
        v_status := 'rejected';
        v_detail := v_message;
        v_code := case
          when v_message ilike '%shift window%'      then 'outside_shift_window'
          when v_sqlstate = '42501'                  then 'not_your_record'
          when v_sqlstate = '0A000'                  then 'unsupported_entity'
          when v_sqlstate in ('23503', '23502')      then 'missing_reference'
          when v_sqlstate in ('23514', '23505', '22023', '22P02') then 'validation_failed'
          else 'internal_error'
        end::public.sync_rejection_code;
      end;
    end if;

    insert into public.sync_items
      (id, batch_id, mr_id, entity, operation, entity_id, payload, status,
       rejection_code, rejection_detail, warnings, attempt_count, attempts_forgiven,
       client_created_at, resolved_at)
    values
      (v_item_id, p_batch_id, v_uid, v_entity,
       coalesce(nullif(v_item ->> 'operation', ''), 'create'),
       v_entity_id, coalesce(v_item -> 'payload', '{}'::jsonb), v_status,
       v_code, v_detail, v_warnings, v_attempts, v_forgiven,
       coalesce((v_item ->> 'clientCreatedAt')::timestamptz, now()),
       case when v_status in ('accepted', 'dead_lettered') then clock_timestamp() end)
    on conflict (id) do update
      set status           = excluded.status,
          batch_id         = excluded.batch_id,
          rejection_code   = excluded.rejection_code,
          rejection_detail = excluded.rejection_detail,
          warnings         = excluded.warnings,
          attempt_count    = excluded.attempt_count,
          resolved_at      = excluded.resolved_at;

    v_results := v_results || jsonb_build_object(
      'id', v_item_id,
      'status', v_status,
      'rejectionCode', v_code,
      'rejectionDetail', v_detail,
      'warnings', to_jsonb(v_warnings));
  end loop;

  return jsonb_build_object(
    'batchId', p_batch_id,
    'results', v_results,
    'serverTime', clock_timestamp());
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Rejections, explained
-- ----------------------------------------------------------------------------

-- `rejection_detail` is the raw Postgres message: precise, and no use to an MR.
-- The code is machine-readable and this is its human sentence, so both live in the
-- same row and support never has to translate one into the other.
create or replace function public.sync_rejection_explanation(p_code public.sync_rejection_code)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_code
    when 'outside_shift_window' then
      'This was captured outside the working hours configured for the territory. '
      'If the hours are wrong, that is a configuration fix, not a re-do.'
    when 'outside_geofence' then
      'The recorded position was outside the clinic''s geofence.'
    when 'not_your_record' then
      'This refers to a visit or record belonging to someone else.'
    when 'missing_reference' then
      'Something this refers to — a visit, a doctor, a consent version — is not on the server.'
    when 'validation_failed' then
      'The server refused the contents of this item.'
    when 'unsupported_entity' then
      'This kind of item is not accepted by sync yet.'
    when 'malformed_item' then
      'The item was missing its id, entity or entity id.'
    when 'internal_error' then
      'The server failed while applying this item. It is safe to retry.'
    else null
  end;
$$;

create view public.sync_item_explained
with (security_invoker = true) as
  select s.*,
         public.sync_rejection_explanation(s.rejection_code) as explanation,
         greatest(0, 5 - (s.attempt_count - s.attempts_forgiven)) as attempts_remaining,
         exists (
           select 1 from public.sync_item_reinstatements r where r.sync_item_id = s.id
         ) as was_reinstated
    from public.sync_items s;

drop function if exists public.list_sync_rejections(uuid, integer);

create or replace function public.list_sync_rejections(
  p_mr_id uuid default null,
  p_limit integer default 100
)
returns setof public.sync_item_explained
language sql
stable
security definer
set search_path = ''
as $$
  select e.*
    from public.sync_item_explained e
   where e.mr_id in (select public.visible_user_ids())
     and (p_mr_id is null or e.mr_id = p_mr_id)
     and e.status in ('rejected', 'dead_lettered')
   order by e.client_created_at desc
   limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

-- ----------------------------------------------------------------------------
-- 3. Doctor search reports its own truncation
-- ----------------------------------------------------------------------------

-- A silent cap is the same failure mode as a silently skipped test: the MR sees
-- partial results and believes they are complete. The flag is the whole point.
drop function if exists public.search_doctors(text, uuid, integer);

create or replace function public.search_doctors(
  p_query        text default null,
  p_territory_id uuid default null,
  p_limit        integer default 50
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with bounded as (
    select least(greatest(coalesce(p_limit, 50), 1), 200) as lim
  ),
  -- One more than asked for, so truncation is measured rather than guessed at.
  matched as (
    select d.*
      from public.doctors d, bounded
     where d.is_active
       and (p_territory_id is null or d.territory_id = p_territory_id)
       and (
         p_query is null
         or btrim(p_query) = ''
         or d.full_name ilike '%' || p_query || '%'
         or d.specialty ilike '%' || p_query || '%'
         or d.registration_number = p_query
       )
     order by d.full_name
     limit (select lim + 1 from bounded)
  )
  select jsonb_build_object(
    'items', coalesce(
      (select jsonb_agg(to_jsonb(m) order by m.full_name)
         from (select * from matched order by full_name limit (select lim from bounded)) m),
      '[]'::jsonb),
    'truncated', (select count(*) from matched) > (select lim from bounded),
    'limit', (select lim from bounded)
  );
$$;

comment on function public.search_doctors(text, uuid, integer) is
  'Returns { items, truncated, limit }. `truncated` is measured by fetching one row '
  'beyond the limit — a silent cap would let an MR believe partial results are complete.';

-- ----------------------------------------------------------------------------
-- 4. Manager surface — exceptions, never a feed and never a ranking
-- ----------------------------------------------------------------------------

create type public.team_exception_kind as enum (
  'missed_visits',
  'no_recent_sync',
  'high_rejection_rate',
  'consent_rate_anomaly'
);

-- Who is where and who is off-plan, for one day. Location is drawn only from
-- captures inside the configured shift window — the app does not surface an MR's
-- position outside their working hours, and this is where that is enforced for the
-- manager view.
create or replace function public.team_activity(p_date date default null)
returns table (
  mr_id                uuid,
  territory_id         uuid,
  planned_visit_count  integer,
  actual_visit_count   integer,
  check_in_count       integer,
  last_latitude        double precision,
  last_longitude       double precision,
  last_seen_at         timestamptz,
  last_successful_sync_at timestamptz
)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
  with scope as (
    select p.id, p.territory_id
      from public.user_profiles p
     where p.id in (select public.visible_user_ids())
       and p.role = 'mr'
  ),
  day as (select coalesce(p_date, current_date) as d),
  planned as (
    select bp.mr_id, count(e.id)::integer as n
      from public.beat_plan_current bp
      join public.beat_plan_entries e on e.beat_plan_id = bp.id, day
     where bp.plan_date = day.d
     group by bp.mr_id
  ),
  actual as (
    select v.mr_id, count(*)::integer as n
      from public.visits v, day
     where v.status = 'completed'
       and (v.completed_at at time zone 'Asia/Kolkata')::date = day.d
     group by v.mr_id
  ),
  positions as (
    select distinct on (c.mr_id)
           c.mr_id, c.latitude, c.longitude, c.occurred_at
      from public.check_ins c
      join public.visits v on v.id = c.visit_id
      join public.doctors d on d.id = v.doctor_id, day
     where (c.occurred_at at time zone 'Asia/Kolkata')::date = day.d
       and public.is_within_shift(d.territory_id, c.occurred_at)
     order by c.mr_id, c.occurred_at desc
  ),
  counts as (
    select c.mr_id, count(*)::integer as n
      from public.check_ins c, day
     where (c.occurred_at at time zone 'Asia/Kolkata')::date = day.d
     group by c.mr_id
  ),
  synced as (
    select s.mr_id, max(s.received_at) as at
      from public.sync_items s
     where s.status in ('accepted', 'duplicate')
     group by s.mr_id
  )
  select s.id,
         s.territory_id,
         coalesce(planned.n, 0),
         coalesce(actual.n, 0),
         coalesce(counts.n, 0),
         positions.latitude,
         positions.longitude,
         positions.occurred_at,
         synced.at
    from scope s
    left join planned   on planned.mr_id   = s.id
    left join actual    on actual.mr_id    = s.id
    left join counts    on counts.mr_id    = s.id
    left join positions on positions.mr_id = s.id
    left join synced    on synced.mr_id    = s.id
   order by s.id;
$$;

-- Planned beat versus actual visits, per MR per day.
create or replace function public.coverage(p_from date, p_to date)
returns table (
  mr_id               uuid,
  coverage_date       date,
  planned_visit_count integer,
  actual_visit_count  integer,
  missed_visit_count  integer
)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
  with days as (
    select generate_series(p_from, p_to, interval '1 day')::date as d
  ),
  scope as (
    select p.id from public.user_profiles p
     where p.id in (select public.visible_user_ids()) and p.role = 'mr'
  ),
  planned as (
    select bp.mr_id, bp.plan_date, e.doctor_id
      from public.beat_plan_current bp
      join public.beat_plan_entries e on e.beat_plan_id = bp.id
  ),
  actual as (
    select v.mr_id,
           (v.completed_at at time zone 'Asia/Kolkata')::date as d,
           v.doctor_id
      from public.visits v
     where v.status = 'completed' and v.completed_at is not null
  )
  select s.id,
         days.d,
         (select count(*)::integer from planned p where p.mr_id = s.id and p.plan_date = days.d),
         (select count(*)::integer from actual a where a.mr_id = s.id and a.d = days.d),
         -- Planned doctors with no completed visit that day. A missed visit is a
         -- doctor who was on the plan and was not seen, not a count difference.
         (select count(*)::integer
            from planned p
           where p.mr_id = s.id and p.plan_date = days.d
             and not exists (
               select 1 from actual a
                where a.mr_id = s.id and a.d = days.d and a.doctor_id = p.doctor_id))
    from scope s cross join days
   order by days.d desc, s.id;
$$;

-- One MR, one day, in detail. The only non-exception view here, because a manager
-- who has been shown an exception needs to look at the thing itself.
create or replace function public.mr_activity_detail(p_mr_id uuid, p_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_day date := coalesce(p_date, current_date);
  v_result jsonb;
begin
  if p_mr_id not in (select public.visible_user_ids()) then
    raise exception 'medical representative % is not in your scope', p_mr_id
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'mrId', p_mr_id,
    'date', v_day,
    'visits', coalesce((
      select jsonb_agg(to_jsonb(v) order by v.started_at)
        from public.visits v
       where v.mr_id = p_mr_id
         and (coalesce(v.completed_at, v.started_at, v.created_at) at time zone 'Asia/Kolkata')::date = v_day
    ), '[]'::jsonb),
    'checkIns', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.occurred_at)
        from public.check_ins c
       where c.mr_id = p_mr_id
         and (c.occurred_at at time zone 'Asia/Kolkata')::date = v_day
    ), '[]'::jsonb),
    'callReports', coalesce((
      select jsonb_agg(to_jsonb(cr) order by cr.created_at)
        from public.call_report_current cr
       where cr.mr_id = p_mr_id
         and (cr.created_at at time zone 'Asia/Kolkata')::date = v_day
    ), '[]'::jsonb),
    'mileage', coalesce((
      select jsonb_agg(to_jsonb(m))
        from public.daily_mileage(v_day, v_day, p_mr_id) m
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- The exception list. What a manager opens the console for.
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
    -- percentile_cont returns double precision even over a numeric input, and
    -- round(double precision, int) does not exist. Cast once, here.
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
  -- Deviation in EITHER direction, and labelled as data quality. An MR at 100%
  -- while the team sits at 40% is a fraud signal, not a performance win; an MR far
  -- below may have a territory of doctors who decline, which is information about
  -- the territory. Neither is a position in a ranking.
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

comment on function public.team_exceptions(date, integer) is
  'Exception-first manager view. Returns only what is off-plan. Contains no score, '
  'rank, percentile or ordering of medical representatives against one another, and '
  'must not grow one.';

-- ----------------------------------------------------------------------------
-- 5. Approval workflow
-- ----------------------------------------------------------------------------

-- What the caller may actually decide: submitted, current, in scope, not their own.
create or replace function public.approvable_call_reports(p_limit integer default 100)
returns setof public.call_report_current
language sql
stable
security definer
set search_path = ''
as $$
  select c.*
    from public.call_report_current c
   where c.status = 'submitted'
     and c.effective_status = 'submitted'
     and c.mr_id in (select public.visible_user_ids())
     and c.mr_id <> (select auth.uid())
     and public.effective_role() in ('field_manager', 'admin')
   order by c.created_at
   limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

-- A manager clearing Monday morning decides forty reports in one call, and gets
-- forty verdicts back. Same per-item discipline as sync_push: one refusal does not
-- roll back the other thirty-nine.
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

-- Escalation: submitted, current, and sitting undecided past a threshold.
create or replace function public.overdue_call_reports(p_threshold interval default interval '48 hours')
returns table (
  call_report_id uuid,
  mr_id          uuid,
  visit_id       uuid,
  submitted_at   timestamptz,
  age            interval
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.mr_id, c.visit_id, c.created_at, now() - c.created_at
    from public.call_report_current c
   where c.status = 'submitted'
     and c.effective_status = 'submitted'
     and c.mr_id in (select public.visible_user_ids())
     and c.created_at < now() - p_threshold
   order by c.created_at;
$$;

-- ----------------------------------------------------------------------------
-- 6. Boundary
-- ----------------------------------------------------------------------------

alter table public.sync_item_reinstatements enable row level security;
alter table public.sync_item_reinstatements force row level security;

revoke all on table public.sync_item_reinstatements from anon, authenticated;
revoke update, delete, truncate on table public.sync_item_reinstatements from service_role;

create policy sync_item_reinstatements_select_scope
  on public.sync_item_reinstatements for select to authenticated
  using (
    sync_item_id in (
      select s.id from public.sync_items s where s.mr_id in (select public.visible_user_ids())
    )
  );

grant select on table public.sync_item_reinstatements to authenticated;

revoke all on public.sync_item_explained from anon, authenticated;
grant select on public.sync_item_explained to authenticated;

grant execute on function public.reinstate_sync_item(uuid, text)                 to authenticated;
grant execute on function public.sync_rejection_explanation(public.sync_rejection_code) to authenticated;
grant execute on function public.list_sync_rejections(uuid, integer)             to authenticated;
grant execute on function public.search_doctors(text, uuid, integer)             to authenticated;
grant execute on function public.team_activity(date)                             to authenticated;
grant execute on function public.coverage(date, date)                            to authenticated;
grant execute on function public.mr_activity_detail(uuid, date)                  to authenticated;
grant execute on function public.team_exceptions(date, integer)                  to authenticated;
grant execute on function public.approvable_call_reports(integer)                to authenticated;
grant execute on function public.approve_call_reports_bulk(uuid[], boolean, text) to authenticated;
grant execute on function public.overdue_call_reports(interval)                  to authenticated;
