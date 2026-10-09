-- Rollback for `BE-W171` / `BE-C78` (20261009000200_manager_planning). The rep writes their own
-- beat plans over REST again, nobody plans for anyone, and a plan-less visit is once more
-- indistinguishable from a malformed one. `validate_visit`, `apply_sync_item` and `day_zone_for`
-- are restored from 20260908001400, 20261006000200 and 20260921000200, unchanged since.
--
-- DATA: plan versions, planned visits, grants, reassignments and reviews written under this
-- migration are NOT deleted by the beat-plan and visit part: the rows stay, and lose only the
-- columns below. The four tables of their own are dropped with their rows.

drop trigger if exists visits_origin_is_fixed on public.visits;
drop function if exists public.visit_origin_is_fixed();
drop trigger if exists beat_plans_audit on public.beat_plans;
drop trigger if exists beat_plan_entries_audit on public.beat_plan_entries;

drop function if exists public.review_unplanned_visit(uuid, text);
drop function if exists public.manager_day_review(uuid, date, date);
drop function if exists public.plannable_reps(date);
drop function if exists public.plannable_doctors(uuid, date);
drop function if exists public.revoke_planning_access(uuid, text);
drop function if exists public.grant_planning_access(uuid, uuid, date, date, text);
drop function if exists public.reassign_planned_visits(uuid[], uuid, text, uuid);
drop function if exists public.plan_mr_day(uuid, date, jsonb, uuid);
drop function if exists public.rep_today(uuid);
drop function if exists public.write_plan_version(public.user_profiles, public.user_profiles, date, jsonb, uuid);
drop function if exists public.plannable_rep(public.user_profiles, uuid, date);
drop function if exists public.planning_manager();
drop function if exists public.plannable_territory_ids(uuid, date);

drop table if exists public.unplanned_visit_reviews;
drop table if exists public.plan_reassignments;
drop table if exists public.planning_territory_grant_revocations;
drop table if exists public.planning_territory_grants;

-- The view holds the two columns, so it goes first and comes back with 20260813000100's shape.
drop view if exists public.beat_plan_current;
alter table public.beat_plans drop constraint if exists beat_plans_request_id_unique;
alter table public.beat_plans drop column if exists request_id, drop column if exists planned_by_user_id;
create view public.beat_plan_current
with (security_invoker = true) as
  select bp.*
    from public.beat_plans bp
   where not exists (
     select 1 from public.beat_plans newer where newer.supersedes_beat_plan_id = bp.id
   );
revoke all on public.beat_plan_current from anon, authenticated;
grant select on public.beat_plan_current to authenticated;

drop index if exists public.visits_one_live_planned_per_mr_doctor_day;
alter table public.visits
  drop constraint if exists visits_planned_has_plan_and_date,
  drop constraint if exists visits_unplanned_has_no_plan_and_a_reason,
  drop constraint if exists visits_reason_only_on_unplanned,
  drop constraint if exists visits_planned_date_only_on_planned;
alter table public.visits
  drop column if exists origin, drop column if exists planned_date, drop column if exists unplanned_reason;
drop type if exists public.visit_origin;

-- The rep's own plan-writing policies, as 20260811000400 created them.
create policy beat_plans_insert_own
  on public.beat_plans for insert to authenticated
  with check (mr_id = (select auth.uid()));

create policy beat_plans_update_own
  on public.beat_plans for update to authenticated
  using (mr_id = (select auth.uid()))
  with check (mr_id = (select auth.uid()));

create policy beat_plan_entries_write_own_plan
  on public.beat_plan_entries for all to authenticated
  using (
    beat_plan_id in (select b.id from public.beat_plans b where b.mr_id = (select auth.uid()))
  )
  with check (
    beat_plan_id in (select b.id from public.beat_plans b where b.mr_id = (select auth.uid()))
  );

grant insert, update on table public.beat_plans to authenticated;
grant insert, update, delete on table public.beat_plan_entries to authenticated;

-- day_zone_for, as 20260921000200 defined it.
create or replace function public.day_zone_for(p_mr_id uuid)
returns table (time_zone text, source text)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_territory uuid;
  v_zone      text;
