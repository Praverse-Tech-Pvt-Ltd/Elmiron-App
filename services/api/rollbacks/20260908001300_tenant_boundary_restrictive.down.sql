-- Rollback for 20260908001300_tenant_boundary_restrictive.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- **This does not immediately reopen a hole; it removes the guarantee that one cannot be
-- opened.** The permissive tenant predicates MR-06 added stay in place, so today's
-- behaviour is unchanged the moment this runs.
--
-- What is lost is the property. Postgres evaluates a row as (OR of permissive) AND (AND
-- of restrictive), so once these are gone any permissive policy added later -- on
-- doctors, on user_profiles, on the clinical tables when they exist -- widens straight
-- past the tenant boundary, and G-RLS-C would still be green because it covers the
-- tables that exist today.
--
-- The proof pair in `tenant-boundary-restrictive.spec.ts` fails after this file runs,
-- which is the intended way to find out.

drop policy if exists organisations_tenant_boundary on public.organisations;
drop policy if exists doctors_tenant_boundary on public.doctors;
drop policy if exists territories_tenant_boundary on public.territories;
drop policy if exists user_profiles_tenant_boundary on public.user_profiles;
drop policy if exists consent_text_versions_tenant_boundary on public.consent_text_versions;
drop policy if exists clinic_addresses_tenant_boundary on public.clinic_addresses;
drop policy if exists territory_shift_windows_tenant_boundary on public.territory_shift_windows;
