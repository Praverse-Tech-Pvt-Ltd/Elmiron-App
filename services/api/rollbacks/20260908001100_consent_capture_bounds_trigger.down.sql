-- Rollback for 20260908001100_consent_capture_bounds_trigger.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- **This reopens BE-W78, which was the highest-severity open item when it was closed.**
--
-- After this runs, `authenticated` can once again INSERT into `public.consent_records`
-- directly, and nothing checks the timestamps or the notice on that path. FIX-02's
-- integrity rules, FIX-12's three offline bounds and BE-W74's sync routing all become
-- optional again, because they live in `capture_consent` and nothing compels a client to
-- call it. An ordinary MR can write a consent dated a year in the future.
--
-- The two halves are removed in the reverse order they were added, and BOTH matter: the
-- trigger is what held the rule regardless of door, and the grant plus policy are what
-- opened the door in the first place.

drop trigger if exists consent_records_validate_capture on public.consent_records;
drop function if exists public.validate_consent_capture();

grant insert on public.consent_records to authenticated;

create policy consent_records_insert_own on public.consent_records
  for insert to authenticated
  with check (
    captured_by_mr_id = (select auth.uid())
    and visit_id in (select v.id from public.visits v where v.mr_id = (select auth.uid()))
  );
