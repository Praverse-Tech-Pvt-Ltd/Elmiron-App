-- Rollback for 20260908000800_user_profiles_organisation.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- **This reopens BE-W76.** Removing `user_profiles.organisation_id` removes the only
-- data path from a user to a tenant, so every organisation predicate added by
-- 20260908000900 loses the value it compares against. Apply that rollback FIRST -- it
-- depends on `current_user_organisation_id()`, which this file drops.
--
-- After this runs, an administrator of one pharmaceutical company can read another
-- company's doctors, visits, consent records and MR performance again, through
-- PostgREST, raw SQL, a join, a SECURITY DEFINER function and a view. That is not a
-- side effect of the rollback; it is what the schema did before the migration.

drop trigger if exists user_profiles_derive_organisation on public.user_profiles;
drop function if exists public.user_profiles_derive_organisation();
drop function if exists public.current_user_organisation_id();

drop index if exists public.user_profiles_organisation_id_idx;

alter table public.user_profiles
  drop constraint if exists user_profiles_organisation_id_fkey;

alter table public.user_profiles drop column if exists organisation_id;
