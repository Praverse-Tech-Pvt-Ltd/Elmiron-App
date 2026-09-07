-- Rollback for 20260907000700_ucpmp_sample_caps.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- Returns the schema to claiming UCPMP caps are enforced server-side while nothing
-- enforces them. If a ceiling has been configured by then, this rollback stops enforcing
-- it silently -- the samples keep being accepted and nothing counts them. Correct the
-- comment in packages/core if this is ever applied, because otherwise the claim outlives
-- the mechanism again.
--
-- The app_thresholds row is NOT deleted: that table is append-only, and its rollback
-- reasoning is recorded in 20260817000200's down file. A null threshold is inert once the
-- trigger below is gone.

drop trigger if exists samples_and_inputs_ucpmp_cap on public.samples_and_inputs;
drop function if exists public.enforce_ucpmp_sample_cap();
drop function if exists public.sample_cap_status(uuid, text, timestamptz);
