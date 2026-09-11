-- MR-24 B -- a check-in never marked the visit started, so CHECK-OUT WAS UNREACHABLE.
--
-- Found on the emulator after the first check-in in this project's history was accepted:
-- `check_ins` had the row, and `visits` still said `planned` with `started_at` null. The
-- screen still read "Not started" and still offered "I am here -- check in".
--
-- `record_check_out` ends with `update public.visits set status = ..., completed_at = ...`.
-- `record_check_in` did not touch `public.visits` at all. `visit_status` has an
-- `in_progress` value and `visits` has a `started_at` column, and **nothing in the write
-- path ever set either one**.
--
-- The severity is not the missing timestamp. `stageOf()` returns 'during' only for
-- `in_progress`, and `app/visit/[id].tsx` calls `createCheckOut` only in the 'during'
-- stage -- so check-out could not be performed from the app at all. One of the five writes
-- `G-WRITE` is about was impossible, because the client read a state the server never wrote.
--
-- See the comment at the update itself for why it is guarded to `planned` only, why
-- `started_at` is coalesced, and why the geofence is deliberately not consulted.

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
      using errcode = '45003';
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

  -- MR-24 B DEFECT 4. The visit becomes `in_progress`, and remembers when.
  --
  -- Before this, `record_check_in` inserted the check-in and touched `public.visits` not at
  -- all, while `record_check_out` ended with exactly such an update. So a visit went
  -- `planned` -> (check-in: nothing) -> `completed`, `visits.started_at` stayed NULL
  -- forever, and the `in_progress` value of `visit_status` was written by nothing anywhere.
  --
  -- That was not cosmetic. `stageOf()` in the client returns 'during' ONLY for
  -- `in_progress`, and the visit screen calls `createCheckOut` only in the 'during' stage.
  -- **Check-out was therefore unreachable from the app** -- one of the five writes could not
  -- be performed at all. The client read a state the server never wrote; each half was
  -- correct and nobody joined them.
  --
  -- It also made Today's "Started HH:MM" line -- which reads `visits.started_at` --
  -- renderable only from seeded rows. Two sessions verified that line against `seed-day.mjs`
  -- data and called it correct.
  --
  -- Only from `planned`. A late or replayed check-in must not drag a `completed`,
  -- `not_met` or `cancelled` visit backwards into `in_progress`; `record_check_out` is the
  -- only thing that decides a visit is over, and this must not undo it.
  --
  -- `coalesce` on `started_at` mirrors `record_check_out`'s `coalesce(v.completed_at, ...)`:
  -- the FIRST arrival is when the MR got there, and a replay must not restamp it.
  --
  -- The geofence is deliberately NOT consulted here. `record_check_out` sets `completed`
  -- whatever `geofence_status` says, and this function already accepts and records an
  -- `outside` check-in rather than refusing it -- so making the visit's status depend on the
  -- geofence would be a new rule, invented in the wrong place. Whether an out-of-geofence
  -- check-in should start a visit is a real product question and is registered as one.
  update public.visits v
     set status     = 'in_progress'::public.visit_status,
         started_at = coalesce(v.started_at, p_occurred_at)
   where v.id = p_visit_id
     and v.status = 'planned'::public.visit_status;

  return v_row;
end;
$function$;
