-- Rollback for 20260907000200_analysis_overrides.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- Restoring this removes the only persistent record of a human overriding a machine
-- finding. §3.6 -- the line against showing a manager an AI analysis of a named
-- employee -- was reversed on the strength of that record existing. Rolling this back
-- returns the product to a state where the console's oversight trail is fabricated by
-- services/mock, which is what FIX-03 found. That is what a rollback of this migration
-- means, and it is stated here rather than discovered later.
--
-- Rows are lost. analysis_overrides is append-only by trigger and cannot be exported
-- by editing it; dump the table first if any override has been recorded that matters.

drop function if exists public.list_analysis_overrides(uuid, text);
drop function if exists public.create_analysis_override(uuid, uuid, text);

-- The triggers and the index are owned by the table and go with it.
drop table if exists public.analysis_overrides;
