-- Rollback for 20260908001400_visits_validation.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- **This reopens BE-W84.** After it runs, `visits` again has direct INSERT and UPDATE
-- grants for `authenticated` and no validation trigger, and all five incoherent visits
-- the migration was written against are accepted once more:
--
--   * a visit linking an MR to a doctor in ANOTHER TENANT;
--   * a visit against a doctor in a territory the MR does not cover -- a rule
--     `visits_insert_own` states over REST and `apply_sync_item` bypasses, being
--     SECURITY DEFINER;
--   * a `clinic_address_id` belonging to a different doctor, which makes
--     `distance_from_clinic_metres` a measurement against the wrong building;
--   * a `beat_plan_id` belonging to a different MR;
--   * `started_at` or `completed_at` a year in the future.
--
-- The RLS policies stay, so the REST path keeps its territory check. What is lost is
-- every path that is not RLS-bound: `apply_sync_item`, anything connecting as `postgres`
-- or `service_role`, and the fixtures.

drop trigger if exists visits_validate on public.visits;
drop function if exists public.validate_visit();
