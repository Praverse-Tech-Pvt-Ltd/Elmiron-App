-- Rollback for 20260907000400_shift_refusal_codes.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- Restores the three functions to raising 22023 for the shift-window refusals.
--
-- The consequence is worth stating: 22023 is raised 64 times across these migrations, so
-- after this rollback the error contract in packages/core can no longer tell a
-- shift-window refusal from any other invalid-parameter refusal. The MR gets a generic
-- failure where they used to get an action. Nothing breaks; the app becomes less useful.
--
-- These are the verbatim pre-migration definitions.

CREATE OR REPLACE FUNCTION public.is_within_shift(p_territory_id uuid, p_occurred_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_window     record;
  v_default    jsonb;
  v_local      timestamp;
  v_local_time time;
  v_weekday    smallint;
begin
  select * into v_window from public.resolve_shift_window(p_territory_id);

  if not found then
    v_default := public.threshold('org_default_shift_window');

    if v_default is not null and jsonb_typeof(v_default) <> 'null' then
      raise exception
        'the organisation default shift window expired on %; territory % still has no window of its own',
        coalesce(v_default ->> 'expiresAt', 'an unrecorded date'), p_territory_id
        using errcode = '22023',
              hint = 'This was always temporary. Configure the territory''s real working hours.';
    end if;

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
$function$;

CREATE OR REPLACE FUNCTION public.record_check_in(p_id uuid, p_visit_id uuid, p_latitude double precision, p_longitude double precision, p_occurred_at timestamp with time zone, p_accuracy_metres double precision DEFAULT NULL::double precision, p_source capture_source DEFAULT 'automatic'::capture_source)
 RETURNS check_ins
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.record_check_out(p_id uuid, p_visit_id uuid, p_latitude double precision, p_longitude double precision, p_occurred_at timestamp with time zone, p_accuracy_metres double precision DEFAULT NULL::double precision, p_source capture_source DEFAULT 'automatic'::capture_source)
 RETURNS check_outs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

