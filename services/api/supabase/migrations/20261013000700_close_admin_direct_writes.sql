-- BE-W202 -- admins no longer write `user_profiles`, `territories` or `territory_shift_windows`
-- directly; every change goes through the console's audited RPCs (`BE-W185`, `BE-W187`).
--
-- The three `*_admin_all` policies were `FOR ALL`: they let an admin of a company read AND insert,
-- update and delete those rows straight through PostgREST, beside the RPCs that check the five
-- silent mistakes (`DEPLOY-RUNBOOK.md` step 4: a rep typed as admin, a wrong or mistyped territory,
-- no reporting manager, an unconfirmed account) and record a reason. A rule that one path enforces
-- and another skips is not a rule. Measured before this file: no application code and no
-- SECURITY INVOKER function writes these tables; every writer is SECURITY DEFINER and is unaffected.
--
-- What changes: each `*_admin_all` becomes `*_admin_select` with the SAME expression, so what an
-- admin can READ is exactly what it was; `authenticated` loses INSERT, UPDATE and DELETE on the
-- three tables (it keeps SELECT, which every other read policy needs). Owner and service-role
-- paths -- migrations, loaders, `seed:*` -- are untouched.

drop policy user_profiles_admin_all on public.user_profiles;
create policy user_profiles_admin_select on public.user_profiles
  for select to authenticated
  using (public.is_admin() and organisation_id = public.current_user_organisation_id());

drop policy territories_admin_all on public.territories;
create policy territories_admin_select on public.territories
  for select to authenticated
  using (public.is_admin() and organisation_id = public.current_user_organisation_id());

drop policy territory_shift_windows_admin_all on public.territory_shift_windows;
create policy territory_shift_windows_admin_select on public.territory_shift_windows
  for select to authenticated
  using (public.is_admin() and territory_id in (
    select t.id from public.territories t
     where t.organisation_id = public.current_user_organisation_id()));

revoke insert, update, delete on public.user_profiles from authenticated;
revoke insert, update, delete on public.territories from authenticated;
revoke insert, update, delete on public.territory_shift_windows from authenticated;
