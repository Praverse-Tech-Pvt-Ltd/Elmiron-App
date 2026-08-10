-- ============================================================================
-- BE-W6 (1 of 2) · Thresholds as configuration, and a flagged org default window
--
-- Two changes from the BE-W5 review, plus the bulk-approval truncation fix.
--
-- The reversal recorded plainly: BE-W3 refused every capture in a territory with no
-- configured shift window, on the grounds that inventing a business rule and
-- passing it off as fact is worse than failing loudly. That was right at one week
-- late. At three weeks it is blocking a gate, so an organisation-level default is
-- now permitted — and every capture made under it is FLAGGED in a stored column and
-- surfaced as a manager exception. The loud flag is what preserves the original
-- property. If the flag ever becomes easy to ignore, the strict rule should come
-- back.
--
-- Rollback: services/api/rollbacks/20260815000100_thresholds_and_shift_defaults.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The threshold table
-- ----------------------------------------------------------------------------

-- Append-only with an effective date, rather than a mutable row.
--
-- The review said "a guess in a row costs an UPDATE". An UPDATE would destroy both
-- the effective date and the record of who set the previous value, which are two of
-- the five columns asked for. Changing a threshold is one INSERT — the same cost —
-- and the history survives. Recorded here because it is a deliberate deviation.
create table public.app_thresholds (
  id             uuid primary key default gen_random_uuid(),
  key            text not null check (length(btrim(key)) > 0),
  -- jsonb rather than numeric because this table also holds the org default shift
  -- window, which is not a number. The accessors below narrow it.
  value          jsonb not null,
  unit           text,
  scope          text not null default 'global' check (scope in ('global', 'territory')),
  territory_id   uuid references public.territories (id) on delete cascade,
  effective_from timestamptz not null default now(),
  set_by_user_id uuid references public.user_profiles (id) on delete set null,
  note           text,
  created_at     timestamptz not null default now(),
  constraint app_thresholds_scope_matches_territory
    check ((scope = 'territory') = (territory_id is not null)),
  constraint app_thresholds_unique_version unique (key, territory_id, effective_from)
);

create index app_thresholds_lookup_idx
  on public.app_thresholds (key, territory_id, effective_from desc);

create trigger app_thresholds_audit
  after insert on public.app_thresholds
  for each row execute function public.write_audit_row();

create trigger app_thresholds_reject_mutation
  before update or delete or truncate on public.app_thresholds
  for each statement execute function public.reject_mutation();

comment on table public.app_thresholds is
  'Exception thresholds and the organisation default shift window. Append-only: a '
  'new value is a new row with a later effective_from, so the history of who set '
  'what, and when it started applying, survives.';

