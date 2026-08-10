-- Rollback for 20260815000100_thresholds_and_shift_defaults.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- Restores the strict rule: a territory with no configured window refuses every
-- capture, with no organisation-level fallback and no flag.
--
-- record_check_in and record_check_out are restored to their BE-W5 bodies here,
-- because this migration replaced them to stamp shift_window_source and the column
-- is dropped below.

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
  v_window    public.territory_shift_windows%rowtype;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select p.territory_id into v_territory
    from public.user_profiles p where p.id = v_uid and p.is_active;

  if v_territory is null then
    return jsonb_build_object('window', null, 'resolvedFromTerritoryId', null);
  end if;

  v_window := public.effective_shift_window(v_territory);

  if v_window.id is null then
    return jsonb_build_object('window', null, 'resolvedFromTerritoryId', null);
  end if;

  return jsonb_build_object(
    'window', to_jsonb(v_window),
    'resolvedFromTerritoryId', v_window.territory_id);
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
  v_window     public.territory_shift_windows%rowtype;
  v_local      timestamp;
  v_local_time time;
  v_weekday    smallint;
begin
  v_window := public.effective_shift_window(p_territory_id);

  if v_window.id is null then
    raise exception 'no shift window configured for territory % or any ancestor', p_territory_id
      using errcode = '22023';
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
  v_uid      uuid;
  v_visit    public.visits%rowtype;
  v_doctor   public.doctors%rowtype;
  v_clinic   public.clinic_addresses%rowtype;
  v_existing public.check_ins%rowtype;
  v_distance double precision;
  v_geofence public.geofence_status;
  v_row      public.check_ins%rowtype;
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
      p_occurred_at, v_doctor.territory_id using errcode = '22023';
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
  v_uid      uuid;
  v_visit    public.visits%rowtype;
  v_doctor   public.doctors%rowtype;
  v_clinic   public.clinic_addresses%rowtype;
  v_existing public.check_outs%rowtype;
  v_check_in public.check_ins%rowtype;
  v_distance double precision;
  v_geofence public.geofence_status;
  v_duration integer;
  v_row      public.check_outs%rowtype;
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
      p_occurred_at, v_doctor.territory_id using errcode = '22023';
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

  select * into v_check_in
    from public.check_ins c where c.visit_id = p_visit_id order by c.occurred_at asc limit 1;

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

create or replace function public.daily_mileage(p_from date, p_to date, p_mr_id uuid default null)
returns table (mr_id uuid, travel_date date, check_in_count integer, distance_metres double precision)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
  with scoped as (
    select c.mr_id, c.occurred_at, c.latitude, c.longitude,
           (c.occurred_at at time zone coalesce(
              (public.effective_shift_window(d.territory_id)).timezone, 'Asia/Kolkata'))::date as travel_date
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
    from ordered o group by o.mr_id, o.travel_date order by o.travel_date desc, o.mr_id;
$$;

drop function if exists public.resolve_shift_window(uuid);

alter table public.check_outs drop column if exists shift_window_source;
drop index if exists public.check_ins_org_default_idx;
alter table public.check_ins  drop column if exists shift_window_source;
drop type if exists public.shift_window_source_kind;

drop function if exists public.threshold_number(text, uuid, numeric);
drop function if exists public.threshold(text, uuid);

drop trigger if exists app_thresholds_reject_mutation on public.app_thresholds;
drop trigger if exists app_thresholds_audit           on public.app_thresholds;
drop table if exists public.app_thresholds;
