-- ============================================================================
-- MR-08 B - BE-W84: `visits` gets a validation trigger, before the conversion writes to it
--
-- `visits` has direct INSERT and UPDATE grants for `authenticated` and **no validation
-- trigger at all**. Its four triggers -- `visits_audit`, `visits_set_updated_at`,
-- `visits_stamp_received_at`, `visits_sync_events` -- are bookkeeping. It is the last of
-- MR-07 B4's four tables where a client writes directly past a `SECURITY DEFINER` path,
-- and MR-08 Part C converts the app's writes onto it. **The guard lands in the session
-- that makes the gap reachable**, which is the same rule as the device-clock fix and the
-- opposite of how the first eleven instances happened.
--
-- ----------------------------------------------------------------------------
-- WHAT WAS ACCEPTED, WHAT WAS REJECTED, AND ON WHAT EVIDENCE
-- ----------------------------------------------------------------------------
--
-- All five candidates below were probed against the live schema first. **Five out of five
-- incoherent visits were accepted** -- a cross-tenant doctor, another doctor's clinic
-- address, another MR's beat plan, a `started_at` a year in the future and a
-- `completed_at` a year in the future all inserted without complaint.
--
-- ACCEPTED - the doctor is visible to the acting MR.
--   `visits_insert_own` already requires exactly this over REST:
--   `doctor_id in (select d.id from doctors d where d.territory_id in
--   (select current_user_visible_territory_ids()))`. But `apply_sync_item` is
--   `SECURITY DEFINER`, so RLS does not apply to it, and its visit branch takes
--   `doctorId` straight from the payload. **The offline path was weaker than the online
--   one for a rule the product had already stated.** Expressed here through
--   `visible_territory_ids(new.mr_id)` -- the row's MR, not the session's -- so it holds
--   for `postgres` and for a fixture as well as for a client.
--
-- ACCEPTED - organisation coherence, stated separately even though the rule above now
--   implies it. MR-06 scoped `visible_territory_ids` to the caller's own organisation, so
--   a cross-tenant doctor already fails the territory check -- but it fails it with a
--   message about territories, and the cross-tenant case deserves to say so. Two rules,
--   two remedies. It is also the tenant boundary reaching a transactional table, which
--   BE-W83 deferred for the ~30 function-scoped tables pending a measurement; this one is
--   an equality on two columns already loaded.
--
-- ACCEPTED - `started_at` and `completed_at` are not in the future beyond the tolerance.
--   A visit that started tomorrow is incoherent, and `received_at` is server-stamped so
--   the comparison is available. **`scheduled_for` is deliberately NOT bounded**: a beat
--   plan schedules visits ahead, so a future `scheduled_for` is the feature.
--
-- REJECTED - a sync-lag bound like `consent_max_sync_lag_hours`. **The remedy differs, and
--   the remedy is what a bound is for.** A consent too old to accept can be taken again;
--   a visit too old to accept is work that already happened, and refusing it erases the
--   only record of the call. The right treatment for a stale sync is a manager's
--   exception, and `team_exceptions` already emits `no_recent_sync` for exactly this.
--   Bounding it here would delete data to report a problem that is already reported.
--
-- REJECTED as already true - `mr_id` server-derived. It is: the column defaults to
--   `auth.uid()` (migration 20260907000600), `visits_insert_own` requires
--   `mr_id = auth.uid()`, and `apply_sync_item` assigns `v_uid` rather than reading the
--   payload. `CreateVisitRequestSchema` has never declared the field. Adding a fourth
--   copy of a rule enforced in three places would be noise, and a trigger cannot in any
--   case know who a `postgres` caller "should" be -- what it can check is coherence,
--   which is what the rules above do.
--
-- BLOCKED - status transitions. Legal transitions cannot be defined until the `not_met`
--   question is answered: whether "2 of 3 visits done" counts a visit where the MR
--   arrived and the doctor was unavailable decides whether `visit_status` needs a fourth
--   member. Writing transition rules against a three-value enum that is about to gain a
--   fourth would encode the wrong answer in a trigger. **BE-W73, still open, still a
--   sentence to a human.**
--
-- ALSO ACCEPTED, found while probing rather than listed - two referential rules with no
--   constraint behind them:
--     * `clinic_address_id` must belong to the visit's doctor. `record_check_in` reads
--       `v_visit.clinic_address_id` to compute the geofence, so a visit pointing at
--       another doctor's clinic makes `distance_from_clinic_metres` a measurement against
--       the wrong building -- and the probe put a Delhi clinic on a Pune visit.
--     * `beat_plan_id` must belong to the same MR. `apply_sync_item` checks the plan for
--       staleness and never checks whose it is.
--
-- SQLSTATEs are reused, not minted, and **the code follows the remedy rather than the
-- layer that noticed.**
--
--   * Tenant and territory raise `42501` -> `not_permitted`. That is not a free choice:
--     `visits_insert_own` already refuses a doctor outside the MR's territory over REST
--     and `write-path.spec.ts` asserts the client sees `not_permitted` for it. A trigger
--     is a BEFORE trigger, so it fires ahead of the policy's WITH CHECK -- the first draft
--     raised `23514` here and silently changed what an MR is told about an unchanged
--     situation. "This doctor is not yours" is a permission statement whichever layer
--     says it.
--   * The clinic address and beat plan raise `23514` -> `invalid_for_this_record`. Those
--     are shape, not permission: the row refers to something that does not go with the
--     rest of it.
--   * The clock rules raise `45007`, already mapped to `consent_captured_in_future`.
--     **The hint differs where the remedy differs** -- 45007's consent hint says "do not
--     re-ask the doctor", which is meaningless for a visit, so the visit hint names the
--     visit.
--
-- Rollback: services/api/rollbacks/20260908001400_visits_validation.down.sql
-- ============================================================================

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

revoke execute on function public.validate_visit() from public;

create trigger visits_validate
  before insert or update of mr_id, doctor_id, clinic_address_id, beat_plan_id,
                             started_at, completed_at
  on public.visits
  for each row execute function public.validate_visit();