-- Territory beats global; latest effective value wins; nothing in the future.
create or replace function public.threshold(p_key text, p_territory_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select t.value
    from public.app_thresholds t
   where t.key = p_key
     and t.effective_from <= now()
     and (t.territory_id is null or t.territory_id = p_territory_id)
   order by (t.territory_id is not null) desc, t.effective_from desc
   limit 1;
$$;

create or replace function public.threshold_number(
  p_key text,
  p_territory_id uuid default null,
  p_fallback numeric default null
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select (public.threshold(p_key, p_territory_id)) #>> '{}')::numeric,
    p_fallback
  );
$$;

-- ----------------------------------------------------------------------------
-- 2. Seed with today's behaviour
-- ----------------------------------------------------------------------------

-- Seeded with the values already hardcoded in team_exceptions, so this migration
-- changes where the numbers live and not what the system does.
insert into public.app_thresholds (key, value, unit, note) values
  ('sync_stale_hours',         '12'::jsonb,  'hours',
   'Hours without a successful sync before an MR is flagged.'),
  ('rejection_rate_threshold', '0.2'::jsonb, 'ratio',
   'Share of a day''s sync items rejected before an MR is flagged.'),
  ('rejection_min_items',      '5'::jsonb,   'count',
   'Minimum items in a day before the rejection rate is meaningful.'),
  ('consent_deviation',        '0.4'::jsonb, 'ratio',
   'Absolute deviation from the team median consent rate that raises an anomaly.'),
  ('consent_min_captures',     '3'::jsonb,   'count',
   'Minimum consent captures by one MR before their rate is compared.'),
  ('consent_min_team_size',    '8'::jsonb,   'count',
   'Minimum comparison-group size before a consent anomaly is emitted at all. '
   'Below this the median is one or two people''s behaviour and the signal is noise.'),
  -- Null by default. With nothing configured, behaviour is exactly as before:
  -- a territory with no window of its own refuses every capture.
  ('org_default_shift_window', 'null'::jsonb, null,
   'Organisation-wide fallback shift window. Null means no fallback: refuse. '
   'Every capture made under it is flagged and surfaced as a manager exception.');

-- ----------------------------------------------------------------------------
-- 3. Shift window resolution, now with a flagged fallback
-- ----------------------------------------------------------------------------

create type public.shift_window_source_kind as enum ('territory', 'org_default');

-- Returns no rows when nothing is configured anywhere. That is still a refusal —
-- the default is only a fallback if somebody deliberately configured one.
create or replace function public.resolve_shift_window(p_territory_id uuid)
returns table (
  shift_start                time,
  shift_end                  time,
  timezone                   text,
  grace_minutes              integer,
  active_weekdays            smallint[],
  source                     public.shift_window_source_kind,
  resolved_from_territory_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_window public.territory_shift_windows%rowtype;
  v_default jsonb;
begin
  v_window := public.effective_shift_window(p_territory_id);

  if v_window.id is not null then
    return query select v_window.shift_start, v_window.shift_end, v_window.timezone,
                        v_window.grace_minutes, v_window.active_weekdays,
                        'territory'::public.shift_window_source_kind, v_window.territory_id;
    return;
  end if;

  v_default := public.threshold('org_default_shift_window');

  if v_default is null or jsonb_typeof(v_default) = 'null' then
    return;
  end if;

  return query select
    (v_default ->> 'shiftStart')::time,
    (v_default ->> 'shiftEnd')::time,
    coalesce(v_default ->> 'timezone', 'Asia/Kolkata'),
    coalesce((v_default ->> 'graceMinutes')::integer, 15),
    coalesce(
      (select array_agg(value::text::smallint)
         from jsonb_array_elements_text(coalesce(v_default -> 'activeWeekdays', '[1,2,3,4,5,6]'::jsonb)) value),
      '{1,2,3,4,5,6}'::smallint[]),
    'org_default'::public.shift_window_source_kind,
    null::uuid;
end;
$$;

create or replace function public.is_within_shift(
  p_territory_id uuid,
  p_occurred_at  timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_window     record;
  v_local      timestamp;
  v_local_time time;
  v_weekday    smallint;
begin
  select * into v_window from public.resolve_shift_window(p_territory_id);

  if not found then
    raise exception 'no shift window configured for territory % or any ancestor, and no organisation default', p_territory_id
      using errcode = '22023',
            hint = 'Insert a territory_shift_windows row, or set the org_default_shift_window threshold.';
  end if;

  v_local := p_occurred_at at time zone v_window.timezone;
  v_local_time := v_local::time;
  v_weekday := extract(isodow from v_local)::smallint;

  if not (v_weekday = any (v_window.active_weekdays)) then
    return false;
  end if;

  return v_local_time >= (v_window.shift_start - make_interval(mins => v_window.grace_minutes))
     and v_local_time <= (v_window.shift_end   + make_interval(mins => v_window.grace_minutes));
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. The flag — stored, not derived
-- ----------------------------------------------------------------------------

-- Written server-side at capture time. Derived at read time it would silently
-- change meaning the moment somebody configured a territory window afterwards, and
-- the whole point is a durable record of what the capture was actually judged
-- against.
--
-- check_outs carries it too. The prompt named check_ins; a manager seeing flagged
-- check-ins but unflagged check-outs would be looking at half the picture, and the
-- asymmetry is the kind of thing that gets exploited rather than noticed.
alter table public.check_ins  add column shift_window_source public.shift_window_source_kind;
alter table public.check_outs add column shift_window_source public.shift_window_source_kind;

create index check_ins_org_default_idx on public.check_ins (mr_id, occurred_at)
  where shift_window_source = 'org_default';

create or replace function public.record_check_in(
  p_id          uuid,
  p_visit_id    uuid,
  p_latitude    double precision,
  p_longitude   double precision,
  p_occurred_at timestamptz,
  p_accuracy_metres double precision default null,
  p_source      public.capture_source default 'automatic'
)
returns public.check_ins
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid        uuid;
  v_visit      public.visits%rowtype;
  v_doctor     public.doctors%rowtype;
  v_clinic     public.clinic_addresses%rowtype;
  v_existing   public.check_ins%rowtype;
  v_distance   double precision;
  v_geofence   public.geofence_status;
  v_window     record;
  v_row        public.check_ins%rowtype;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_existing from public.check_ins c where c.id = p_id;
  if found then
    if v_existing.mr_id <> v_uid then
      raise exception 'check-in % belongs to another user', p_id using errcode = '42501';
    end if;
    return v_existing;
  end if;

  select * into v_visit from public.visits v where v.id = p_visit_id and v.mr_id = v_uid;
  if not found then
    raise exception 'visit % is not yours', p_visit_id using errcode = '42501';
  end if;

  select * into v_doctor from public.doctors d where d.id = v_visit.doctor_id;

  if not public.is_within_shift(v_doctor.territory_id, p_occurred_at) then
    raise exception 'check-in at % is outside the configured shift window for territory %',
      p_occurred_at, v_doctor.territory_id
      using errcode = '22023';
  end if;

  select * into v_window from public.resolve_shift_window(v_doctor.territory_id);

  if v_visit.clinic_address_id is not null then
    select * into v_clinic from public.clinic_addresses a where a.id = v_visit.clinic_address_id;
    v_distance := public.distance_metres(p_latitude, p_longitude, v_clinic.latitude, v_clinic.longitude);
  end if;

  v_geofence := case
    when v_distance is null then 'unavailable'::public.geofence_status
    when v_distance <= coalesce(v_clinic.geofence_radius_metres, 150) then 'inside'::public.geofence_status
    else 'outside'::public.geofence_status
  end;

  insert into public.check_ins
    (id, visit_id, mr_id, latitude, longitude, accuracy_metres,
     geofence_status, distance_from_clinic_metres, source, occurred_at, shift_window_source)
  values
    (p_id, p_visit_id, v_uid, p_latitude, p_longitude, p_accuracy_metres,
     v_geofence, v_distance, p_source, p_occurred_at, v_window.source)
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.record_check_out(
  p_id          uuid,
  p_visit_id    uuid,
  p_latitude    double precision,
  p_longitude   double precision,
  p_occurred_at timestamptz,
  p_accuracy_metres double precision default null,
  p_source      public.capture_source default 'automatic'
)
returns public.check_outs
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid       uuid;
  v_visit     public.visits%rowtype;
  v_doctor    public.doctors%rowtype;
  v_clinic    public.clinic_addresses%rowtype;
  v_existing  public.check_outs%rowtype;
  v_check_in  public.check_ins%rowtype;
  v_distance  double precision;
  v_geofence  public.geofence_status;
  v_duration  integer;
  v_window    record;
  v_row       public.check_outs%rowtype;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_existing from public.check_outs c where c.id = p_id;
  if found then
    if v_existing.mr_id <> v_uid then
      raise exception 'check-out % belongs to another user', p_id using errcode = '42501';
    end if;
    return v_existing;
  end if;

  select * into v_visit from public.visits v where v.id = p_visit_id and v.mr_id = v_uid;
  if not found then
    raise exception 'visit % is not yours', p_visit_id using errcode = '42501';
  end if;

  select * into v_doctor from public.doctors d where d.id = v_visit.doctor_id;

  if not public.is_within_shift(v_doctor.territory_id, p_occurred_at) then
    raise exception 'check-out at % is outside the configured shift window for territory %',
      p_occurred_at, v_doctor.territory_id
      using errcode = '22023';
  end if;

  select * into v_window from public.resolve_shift_window(v_doctor.territory_id);

  if v_visit.clinic_address_id is not null then
    select * into v_clinic from public.clinic_addresses a where a.id = v_visit.clinic_address_id;
    v_distance := public.distance_metres(p_latitude, p_longitude, v_clinic.latitude, v_clinic.longitude);
  end if;

  v_geofence := case
    when v_distance is null then 'unavailable'::public.geofence_status
    when v_distance <= coalesce(v_clinic.geofence_radius_metres, 150) then 'inside'::public.geofence_status
    else 'outside'::public.geofence_status
  end;

  select * into v_check_in
    from public.check_ins c
   where c.visit_id = p_visit_id
   order by c.occurred_at asc
   limit 1;

  if v_check_in.id is not null then
    v_duration := greatest(0, extract(epoch from (p_occurred_at - v_check_in.occurred_at))::integer);
  end if;

  insert into public.check_outs
    (id, visit_id, mr_id, latitude, longitude, accuracy_metres,
     geofence_status, distance_from_clinic_metres, source, occurred_at, duration_seconds,
     shift_window_source)
  values
    (p_id, p_visit_id, v_uid, p_latitude, p_longitude, p_accuracy_metres,
     v_geofence, v_distance, p_source, p_occurred_at, v_duration, v_window.source)
  returning * into v_row;

  return v_row;
end;
$$;

-- my_shift_window reports the source too, so the app can say "these are the
-- organisation defaults, not your territory's hours".
create or replace function public.my_shift_window()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid       uuid;
  v_territory uuid;
  v_window    record;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select p.territory_id into v_territory
    from public.user_profiles p
   where p.id = v_uid and p.is_active;

  if v_territory is null then
    return jsonb_build_object('window', null, 'source', null, 'resolvedFromTerritoryId', null);
  end if;

  select * into v_window from public.resolve_shift_window(v_territory);

  if not found then
    return jsonb_build_object('window', null, 'source', null, 'resolvedFromTerritoryId', null);
  end if;

  return jsonb_build_object(
    'window', jsonb_build_object(
      'shiftStart', v_window.shift_start::text,
      'shiftEnd', v_window.shift_end::text,
      'timezone', v_window.timezone,
      'graceMinutes', v_window.grace_minutes,
      'activeWeekdays', to_jsonb(v_window.active_weekdays)),
    'source', v_window.source,
    'resolvedFromTerritoryId', v_window.resolved_from_territory_id);
end;
$$;

-- daily_mileage resolved the timezone through effective_shift_window, which now
-- misses the org default.
create or replace function public.daily_mileage(
  p_from   date,
  p_to     date,
  p_mr_id  uuid default null
)
returns table (
  mr_id          uuid,
  travel_date    date,
  check_in_count integer,
  distance_metres double precision
)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
  with scoped as (
    select c.mr_id,
           c.occurred_at,
           c.latitude,
           c.longitude,
           (c.occurred_at at time zone coalesce(
              (select w.timezone from public.resolve_shift_window(d.territory_id) w),
              'Asia/Kolkata'))::date as travel_date
      from public.check_ins c
      join public.visits  v on v.id = c.visit_id
      join public.doctors d on d.id = v.doctor_id
     where c.mr_id in (select public.visible_user_ids())
       and (p_mr_id is null or c.mr_id = p_mr_id)
  ),
  ordered as (
    select s.mr_id, s.travel_date, s.latitude, s.longitude,
           lag(s.latitude)  over w as prev_latitude,
           lag(s.longitude) over w as prev_longitude
      from scoped s
     where s.travel_date between p_from and p_to
    window w as (partition by s.mr_id, s.travel_date order by s.occurred_at)
  )
  select o.mr_id, o.travel_date, count(*)::integer,
         coalesce(sum(public.distance_metres(o.prev_latitude, o.prev_longitude,
                                             o.latitude, o.longitude)), 0)
    from ordered o
   group by o.mr_id, o.travel_date
   order by o.travel_date desc, o.mr_id;
$$;

-- ----------------------------------------------------------------------------
-- 5. team_exceptions — thresholds from config, a team-size floor, and the flag
-- ----------------------------------------------------------------------------

alter type public.team_exception_kind add value 'org_default_shift_window';
