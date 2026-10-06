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
 * before a network call.
 *
 * **W2-A A: the key is READ here, and nowhere else (`BE-C70`).** `C30`'s real guarantee was that the
 * key had no reference anywhere in the function, so nobody fixing a 401 in a hurry could reach for it.
 * `BE-C69` spent that property. What replaces it: this module is the only code that reads the key; it
 * exports ONE function, which returns a writer for the two names above and nothing else — never the key,
 * never the client. `services/api/scripts/check-service-role-reads.mjs` fails the build if a second
 * read appears anywhere under `supabase/functions`, if anything reads the whole environment or a
 * variable whose name is not spelled out, if this module exports anything else, or if the list below
 * changes.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import type { ControlPlaneRpc } from './core.ts';

const PRACTICE_WRITES: ReadonlySet<string> = new Set([
  'record_sim_turn',
  'record_sim_coach_analysis',
]);

/**
 * W2-C D2 / `BE-W162` — the key is a NAMED secret key, not the legacy service-role key.
 *
 * Supabase retires the legacy `service_role` key at the end of 2026 (`BE-C72`). The platform hands
 * every function its new secret keys as one JSON object, `SUPABASE_SECRET_KEYS`, keyed by name. This
 * writer uses the key named `practice_writer` when the project has one — create it in Settings → API
 * Keys so this writer can be rotated without touching anything else — and the project's `default`
 * key until then. The legacy variable is no longer read anywhere; the check now forbids it.
 */
const PRACTICE_WRITER_KEY_NAME = 'practice_writer';

const secretKey = (): string | null => {
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (raw === undefined || raw.length === 0) return null;
  try {
    const keys = JSON.parse(raw) as Record<string, unknown>;
    const chosen = keys[PRACTICE_WRITER_KEY_NAME] ?? keys['default'];
    return typeof chosen === 'string' && chosen.length > 0 ? chosen : null;
  } catch {
    return null;
  }
};

/** The gateway's practice writer, or null when the key is not configured. The key never leaves here. */
export const practiceWriterFromEnv = (supabaseUrl: string): ControlPlaneRpc | null => {
  const key = secretKey();
  if (key === null) return null;
  const client = createClient(supabaseUrl, key, {
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
