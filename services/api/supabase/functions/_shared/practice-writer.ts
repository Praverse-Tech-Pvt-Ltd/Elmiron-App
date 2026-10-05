/**
 * W1-Z A (`BE-C69`) — the ONE place the gateway uses the service role, and the two things it may do.
 *
 * **Why this exists, against the gateway's founding rule.** `ai-gateway/index.ts` calls the database
 * as the rep's token so that Postgres makes every authorisation decision (`C30`). That is still true
 * for every decision. But it meant that whatever the gateway could write, the rep could write too —
 * and a rep's token could write both sides of a practice turn and their own score, labelled as any
 * model (`BE-W144`). Proof that a write came from the coach needs something the rep does not hold.
 *
 * **What this may do — exactly two writes.** `record_sim_turn` and `record_sim_coach_analysis`, which
 * the database grants to `service_role` only, and which each refuse unless they name an OPEN request
 * the rep began under their own token for the right feature on their own session. So authorisation
 * stays in Postgres and as the rep; this proves only origin. Any other function name is refused HERE,
 * before a network call, so the key cannot be reached for to "fix a 401 in a hurry".
 *
 * **Why the service-role key, not a new signing secret.** Supabase supplies `SUPABASE_SERVICE_ROLE_KEY`
 * to every Edge Function whether or not the code reads it, so reading it adds a code path, not an
 * exposure; a dedicated secret would add a value to provision in three environments.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import type { ControlPlaneRpc } from './core.ts';

export const PRACTICE_WRITES: ReadonlySet<string> = new Set([
  'record_sim_turn',
  'record_sim_coach_analysis',
]);

export const practiceWriter = (supabaseUrl: string, serviceRoleKey: string): ControlPlaneRpc => {
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    call: async (fn: string, args: Readonly<Record<string, unknown>>): Promise<unknown> => {
      if (!PRACTICE_WRITES.has(fn)) {
        throw new Error(
          `the practice writer calls only ${[...PRACTICE_WRITES].join(', ')}; refused ${fn}`,
        );
      }
      // deno-lint-ignore no-explicit-any
      const { data, error } = await client.rpc(fn, args as any);
      if (error !== null) {
        // The SQLSTATE on `code`, the same shape the rep's connection throws.
        const wrapped = new Error(error.message) as Error & { code?: string };
        wrapped.code = (error as { code?: string }).code;
        throw wrapped;
      }
      return data;
    },
  };
};