begin
  if (select auth.uid()) is not null
     and p_mr_id not in (select public.visible_user_ids()) then
    raise exception 'not permitted to read the day zone of that user'
      using errcode = '42501';
  end if;

  select p.territory_id into v_territory
    from public.user_profiles p
   where p.id = p_mr_id and p.is_active;

  if v_territory is not null then
    select w.timezone into v_zone from public.resolve_shift_window(v_territory) w;
  end if;

  if v_zone is null then
    return query select 'UTC'::text, 'fallback_utc'::text;
  else
    return query select v_zone, 'territory'::text;
  end if;
end;
$$;
drop function if exists public.day_zone_unchecked(uuid);

-- validate_visit, as 20260908001400 defined it.
create or replace function public.validate_visit()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_doctor    public.doctors%rowtype;
  v_mr_org    uuid;
  v_tolerance numeric;
  v_clinic_doctor uuid;
  v_plan_mr   uuid;
begin
  select * into v_doctor from public.doctors d where d.id = new.doctor_id;
  if not found then
    -- The FK raises this too; reaching it here would mean the row vanished mid-statement.
    raise exception 'doctor % does not exist', new.doctor_id using errcode = '23503';
  end if;

  select p.organisation_id into v_mr_org
    from public.user_profiles p where p.id = new.mr_id;

  -- ---- 1. the same tenant ----
  if v_mr_org is distinct from v_doctor.organisation_id then
    raise exception
      'visit links MR % in organisation % to doctor % in organisation %',
      new.mr_id, v_mr_org, new.doctor_id, v_doctor.organisation_id
      using errcode = '42501',
            hint = 'A visit cannot cross a tenant boundary. The doctor belongs to another '
                   'organisation.';
  end if;

  -- ---- 2. the doctor is in a territory this MR can see ----
  --
  -- The same rule `visits_insert_own` states over REST, applied on every path. Resolved
  -- from `new.mr_id` rather than `auth.uid()` so it holds for a definer function, a
  -- fixture, or anything connecting as the owner.
  if not exists (
    select 1 from public.visible_territory_ids(new.mr_id) t
     where t = v_doctor.territory_id
  ) then
    raise exception
      'doctor % is in territory %, which is not visible to MR %',
      new.doctor_id, v_doctor.territory_id, new.mr_id
      using errcode = '42501',
            hint = 'A visit can only be booked against a doctor in a territory the MR '
                   'covers.';
  end if;

  -- ---- 3. the clinic address belongs to that doctor ----
  if new.clinic_address_id is not null then
    select a.doctor_id into v_clinic_doctor
      from public.clinic_addresses a where a.id = new.clinic_address_id;

    if v_clinic_doctor is distinct from new.doctor_id then
      raise exception
        'clinic address % belongs to doctor %, not to doctor %',
        new.clinic_address_id, v_clinic_doctor, new.doctor_id
        using errcode = '23514',
              hint = 'The geofence is measured from this address, so it has to be the '
                     'address of the doctor being visited.';
    end if;
  end if;

  -- ---- 4. the beat plan belongs to this MR ----
  if new.beat_plan_id is not null then
    select b.mr_id into v_plan_mr
      from public.beat_plans b where b.id = new.beat_plan_id;

    if v_plan_mr is distinct from new.mr_id then
      raise exception
        'beat plan % belongs to MR %, not to MR %',
        new.beat_plan_id, v_plan_mr, new.mr_id
        using errcode = '23514',
              hint = 'A visit can only be attached to its own MR''s beat plan.';
    end if;
  end if;

  -- ---- 5. the clock ----
  --
  -- `consent_future_tolerance_seconds` is reused deliberately: the question it answers is
  -- how far ahead a DEVICE clock may be, which is a property of the handset and not of
  -- consent. **Its name is now wrong**, and renaming a row in an append-only table is a
  -- migration of its own -- registered rather than done here. Minting a second number for
  -- the same physical question would guarantee the two drift.
  v_tolerance := coalesce(
    public.threshold_number('consent_future_tolerance_seconds', null, null), 0);

  if new.started_at is not null
     and new.started_at > now() + make_interval(secs => v_tolerance) then
    raise exception 'a visit cannot have started in the future'
      using errcode = '45007',
            detail = format('started_at %s is more than %s seconds after the server clock %s',
                            new.started_at, v_tolerance::integer, now()),
            hint   = 'The device clock is ahead of the server. Correct it and sync again; '
                     'the visit itself is unaffected.';
  end if;

  if new.completed_at is not null
     and new.completed_at > now() + make_interval(secs => v_tolerance) then
    raise exception 'a visit cannot have been completed in the future'
      using errcode = '45007',
            detail = format('completed_at %s is more than %s seconds after the server clock %s',
                            new.completed_at, v_tolerance::integer, now()),
            hint   = 'The device clock is ahead of the server. Correct it and sync again; '
                     'the visit itself is unaffected.';
  end if;

  -- `scheduled_for` is not bounded. A beat plan schedules visits ahead of time, so a
  -- future value there is the feature rather than a defect.

  return new;
