-- ============================================================================
-- BE-W3 · Field operations: server-side capture, work hours, mileage, search
--
-- Three things the client is not trusted with, and all three are enforced here:
--
--   1. WHEN something happened. The device is offline-first and its clock is
--      unreliable, so every client-originated row now carries `received_at`
--      alongside the client's `occurred_at`. `received_at` is stamped by a trigger
--      and cannot be supplied.
--   2. WHERE it happened relative to the clinic. Geofence status and distance are
--      computed from the stored clinic coordinates, not read from the request.
--   3. WHETHER it is inside working hours. Evaluated against the territory's
--      configured shift window, in the territory's own timezone.
--
-- Mileage is computed from stored coordinates for the same reason: a client-
-- reported distance is an expense claim the client wrote itself.
--
-- Rollback: services/api/rollbacks/20260812000100_field_operations.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. received_at — server receipt time, on every client-originated row
-- ----------------------------------------------------------------------------

-- `occurred_at` is what the device says. `received_at` is when the server took
-- delivery. Both are needed to reconcile a day that synced six hours late, and
-- adding the second one after there is real data in these tables means a backfill
-- with no true value to backfill from.
--
-- clock_timestamp(), not now(): now() is transaction start, which for a batched
-- offline sync is the same instant for fifty rows that arrived over four seconds.
-- The week-9 adverse-event SLA clock starts at ingest and will read this column.

alter table public.visits             add column received_at timestamptz not null default clock_timestamp();
alter table public.check_ins          add column received_at timestamptz not null default clock_timestamp();
alter table public.check_outs         add column received_at timestamptz not null default clock_timestamp();
alter table public.call_reports       add column received_at timestamptz not null default clock_timestamp();
alter table public.samples_and_inputs add column received_at timestamptz not null default clock_timestamp();
alter table public.consent_records    add column received_at timestamptz not null default clock_timestamp();

-- A default is not enforcement: a client can POST a received_at and override it.
-- This trigger makes the column unwritable in practice, for every role.
create or replace function public.stamp_received_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.received_at = clock_timestamp();
  return new;
end;
$$;

create trigger visits_stamp_received_at
  before insert on public.visits
  for each row execute function public.stamp_received_at();
create trigger check_ins_stamp_received_at
  before insert on public.check_ins
  for each row execute function public.stamp_received_at();
create trigger check_outs_stamp_received_at
  before insert on public.check_outs
  for each row execute function public.stamp_received_at();
create trigger call_reports_stamp_received_at
  before insert on public.call_reports
  for each row execute function public.stamp_received_at();
create trigger samples_and_inputs_stamp_received_at
  before insert on public.samples_and_inputs
  for each row execute function public.stamp_received_at();
create trigger consent_records_stamp_received_at
  before insert on public.consent_records
  for each row execute function public.stamp_received_at();

comment on column public.check_ins.received_at is
  'When the server took delivery. Stamped by trigger; a client-supplied value is '
  'discarded. Pair with occurred_at to reconcile a late sync.';

-- ----------------------------------------------------------------------------
-- 2. Distance, without an extension
-- ----------------------------------------------------------------------------

-- Haversine on a spherical earth. Accurate to a few metres over the distances a
-- medical representative covers in a day, which is all that is needed for a
-- geofence radius and an expense claim.
--
-- Deliberately not PostGIS or earthdistance: this is two call sites, and adding a
-- spatial extension to a Supabase project for two call sites is a dependency to
-- maintain forever.
create or replace function public.distance_metres(
  p_lat_a double precision,
  p_lon_a double precision,
  p_lat_b double precision,
  p_lon_b double precision
)
returns double precision
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_lat_a is null or p_lon_a is null or p_lat_b is null or p_lon_b is null
      then null
    else 6371000.0 * 2.0 * asin(least(1.0, sqrt(
           power(sin(radians(p_lat_b - p_lat_a) / 2.0), 2.0)
           + cos(radians(p_lat_a)) * cos(radians(p_lat_b))
             * power(sin(radians(p_lon_b - p_lon_a) / 2.0), 2.0)
         )))
  end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Shift windows — configuration, not a constant
-- ----------------------------------------------------------------------------

-- Working hours vary by territory, so this is a table and not a hardcoded pair of
-- times. A territory with no row of its own inherits the nearest ancestor's window;
-- if no ancestor has one either, capture is REJECTED with a message naming the
-- missing configuration rather than silently defaulting to something plausible.
create table public.territory_shift_windows (
  id              uuid primary key default gen_random_uuid(),
  territory_id    uuid not null unique references public.territories (id) on delete cascade,
  shift_start     time not null,
  shift_end       time not null,
  -- IANA name. Indian deployment, but this is per-territory config, not a constant.
  timezone        text not null default 'Asia/Kolkata',
  -- Tolerance either side. An MR who checks in four minutes early is not a fraud case.
  grace_minutes   integer not null default 15 check (grace_minutes between 0 and 240),
  -- ISO weekdays: 1 = Monday .. 7 = Sunday. Six-day weeks are the Indian norm.
  active_weekdays smallint[] not null default '{1,2,3,4,5,6}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- A window that crosses midnight is not a field-force shift; it is a data entry
  -- error, and accepting it would make the range check below silently wrong.
  constraint territory_shift_windows_end_after_start check (shift_end > shift_start),
  constraint territory_shift_windows_weekdays_valid
    check (array_length(active_weekdays, 1) between 1 and 7
           and active_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[])
);

