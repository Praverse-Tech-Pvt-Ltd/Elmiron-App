-- Rollback for 20260810000100_roles_territories_profiles.sql
--
-- The Supabase CLI has no built-in down-migration step. Apply this by hand:
--   psql "$SUPABASE_DB_URL" -f <this file>
-- Every migration in this repo ships with a matching file here.

drop policy if exists territories_select_visible        on public.territories;
drop policy if exists user_profiles_select_auth_admin   on public.user_profiles;
drop policy if exists user_profiles_select_self         on public.user_profiles;

drop function if exists public.current_user_visible_territory_ids();
drop function if exists public.visible_territory_ids(uuid);
drop function if exists public.current_app_role();
drop function if exists public.custom_access_token_hook(jsonb);

drop trigger if exists user_profiles_set_updated_at on public.user_profiles;
drop trigger if exists territories_set_updated_at   on public.territories;

drop table if exists public.user_profiles;
drop table if exists public.territories;

drop function if exists public.set_updated_at();

drop type if exists public.app_role;
