-- Rollback for 20260907000300_revoke_public_execute.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- Restores Postgres's default posture: EXECUTE to PUBLIC on every function in the
-- schema, and the default privilege that grants it to whatever is created next.
--
-- This puts `anon` back within reach of every SECURITY DEFINER function's body,
-- leaving each function's own auth.uid() check as the only control -- the state
-- FIX-04 audited. Nothing leaked in that state, but nothing was holding the line
-- except code inside the functions.
--
-- The explicit `authenticated` grants the forward migration wrote are left in place.
-- They are harmless alongside the PUBLIC grant and removing them would be a second,
-- separate change.

alter default privileges in schema public grant execute on functions to public;

grant execute on all functions in schema public to public;
