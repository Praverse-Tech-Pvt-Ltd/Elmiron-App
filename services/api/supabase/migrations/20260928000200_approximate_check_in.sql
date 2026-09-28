-- W1-C A2 / CR-4 -- a check-in says when its fix was too coarse to judge. `BE-C2`.
--
-- **The ruling, and what it deliberately does NOT do.** The reviewer ruled (`BE-C2`) that the
-- geofence VERDICT keeps using the centre point: *a verdict that silently changes meaning with fix
-- quality is worse than one that is wrong the same way every time.* An accuracy-widened geofence
-- would make "inside" mean something different for every check-in, and no screen or report could
-- say which. Wrong-but-consistent is auditable; wrong-but-variable is not.
--
-- So `v_geofence` below is **byte-for-byte the expression it already was**. What is added is a
-- separate, non-blocking fact.
--
-- **The question this answers, from the frontend (CR-4).** Since FE-D2 10, an approximate-only
-- location grant (Android 12+) is treated as granted by operator ruling. A rep on approximate-only
-- sends fixes that can be kilometres wide against a 150 m geofence, `record_check_in` stored the
-- accuracy and **nothing read it**, so an approximate fix was indistinguishable from a precise one.
--
-- **The rule: approximate when the reported accuracy radius exceeds the clinic's geofence radius.**
-- That threshold is the only one with a meaning rather than a taste: if the error radius is larger
-- than the circle being tested, the fix cannot place the rep inside or outside it, and the verdict
-- -- whatever it says -- was decided by a coin. Below that, the fix is at least capable of
-- answering the question.
--
-- **NOTHING IS REFUSED ON THIS FLAG.** It is a fact recorded beside the verdict, not a second
-- verdict. A rep who granted approximate-only can still work; `constraints.md` requires a control
-- that can be exercised, and refusing here would stop an MR the operator explicitly allowed.
--
-- **Which side owns which fact** (`constraints.md`, FIX-02):
--   * the ACCURACY is the device's -- witnessed by the handset, recorded as sent, never re-derived;
--   * the RADIUS and therefore the FLAG are the server's -- it owns the clinic and re-derives the
--     comparison at write time, so a client cannot claim its fix was precise.
--
-- `check_outs` is deliberately left alone. CR-4 asks about check-in; a check-out's geofence carries
-- no UCPMP or attendance meaning in this schema today, and widening scope past the question would
-- put an unreviewed column on a second table.

alter table public.check_ins
  -- Null, not false, for every row written before this migration. A `false` would assert that
  -- 3,000 historical check-ins had good fixes, which nothing in the data supports -- the flag was
  -- not computed when they were written. Null means "not assessed" and reads as exactly that.
  add column location_is_approximate boolean;

comment on column public.check_ins.location_is_approximate is
  'W1-C A2 / CR-4 / BE-C2. True when the device-reported accuracy radius exceeded the clinic''s '
  'geofence radius, so the fix could not place the rep inside or outside it. NULL for rows written '
  'before this migration -- not assessed, not "good". The geofence VERDICT ignores this by ruling: '
  'a verdict that changes meaning with fix quality is worse than one that is wrong consistently. '
  'Nothing is refused on this flag.';

/**
 * `record_check_in` -- W1-C A2 replaces MR-24 B's version.
 *
 * **The body below is the LIVE definition, read out of `pg_proc.prosrc`, with exactly three
 * additions: two locals, the flag computation, and the extra insert column.** It was produced that
 * way rather than retyped, and the reason is worth recording: my first attempt at this migration was
 * written by reading the source file, and it silently DROPPED the idempotency block --
 *
 *     select * into v_existing from public.check_ins c where c.id = p_id;
 *     if found then ... return v_existing; end if;
 *
 * -- which is what makes a replayed check-in return the existing row instead of colliding on the
 * primary key. Removing it would have broken the offline replay path the frontend had just proved
 * (FE-D1: queued writes survive process death and flush exactly once). It also used
 * `within_shift_window` for what is really `is_within_shift`, and a different refusal message.
 *
 * **Three defects in one hand-transcribed function body.** Anything that re-states an existing
 * function should be generated from the authoritative definition, not from a reading of it.
 */
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