end
$$;

-- apply_sync_item, as 20261006000200 defined it.
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
  v_row_id    uuid;
  v_check_in  public.check_ins;
begin
  v_uid := (select auth.uid());

  -- MR-24. The row's identity is the REQUEST's own id, carried in the payload.
  -- `p_entity_id` is the client's GROUPING key (the visit), not an identity.
  v_row_id := nullif(p_payload ->> 'id', '')::uuid;
  if v_row_id is null and p_entity not in ('visit', 'recording', 'voice_note') then
    -- Refused rather than defaulted. Falling back to `p_entity_id` here is precisely the
    -- defect this migration removes, and a silent fallback would reinstate it for any body
    -- that lost its id on the way.
    raise exception 'a % item carries no id of its own', p_entity using errcode = '22023';
  end if;

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
      v_check_in := public.record_check_in(
        v_row_id,
        (p_payload ->> 'visitId')::uuid,
        (p_payload -> 'coordinates' ->> 'latitude')::double precision,
        (p_payload -> 'coordinates' ->> 'longitude')::double precision,
        (p_payload ->> 'occurredAt')::timestamptz,
        nullif(p_payload -> 'coordinates' ->> 'accuracyMetres', '')::double precision,
        coalesce(nullif(p_payload ->> 'source', ''), 'automatic')::public.capture_source);

      -- W2-B A / `BE-W147`. `BE-C5`: the rep is TOLD when the clinic could not be confirmed.
      -- Two facts, each the server's, carried on the existing warnings channel -- never a refusal.
      -- `BE-C2`: the approximate flag is not a second verdict, so it is its own warning.
      if v_check_in.geofence_status = 'outside' then
        v_warnings := array_append(v_warnings, 'check_in_outside_geofence');
      end if;
      if v_check_in.location_is_approximate is true then
        v_warnings := array_append(v_warnings, 'check_in_location_approximate');
      end if;

    when 'check_out' then
      perform public.record_check_out(
        v_row_id,
        (p_payload ->> 'visitId')::uuid,
        (p_payload -> 'coordinates' ->> 'latitude')::double precision,
        (p_payload -> 'coordinates' ->> 'longitude')::double precision,
        (p_payload ->> 'occurredAt')::timestamptz,
        nullif(p_payload -> 'coordinates' ->> 'accuracyMetres', '')::double precision,
        coalesce(nullif(p_payload ->> 'source', ''), 'automatic')::public.capture_source,
        -- MR-12 D2. A check-out queued offline carries its outcome with it. Without this
        -- the reason is dropped on the way through the outbox and every replayed check-out
        -- lands as `completed` -- the same class as the check-out replayed as a check-in,
        -- and invisible for the same reason: the row arrives, just saying the wrong thing.
        nullif(p_payload ->> 'notMetReason', ''));

    when 'call_report' then
      if nullif(p_payload ->> 'supersedesCallReportId', '') is not null then
        perform public.revise_call_report(
          v_row_id,
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
        values (v_row_id,
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
        values (v_row_id,
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
          v_row_id,
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
      values (v_row_id,
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

    when 'adverse_event' then
      -- W2-C B / `BE-W159`, `BE-C36`. The rep FLAGS a possible adverse event; nothing more. Through
      -- `report_adverse_event`, which already exists and already enforces everything the flag
      -- needs: the visit must be the caller's (42501), there must be words (22023), and the id is
      -- the idempotency key, so a replay is the same report and the same statutory clock.
      perform public.report_adverse_event(
        v_row_id,
        (p_payload ->> 'visitId')::uuid,
        p_payload ->> 'reportedText',
        nullif(p_payload ->> 'clientReportedAt', '')::timestamptz);

    else
      raise exception 'entity % is not yet accepted by sync', p_entity
        using errcode = '0A000';
  end case;

  return v_warnings;
end;
$function$;
