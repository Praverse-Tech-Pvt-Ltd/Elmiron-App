-- MR-12 Part D1 (second of two) and D2 -- the reason column, its constraint pair, and
-- record_check_out writing the visit's outcome.
--
-- D1. `not_met_reason` mirrors `consent_records.not_asked_reason` exactly, including the
-- PAIR of constraints. The pair is the whole control:
--
--   visits_not_met_has_reason        status <> 'not_met' OR not_met_reason IS NOT NULL
--   visits_reason_only_when_not_met  status  = 'not_met' OR not_met_reason IS NULL
--
-- The first makes the reason REQUIRED, so `not_met` can never be a bare flag an MR clicked
-- past. The second makes it FORBIDDEN otherwise, so a reason cannot outlive the status it
-- explained -- a visit corrected from `not_met` to `completed` cannot keep "doctor in
-- theatre" attached to it. `consent_records` has both for the same reason and this copies
-- it rather than inventing a second shape for the same idea.
--
-- D2. `record_check_out` resolves the outcome and writes it. Nothing wrote `visits.status`
-- before this migration -- verified, not assumed: no function in `public` contained
-- `update public.visits`.
--
-- **D4 is enforced structurally rather than asserted in prose.** There is no
-- `not_met_by_mr`, no fault column and no attribution to the MR anywhere in this shape.
-- The reason belongs to the VISIT, which belongs to the doctor and the territory. A
-- metric that punishes an honest outcome manufactures dishonest ones, so the schema is
-- not given the column such a metric would need.

alter table public.visits
  add column if not exists not_met_reason text;

comment on column public.visits.not_met_reason is
  'Why the doctor was not available. Required when status is not_met and forbidden '
  'otherwise. Attributed to the territory or the doctor, NEVER scored against the MR.';

alter table public.visits drop constraint if exists visits_not_met_has_reason;
alter table public.visits
  add constraint visits_not_met_has_reason
  check (status <> 'not_met'::public.visit_status or not_met_reason is not null);

alter table public.visits drop constraint if exists visits_reason_only_when_not_met;
alter table public.visits
  add constraint visits_reason_only_when_not_met
  check (status = 'not_met'::public.visit_status or not_met_reason is null);

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

-- The old three-argument-plus-defaults signature is gone; grant the new one and drop the
-- old, so a stale client calling the previous shape fails loudly rather than silently
-- resolving to a function that no longer writes the outcome.
-- A new function in `public` is executable by PUBLIC unless revoked, and `anon` inherits
-- that. rls.spec.ts and privilege-posture.spec.ts both catch it; revoke first, then grant
-- exactly the role that should hold it.
revoke execute on function public.record_check_out(
  uuid, uuid, double precision, double precision, timestamptz, double precision,
  public.capture_source, text) from public, anon;

grant execute on function public.record_check_out(
  uuid, uuid, double precision, double precision, timestamptz, double precision,
  public.capture_source, text) to authenticated;

drop function if exists public.record_check_out(
  uuid, uuid, double precision, double precision, timestamptz, double precision,
  public.capture_source);


-- ---- the outbox path carries the reason too ----
--
-- `apply_sync_item` called `record_check_out` with seven arguments, which still resolves
-- to the new eight-argument signature through its default -- so nothing BREAKS, and a
-- queued check-out would simply have arrived as `completed` with the reason silently
-- dropped. A write that succeeds as the wrong thing is exactly the class Part B swept for.

CREATE OR REPLACE FUNCTION public.apply_sync_item(p_entity sync_entity_kind, p_entity_id uuid, p_payload jsonb)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid      uuid;
  v_warnings text[] := '{}';
  v_beat_plan uuid;
