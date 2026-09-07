-- Rollback for 20260907000900_ucpmp_cap_decision_deadline.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- Removes the deadline on the UCPMP cap decision. After this, `ucpmp_sample_cap_quantity`
-- can stay null indefinitely with nothing anywhere saying so -- which is the state
-- FIX-10 Part C existed to end. If this rollback is ever applied, the question it was
-- carrying does not go away, so move it somewhere a human will see it before running
-- this: the escalation list in PROJECT-OVERVIEW.md is where it already sits.
--
-- The app_thresholds row is NOT deleted. That table is append-only and enforced by a
-- statement-level reject_mutation trigger, so a delete would be refused with 23001 and
-- this file would fail halfway. The same reasoning is recorded in
-- 20260817000200's down file. A deadline row with no reader is inert.
--
-- Dropping the function is enough: `check:decision-debt` fails with a clear
-- "function does not exist" rather than passing silently, which is the correct
-- direction for a control to fail.

drop function if exists public.ucpmp_cap_decision_status();