create trigger territory_shift_windows_set_updated_at
  before update on public.territory_shift_windows
  for each row execute function public.set_updated_at();

create trigger territory_shift_windows_audit
  after insert or update or delete on public.territory_shift_windows
  for each row execute function public.write_audit_row();

comment on table public.territory_shift_windows is
  'Per-territory working hours. Inherited down the territory tree. Absence is an '
  'error, not a default: capture outside a configured window is rejected.';

create or replace function public.effective_shift_window(p_territory_id uuid)
returns public.territory_shift_windows
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_window public.territory_shift_windows%rowtype;
  v_cursor uuid := p_territory_id;
  v_hops   integer := 0;
begin
  -- Walk up until a window is found. Bounded because the territory tree has a
  -- write-time cycle guard, but bounded explicitly anyway.
  while v_cursor is not null and v_hops < 64 loop
    select * into v_window
      from public.territory_shift_windows w
     where w.territory_id = v_cursor;

    if found then
      return v_window;
    end if;

    select t.parent_id into v_cursor
      from public.territories t
     where t.id = v_cursor;

    v_hops := v_hops + 1;
  end loop;

  return null;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Work-hours check
-- ----------------------------------------------------------------------------

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
  v_window     public.territory_shift_windows%rowtype;
  v_local      timestamp;
  v_local_time time;
  v_weekday    smallint;
begin
  v_window := public.effective_shift_window(p_territory_id);

  if v_window.id is null then
    raise exception 'no shift window configured for territory % or any ancestor', p_territory_id
      using errcode = '22023',
            hint = 'Insert a row into public.territory_shift_windows for this territory or a parent.';
  end if;

  -- Evaluated in the territory's own timezone. Comparing a UTC clock against a
  -- local shift window is a five-and-a-half-hour error in this deployment.
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
-- 5. Check-in and check-out
-- ----------------------------------------------------------------------------

-- Why an RPC rather than a plain INSERT through PostgREST: RLS decides which rows
-- a caller may write, never what the values must be. Work hours, the geofence
-- computation and the duration all have to run server-side, and none of them is
-- expressible as a policy.
--
-- Idempotent on the client-generated id. A retry after a dropped connection
-- returns the row that already exists rather than a duplicate-key error, because
-- on a bad connection the retry is certain and the client cannot tell whether the
-- first attempt landed.

alter table public.check_outs
  add column duration_seconds integer check (duration_seconds >= 0);

comment on column public.check_outs.duration_seconds is
  'Seconds between the visit''s earliest check-in and this check-out, computed '
  'server-side by public.record_check_out. Null when no check-in has arrived yet.';

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
  v_row        public.check_ins%rowtype;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Idempotency first: a retry must not be rejected for being out of hours when
  -- the original attempt already succeeded inside them.
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

  -- Geofence computed here, never taken from the request. A client that reports
  -- "inside" from three kilometres away is exactly the case this defends.
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
     geofence_status, distance_from_clinic_metres, source, occurred_at)
  values
    (p_id, p_visit_id, v_uid, p_latitude, p_longitude, p_accuracy_metres,
     v_geofence, v_distance, p_source, p_occurred_at)
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

  if v_visit.clinic_address_id is not null then
    select * into v_clinic from public.clinic_addresses a where a.id = v_visit.clinic_address_id;
    v_distance := public.distance_metres(p_latitude, p_longitude, v_clinic.latitude, v_clinic.longitude);
  end if;

  v_geofence := case
    when v_distance is null then 'unavailable'::public.geofence_status
    when v_distance <= coalesce(v_clinic.geofence_radius_metres, 150) then 'inside'::public.geofence_status
    else 'outside'::public.geofence_status
  end;

  -- Duration comes from the matching check-in's occurred_at, ordered by occurred_at
  -- rather than by arrival. A day's captures can land in any sequence.
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
     geofence_status, distance_from_clinic_metres, source, occurred_at, duration_seconds)
  values
    (p_id, p_visit_id, v_uid, p_latitude, p_longitude, p_accuracy_metres,
     v_geofence, v_distance, p_source, p_occurred_at, v_duration)
  returning * into v_row;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Mileage
-- ----------------------------------------------------------------------------