begin
  v_uid := (select auth.uid());

  case p_entity
    when 'visit' then
      v_beat_plan := nullif(p_payload ->> 'beatPlanId', '')::uuid;
      if v_beat_plan is not null and public.beat_plan_is_stale(v_beat_plan) then
        v_warnings := array_append(v_warnings, 'stale_beat_plan');
      end if;

      insert into public.visits (id, mr_id, doctor_id, beat_plan_id, clinic_address_id,
                                 status, scheduled_for, started_at, completed_at)
      values (p_entity_id,
              v_uid,
              (p_payload ->> 'doctorId')::uuid,
              v_beat_plan,
              nullif(p_payload ->> 'clinicAddressId', '')::uuid,
              coalesce(nullif(p_payload ->> 'status', ''), 'planned')::public.visit_status,
              nullif(p_payload ->> 'scheduledFor', '')::timestamptz,
              nullif(p_payload ->> 'startedAt', '')::timestamptz,
              nullif(p_payload ->> 'completedAt', '')::timestamptz)
      on conflict (id) do nothing;

    when 'check_in' then
      perform public.record_check_in(
        p_entity_id,
        (p_payload ->> 'visitId')::uuid,
        (p_payload ->> 'latitude')::double precision,
        (p_payload ->> 'longitude')::double precision,
        (p_payload ->> 'occurredAt')::timestamptz,
        nullif(p_payload ->> 'accuracyMetres', '')::double precision,
        coalesce(nullif(p_payload ->> 'source', ''), 'automatic')::public.capture_source);

    when 'check_out' then
      perform public.record_check_out(
        p_entity_id,
        (p_payload ->> 'visitId')::uuid,
        (p_payload ->> 'latitude')::double precision,
        (p_payload ->> 'longitude')::double precision,
        (p_payload ->> 'occurredAt')::timestamptz,
        nullif(p_payload ->> 'accuracyMetres', '')::double precision,
        coalesce(nullif(p_payload ->> 'source', ''), 'automatic')::public.capture_source,
        -- MR-12 D2. A check-out queued offline carries its outcome with it. Without this
        -- the reason is dropped on the way through the outbox and every replayed check-out
        -- lands as `completed` -- the same class as the check-out replayed as a check-in,
        -- and invisible for the same reason: the row arrives, just saying the wrong thing.
        nullif(p_payload ->> 'notMetReason', ''));

    when 'call_report' then
      if nullif(p_payload ->> 'supersedesCallReportId', '') is not null then
        perform public.revise_call_report(
          p_entity_id,
          (p_payload ->> 'supersedesCallReportId')::uuid,
          coalesce(p_payload ->> 'summary', ''),
          coalesce((select array_agg(value::text::uuid)
                      from jsonb_array_elements_text(coalesce(p_payload -> 'productIdsDiscussed', '[]'::jsonb)) value),
                   '{}'::uuid[]),
          nullif(p_payload ->> 'objectionsRaised', ''),
          nullif(p_payload ->> 'nextStep', ''),
          coalesce(nullif(p_payload ->> 'status', ''), 'submitted')::public.call_report_status);
      else
        insert into public.call_reports (id, visit_id, mr_id, summary, product_ids_discussed,
                                         objections_raised, next_step, status, draft_source)
        values (p_entity_id,
                (p_payload ->> 'visitId')::uuid,
                v_uid,
                coalesce(p_payload ->> 'summary', ''),
                coalesce((select array_agg(value::text::uuid)
                            from jsonb_array_elements_text(coalesce(p_payload -> 'productIdsDiscussed', '[]'::jsonb)) value),
                         '{}'::uuid[]),
                nullif(p_payload ->> 'objectionsRaised', ''),
                nullif(p_payload ->> 'nextStep', ''),
                coalesce(nullif(p_payload ->> 'status', ''), 'draft')::public.call_report_status,
                coalesce(nullif(p_payload ->> 'draftSource', ''), 'manual')::public.call_report_draft_source)
        on conflict (id) do nothing;
      end if;

    when 'consent_record' then
      -- BE-W74. A CAPTURE goes through capture_consent, exactly as check_in goes through
      -- record_check_in. Before this, the offline path did a direct INSERT, so every bound
      -- FIX-02 and FIX-12 built was absent on the one path where they exist to matter --
      -- offline capture is the entire reason FIX-12 validates against captured_at rather
      -- than now(). See the migration header for the proof, both directions.
      --
      -- capture_consent derives doctor_id from the visit and displayed_language from the
      -- version that was actually active at captured_at, so the payload's own `doctorId`
      -- and `displayedLanguage` are deliberately not passed: a client cannot assert either.
      -- It is idempotent on p_id, which is what `on conflict (id) do nothing` was doing.
      if coalesce((p_payload ->> 'isWithdrawal')::boolean, false) then
        -- A WITHDRAWAL is a different act and capture_consent cannot express it: it takes
        -- no supersedes_consent_record_id and no is_withdrawal. The table's own
        -- constraints and the validate_consent_withdrawal trigger are what guard this
        -- shape, and they fire on a direct insert. Routed separately rather than forced
        -- through a function that would have to grow two parameters it has no other use
        -- for.
        insert into public.consent_records (id, visit_id, doctor_id, captured_by_mr_id,
                                            outcome, not_asked_reason,
                                            consent_text_version_id, displayed_language,
                                            supersedes_consent_record_id, is_withdrawal,
                                            captured_at)
        values (p_entity_id,
                (p_payload ->> 'visitId')::uuid,
                (p_payload ->> 'doctorId')::uuid,
                v_uid,
                (p_payload ->> 'outcome')::public.consent_outcome,
                nullif(p_payload ->> 'notAskedReason', ''),
                (p_payload ->> 'consentTextVersionId')::uuid,
                p_payload ->> 'displayedLanguage',
                nullif(p_payload ->> 'supersedesConsentRecordId', '')::uuid,
                true,
                (p_payload ->> 'capturedAt')::timestamptz)
        on conflict (id) do nothing;
      else
        perform public.capture_consent(
          p_entity_id,
          (p_payload ->> 'visitId')::uuid,
          (p_payload ->> 'outcome')::public.consent_outcome,
          p_payload ->> 'displayedLanguage',
          (p_payload ->> 'consentTextVersionId')::uuid,
          nullif(p_payload ->> 'notAskedReason', ''),
          (p_payload ->> 'capturedAt')::timestamptz);
      end if;

    when 'sample_and_input' then
      insert into public.samples_and_inputs (id, visit_id, mr_id, doctor_id, kind, item_name,
                                             quantity, declared_value_inr, occurred_at)
      values (p_entity_id,
              (p_payload ->> 'visitId')::uuid,
              v_uid,
              (p_payload ->> 'doctorId')::uuid,
              (p_payload ->> 'kind')::public.sample_or_input_kind,
              p_payload ->> 'itemName',
              (p_payload ->> 'quantity')::integer,
              coalesce((p_payload ->> 'declaredValueInr')::numeric, 0),
              (p_payload ->> 'occurredAt')::timestamptz)
      on conflict (id) do nothing;

    when 'recording', 'voice_note' then
      -- The bytes are already in storage; this is the finalisation. complete_upload
      -- re-checks consent one last time, so a withdrawal that arrived while the
      -- device was offline stops the row from ever being created.
      if nullif(p_payload ->> 'uploadGrantId', '') is null then
        raise exception 'a % item must carry its uploadGrantId', p_entity
          using errcode = '22023';
      end if;

      perform public.complete_upload(
        (p_payload ->> 'uploadGrantId')::uuid,
        p_entity_id,
        (p_payload ->> 'durationSeconds')::integer,
        (p_payload ->> 'sizeBytes')::bigint,
        coalesce((p_payload ->> 'recordedAt')::timestamptz, now()),
        nullif(p_payload ->> 'bitrateKbps', '')::integer);

    else
      raise exception 'entity % is not yet accepted by sync', p_entity
        using errcode = '0A000';
  end case;

  return v_warnings;
end;
$function$;
