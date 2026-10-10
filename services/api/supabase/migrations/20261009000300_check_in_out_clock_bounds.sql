-- `BE-W173` -- a check-in or check-out timed in the future is refused; a check-out before its check-in
-- is refused by name.
--
-- **What existed.** `consent_future_tolerance_seconds` (120) is the system's one answer to "how far
-- ahead may a DEVICE clock be": consent capture, withdrawal and visits (`validate_visit` rule 5)
-- all apply it as `occurred > now() + tolerance`. `record_check_in` and `record_check_out` applied
-- nothing. A check-in timed in the future failed only by accident -- the first one sets the visit's
-- `started_at`, which `validate_visit` refuses -- and a later check-in, or any check-out on a visit
-- already completed, was accepted with a future time.
--
-- **The rule here is that same one, the same threshold, the same comparison:** accepted up to and
-- including `now() + 120 s`, refused beyond it. The server's clock is authoritative. Its own code,
-- 45013 `field_event_in_future`, because the remedy sentence is about the phone and must not say
-- "consent" (45007) or "recording" (45009) -- the reason those are separate codes too.
--
-- **What is deliberately NOT added: a bound on OLD events.** A check-in made offline and synced days
-- later is the offline-first design working. Consent and recordings carry a maximum sync lag
-- because a statutory record goes stale; no rule says a check-in does, and none is invented here.
-- The shift window (45003) still applies to the event's own time, as before.
--
-- The two function bodies are `20260928000200`'s and `20260909000300`'s, with the lines marked
-- `BE-W173` added and nothing else changed.
--
-- Rollback: services/api/rollbacks/20261009000300_check_in_out_clock_bounds.down.sql

create or replace function public.assert_field_event_not_in_future(p_what text, p_at timestamptz)
returns void
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_tolerance numeric := coalesce(
    public.threshold_number('consent_future_tolerance_seconds', null, null), 0);
begin
  if p_at is null then
    raise exception 'a % carries no time', p_what using errcode = '22023';
  end if;
  if p_at > now() + make_interval(secs => v_tolerance) then
    raise exception 'field_event_in_future: the % is timed after the server clock', p_what
      using errcode = '45013',
            detail = format('%s at %s is more than %s seconds after the server clock %s',
                            p_what, p_at, v_tolerance::integer, now()),
            hint = 'The phone''s clock is ahead. Turn on automatic date and time, then send again.';
  end if;
end;
$$;

revoke execute on function public.assert_field_event_not_in_future(text, timestamptz) from public, anon, authenticated;

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
  v_radius     double precision;
  v_approximate boolean;
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

  -- `BE-W173`: a device clock ahead of the server is refused, with its own code (45013).
  perform public.assert_field_event_not_in_future('check-in', p_occurred_at);

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

  -- W1-C A2 / CR-4 / `BE-C2`. The SAME radius the verdict used, compared against what the device
  -- reported. The verdict above is untouched by ruling.
  --
  -- Null when the device sent no accuracy, or when there is no clinic to compare against: in both
  -- cases "was this fix good enough for THIS geofence" has no answer, and inventing `false` would
  -- answer it wrongly. `>` not `>=`: an error radius exactly equal to the geofence can still
  -- distinguish the centre from the edge.
  v_radius := coalesce(v_clinic.geofence_radius_metres, 150);
  v_approximate := case
    when p_accuracy_metres is null then null
    when v_distance is null then null
    else p_accuracy_metres > v_radius
  end;

  insert into public.check_ins
    (id, visit_id, mr_id, latitude, longitude, accuracy_metres,
     geofence_status, distance_from_clinic_metres, source, occurred_at, shift_window_source,
     location_is_approximate)
  values
    (p_id, p_visit_id, v_uid, p_latitude, p_longitude, p_accuracy_metres,
     v_geofence, v_distance, p_source, p_occurred_at, v_window.source,
     v_approximate)
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

CREATE OR REPLACE FUNCTION public.record_check_out(p_id uuid, p_visit_id uuid, p_latitude double precision, p_longitude double precision, p_occurred_at timestamp with time zone, p_accuracy_metres double precision DEFAULT NULL::double precision, p_source capture_source DEFAULT 'automatic'::capture_source, p_not_met_reason text DEFAULT NULL::text)
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
  v_reason    text;
  v_status    public.visit_status;
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

  -- `BE-W173`: a device clock ahead of the server is refused, with its own code (45013).
  perform public.assert_field_event_not_in_future('check-out', p_occurred_at);

  select * into v_doctor from public.doctors d where d.id = v_visit.doctor_id;

  if not public.is_within_shift(v_doctor.territory_id, p_occurred_at) then
    raise exception 'check-out at % is outside the configured shift window for territory %',
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

  select * into v_check_in
    from public.check_ins c
   where c.visit_id = p_visit_id
   order by c.occurred_at asc
   limit 1;

  -- `BE-W173`: a check-out before the visit's first check-in is refused by name (45014). It was
  -- clamped to a 0-second duration and then failed on `visits_completed_after_started` as a bare
  -- 23514 -- or, on a visit already completed, accepted with a duration of 0.
  if v_check_in.id is not null and p_occurred_at < v_check_in.occurred_at then
    raise exception 'check_out_before_check_in: check-out at % is before the check-in at %',
      p_occurred_at, v_check_in.occurred_at
      using errcode = '45014',
            detail = format('check-out %s, first check-in %s', p_occurred_at, v_check_in.occurred_at),
            hint = 'The phone''s times are out of order. Check the date and time settings, then send again.';
  end if;

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

  -- ---- MR-12 D2. The visit's OUTCOME, which nothing wrote until now ----
  --
  -- `visits.status` was set on insert and never moved: no function in `public` updated it,
  -- so a checked-out visit stayed `planned` for ever and the day's progress was inferred
  -- from check_out rows rather than stated.
  --
  -- A blank reason is not a reason. `nullif(trim(...), '')` means whitespace cannot buy a
  -- `not_met`, which matters because the constraint pair below trusts this value to be the
  -- difference between two outcomes.
  v_reason := nullif(trim(p_not_met_reason), '');
  v_status := case when v_reason is null then 'completed' else 'not_met' end::public.visit_status;

  -- `completed_at` is stamped for BOTH. A not-met visit still ended -- the MR attended,
  -- and the time they spent doing it is theirs. Recording it only for `completed` would
  -- erase the journey that produced the honest answer, which is the same shape of harm as
  -- scoring `not_met` against them.
  --
  -- Server clock, never the device's: `p_occurred_at` is already bounded by
  -- `validate_visit`, and this is the value the MR is shown as when it happened.
  update public.visits v
     set status       = v_status,
         not_met_reason = v_reason,
         completed_at = coalesce(v.completed_at, p_occurred_at)
   where v.id = p_visit_id;

  return v_row;
end;
$function$;
