-- ============================================================================
-- MR-07 D - the tenant boundary becomes RESTRICTIVE, so it cannot be widened
--
-- **The reviewer is right and the mechanism is exact.** Postgres evaluates a row as
--
--     (OR of every applicable PERMISSIVE policy) AND (AND of every applicable RESTRICTIVE)
--
-- so a permissive policy can only ever ADD access. The tenant predicates MR-06 added are
-- permissive, which means any future permissive policy on the same table widens past
-- them -- including one written in good faith for the clinical schema by someone who has
-- no reason to know the tenant boundary lives beside theirs, and who would see a green
-- G-RLS-C the day before their change and a green G-RLS-C the day after, because nothing
-- in that suite covers a table they just added a policy to.
--
-- A restrictive policy is AND-ed. It cannot be widened by anything added later. That is
-- exactly the shape a boundary wants and exactly the wrong shape for a feature -- which
-- is also why there is no risk of the two being confused: a restrictive policy that
-- expressed a feature would break every other policy on the table immediately.
--
-- **And it survives the failure mode MR-06 B6 actually demonstrated.** That mutation
-- showed one placement silently covering for another: nulling
-- `current_user_organisation_id()` changed nothing, because `doctors_select_in_territory`
-- reached the same rows and the two were OR-ed together. A restrictive policy cannot be
-- covered for. It is the one construction in this schema where "somebody else's policy
-- already allows it" is not a possible sentence.
--
-- ----------------------------------------------------------------------------
-- SCOPE, AND WHAT IS DELIBERATELY NOT IN IT
-- ----------------------------------------------------------------------------
--
-- **In: the seven tables that carry a tenant, or reach one in a single hop.**
-- `organisations`, `doctors`, `territories`, `user_profiles`, `consent_text_versions`
-- directly; `clinic_addresses` through its doctor and `territory_shift_windows` through
-- its territory. These are the tables whose `*_admin_all` policies were the whole of
-- BE-W76, and the predicate is an indexed equality on a column that is already there.
--
-- **Out, and registered rather than guessed: the ~30 tables scoped through
-- `visible_user_ids()`.** `visits`, `check_ins`, `consent_records`, `call_reports`,
-- `samples_and_inputs` and the rest carry no tenant column. A restrictive policy for them
-- has to reach the tenant through `mr_id -> user_profiles.organisation_id` or
-- `doctor_id -> doctors.organisation_id`, which is a correlated subquery evaluated per
-- row, on top of the `visible_user_ids()` subquery the permissive policy already runs.
--
-- Whether the planner collapses those or doubles them is a question with an answer, and
-- the answer is a measurement against the 208,800-visit synthetic seed -- not a guess
-- made at the end of a session. This repo has already been bitten once by a predicate
-- that looked free and turned out to disable an index (the LEAKPROOF finding), and the
-- honest move is to close the half that is exactly and cheaply expressible now, and put
-- a number on the other half before committing to it. **BE-W83.**
--
-- ----------------------------------------------------------------------------
-- TWO IMPLEMENTATION DETAILS THAT WOULD OTHERWISE BREAK THINGS
-- ----------------------------------------------------------------------------
--
-- **`to authenticated`, never to `public`.** A restrictive policy naming `public` would
-- also bind `supabase_auth_admin`, and `user_profiles_select_auth_admin` is how GoTrue
-- reads a profile during sign-in -- a role that has no profile of its own and therefore
-- no organisation. Scoping the restriction to `authenticated` leaves that path alone.
-- `postgres` and `service_role` hold `BYPASSRLS` and are unaffected either way.
--
-- **`current_user_organisation_id()` reads `user_profiles`, which is one of the tables
-- being restricted.** It is `SECURITY DEFINER` owned by `postgres`, which has
-- `BYPASSRLS`, so it does not re-enter the policy it is being called from. Were that ever
-- to change -- were it made `SECURITY INVOKER` for instance -- this would recurse rather
-- than deny, so the dependency is written down here rather than left to be rediscovered.
--
-- A null organisation excludes rather than admits: `organisation_id = null` is null, and
-- a restrictive policy that evaluates to null denies the row. That is the correct
-- direction for the one case it can happen in, which is a role with no profile.
--
-- Rollback: services/api/rollbacks/20260908001300_tenant_boundary_restrictive.down.sql
-- ============================================================================

-- The tenant, stated once per table, as a RESTRICTIVE policy that is AND-ed with
-- everything else the table permits now or later.

create policy organisations_tenant_boundary on public.organisations
  as restrictive for all to authenticated
  using (id = public.current_user_organisation_id())
  with check (id = public.current_user_organisation_id());

create policy doctors_tenant_boundary on public.doctors
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());

create policy territories_tenant_boundary on public.territories
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());

create policy user_profiles_tenant_boundary on public.user_profiles
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());

create policy consent_text_versions_tenant_boundary on public.consent_text_versions
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());

-- One hop: a clinic address is a doctor's, and a doctor belongs to a tenant.
create policy clinic_addresses_tenant_boundary on public.clinic_addresses
  as restrictive for all to authenticated
  using (
    doctor_id in (
      select d.id from public.doctors d
       where d.organisation_id = public.current_user_organisation_id())
  )
  with check (
    doctor_id in (
      select d.id from public.doctors d
       where d.organisation_id = public.current_user_organisation_id())
  );

-- One hop: a shift window is a territory's, and a territory belongs to a tenant.
create policy territory_shift_windows_tenant_boundary on public.territory_shift_windows
  as restrictive for all to authenticated
  using (
    territory_id in (
      select t.id from public.territories t
       where t.organisation_id = public.current_user_organisation_id())
  )
  with check (
    territory_id in (
      select t.id from public.territories t
       where t.organisation_id = public.current_user_organisation_id())
  );
