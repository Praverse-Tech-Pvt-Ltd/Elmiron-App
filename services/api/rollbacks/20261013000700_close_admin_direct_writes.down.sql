-- Rollback for 20261013000700_close_admin_direct_writes.sql (`BE-W202`)
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- Gives admins their direct write path back: the `*_admin_all` policies exactly as they stood, and
-- INSERT, UPDATE and DELETE for `authenticated` on the three tables.

drop policy user_profiles_admin_select on public.user_profiles;
create policy user_profiles_admin_all on public.user_profiles
  for all to authenticated
  using (public.is_admin() and organisation_id = public.current_user_organisation_id())
  with check (public.is_admin() and organisation_id = public.current_user_organisation_id());

drop policy territories_admin_select on public.territories;
create policy territories_admin_all on public.territories
  for all to authenticated
  using (public.is_admin() and organisation_id = public.current_user_organisation_id())
  with check (public.is_admin() and organisation_id = public.current_user_organisation_id());

drop policy territory_shift_windows_admin_select on public.territory_shift_windows;
create policy territory_shift_windows_admin_all on public.territory_shift_windows
  for all to authenticated
  using (public.is_admin() and territory_id in (
    select t.id from public.territories t
     where t.organisation_id = public.current_user_organisation_id()))
  with check (public.is_admin() and territory_id in (
    select t.id from public.territories t
     where t.organisation_id = public.current_user_organisation_id()));

grant insert, update, delete on public.user_profiles to authenticated;
grant insert, update, delete on public.territories to authenticated;
grant insert, update, delete on public.territory_shift_windows to authenticated;
