-- Rollback for W1-D -- the simulation tables are DROPPED, and their data with them.
--
-- **What rolling back MEANS, and it is destructive.** Every practice session, every turn and every
-- coach analysis is deleted. A rep's practice history is not recoverable from anywhere else -- there
-- is no other copy, because `ai_requests` deliberately holds counts and flags and NOT the turn text
-- (§52). Take a dump first if any real practice has happened.
--
-- **Run `20260929000200_simulation_rpcs.down.sql` FIRST.** The functions reference these tables and
-- their argument types; dropping the tables underneath them leaves functions that cannot be called
-- and cannot be dropped by signature without the types.
--
-- **Nothing outside the simulation feature is affected.** These tables are referenced by nothing
-- else -- asserted by `sim-gateway.spec.ts`, which reads `information_schema` to prove the
-- simulation schema touches no doctor, visit, consent or recording.

drop trigger if exists sim_coach_analyses_audit on public.sim_coach_analyses;
drop trigger if exists sim_sessions_audit on public.sim_sessions;
drop trigger if exists sim_scenarios_audit on public.sim_scenarios;
drop trigger if exists sim_personas_audit on public.sim_personas;
drop trigger if exists sim_coach_analyses_reject_mutation on public.sim_coach_analyses;
drop trigger if exists sim_turns_reject_mutation on public.sim_turns;
drop trigger if exists sim_scenarios_before_update on public.sim_scenarios;
drop trigger if exists sim_personas_before_update on public.sim_personas;
drop trigger if exists sim_scenarios_before_insert on public.sim_scenarios;
drop trigger if exists sim_personas_before_insert on public.sim_personas;

drop function if exists public.sim_content_before_update();
drop function if exists public.sim_content_before_insert();

drop table if exists public.sim_coach_analyses;
drop table if exists public.sim_turns;
drop table if exists public.sim_sessions;
drop table if exists public.sim_scenarios;
drop table if exists public.sim_personas;

drop type if exists public.sim_turn_role;
drop type if exists public.sim_session_state;
drop type if exists public.sim_persona_stance;
