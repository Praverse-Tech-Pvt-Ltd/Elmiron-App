-- Removes `sim_session_context`. The gateway then has no server-side source for a practice session's
-- context; roll the gateway and `packages/core` back with it.

drop function if exists public.sim_session_context(uuid);