-- Sum of the straight-line distance between consecutive check-ins, per MR per day,
-- ordered by occurred_at. Ordering by arrival would produce a different — and
-- wrong — total for any day that synced out of order, which is most of them.
--
-- This feeds the MR's expense claim, so it is computed from stored coordinates and
-- never from anything the client reports.
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
           -- Local calendar day, so a 22:00 IST check-in is not filed under tomorrow.
           (c.occurred_at at time zone coalesce(
              (public.effective_shift_window(d.territory_id)).timezone, 'Asia/Kolkata'))::date as travel_date
      from public.check_ins c
      join public.visits  v on v.id = c.visit_id
      join public.doctors d on d.id = v.doctor_id
     where c.mr_id in (select public.visible_user_ids())
       and (p_mr_id is null or c.mr_id = p_mr_id)
  ),
  ordered as (
    select s.mr_id,
           s.travel_date,
           s.latitude,
           s.longitude,
           lag(s.latitude)  over w as prev_latitude,
           lag(s.longitude) over w as prev_longitude
      from scoped s
     where s.travel_date between p_from and p_to
    window w as (partition by s.mr_id, s.travel_date order by s.occurred_at)
  )
  select o.mr_id,
         o.travel_date,
         count(*)::integer as check_in_count,
         coalesce(sum(public.distance_metres(o.prev_latitude, o.prev_longitude,
                                             o.latitude, o.longitude)), 0) as distance_metres
    from ordered o
   group by o.mr_id, o.travel_date
   order by o.travel_date desc, o.mr_id;
$$;

comment on function public.daily_mileage(date, date, uuid) is
  'Per-MR per-day travel distance from stored check-in coordinates. Bounded by '
  'visible_user_ids(): an MR sees their own, a manager sees their team.';

-- ----------------------------------------------------------------------------
-- 7. Doctor search — indexed, not a sequential scan
-- ----------------------------------------------------------------------------

-- An MR standing in a waiting room needs a doctor in under three seconds. Trigram
-- indexes make partial, misspelling-tolerant name search fast without a full-text
-- configuration nobody will tune.
create extension if not exists pg_trgm with schema extensions;

create index doctors_full_name_trgm_idx
  on public.doctors using gin (full_name extensions.gin_trgm_ops);

create index doctors_specialty_trgm_idx
  on public.doctors using gin (specialty extensions.gin_trgm_ops);

-- The common filtered listing: active doctors in a territory, alphabetical.
create index doctors_territory_active_name_idx
  on public.doctors (territory_id, is_active, full_name);

create index doctors_registration_number_idx
  on public.doctors (registration_number)
  where registration_number is not null;

create index beat_plans_territory_date_idx on public.beat_plans (territory_id, plan_date desc);

-- SECURITY INVOKER on purpose: the doctors RLS policy is the scope filter, so this
-- function cannot widen it. It exists to make the `search` field already declared
-- in packages/core real, and to keep the index-friendly query shape in one place.
create or replace function public.search_doctors(
  p_query        text default null,
  p_territory_id uuid default null,
  p_limit        integer default 50
)
returns setof public.doctors
language sql
stable
set search_path = ''
as $$
  select d.*
    from public.doctors d
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
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

-- ----------------------------------------------------------------------------
-- 8. Security boundary for everything added above
-- ----------------------------------------------------------------------------

alter table public.territory_shift_windows enable row level security;
alter table public.territory_shift_windows force row level security;

revoke all on table public.territory_shift_windows from anon, authenticated;

-- An MR needs to see their own working hours; the app tells them why a capture was
-- refused. Scoped to territories they can already see.
create policy territory_shift_windows_select_visible
  on public.territory_shift_windows for select to authenticated
  using (territory_id in (select public.current_user_visible_territory_ids()));

create policy territory_shift_windows_admin_all
  on public.territory_shift_windows for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on table public.territory_shift_windows to authenticated;

-- Direct INSERT on check_ins/check_outs is withdrawn. Capture goes through the
-- RPCs, which is the only place work hours and the geofence can be enforced.
-- Leaving the INSERT policy in place would leave a path that skips both.
drop policy if exists check_ins_insert_own  on public.check_ins;
drop policy if exists check_outs_insert_own on public.check_outs;
revoke insert on table public.check_ins  from authenticated;
revoke insert on table public.check_outs from authenticated;

grant execute on function public.distance_metres(double precision, double precision, double precision, double precision) to authenticated;
grant execute on function public.effective_shift_window(uuid) to authenticated;
grant execute on function public.is_within_shift(uuid, timestamptz) to authenticated;
grant execute on function public.record_check_in(uuid, uuid, double precision, double precision, timestamptz, double precision, public.capture_source) to authenticated;
grant execute on function public.record_check_out(uuid, uuid, double precision, double precision, timestamptz, double precision, public.capture_source) to authenticated;
grant execute on function public.daily_mileage(date, date, uuid) to authenticated;
grant execute on function public.search_doctors(text, uuid, integer) to authenticated;

revoke execute on function public.stamp_received_at() from public, anon, authenticated;
