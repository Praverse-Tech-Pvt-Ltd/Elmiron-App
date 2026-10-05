-- Rollback for W1-D -- the simulation RPCs are dropped; the tables and their data stay.
--
-- **What rolling back MEANS.** AI Doctor stops being reachable: no session can be started, no turn
-- recorded, no analysis stored, and no persona or scenario can be submitted or approved. **Existing
-- rows are untouched** -- sessions, turns and analyses remain readable under their RLS policies, so
-- a rep does not lose their practice history.
--
-- **The client must be rolled back with this.** The Edge Function dispatches `ai_doctor` and
-- `ai_coach` to these RPCs; without them every turn returns a PostgREST "function does not exist"
-- error, which the gateway will surface as a failure rather than as a clean refusal. Roll back
-- `packages/core` and `supabase/functions/` too, or the feature fails in a way no message explains.

drop function if exists public.record_sim_coach_analysis(uuid, integer, jsonb, jsonb, jsonb, text, text, text);
drop function if exists public.end_sim_session(uuid);
drop function if exists public.record_sim_turn(uuid, text, text, uuid, uuid[]);
drop function if exists public.start_sim_session(uuid);
drop function if exists public.reject_sim_content(text, uuid, text);
drop function if exists public.approve_sim_content(text, uuid, text);
drop function if exists public.submit_sim_content(text, uuid);
