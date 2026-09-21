import { describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { BY_SQLSTATE } from '@fieldforce/core';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { ANON_KEY, API_URL, mintAccessToken } from './auth.js';

/**
 * FIX-13 B — the error contract and the database must agree, in both directions.
 *
 * **`45004` was minted in FIX-09 and never reached `packages/core`.** A UCPMP cap refusal
 * therefore rendered to an MR as `unrecognised` — "the server refused this and the app
 * does not recognise the reason" — when the server had said something specific, with a
 * remedy, in `detail`. The defect was invisible because both halves were individually
 * correct: the migration raised a real code, the contract mapped every code it knew about,
 * and nobody owned the join between them.
 *
 * Minting a SQLSTATE and wiring it are two steps and one of them is silently skippable.
 * **Vigilance is not a control.** This is.
 *
 * ---
 *
 * **The list is derived, not maintained.** It comes from `pg_proc.prosrc` of every
 * function in `public` on the live database — the same rule this project applies to
 * `create or replace` chains, where the file is a claim and the database is the fact.
 *
 * Two things that a naive derivation gets wrong, and both were found by writing it:
 *
 *  1. **`errcode` takes condition NAMES as well as five-character codes.**
 *     `reject_mutation` — the append-only enforcement on nine tables — raises
 *     `errcode = 'restrict_violation'`, not `'23001'`. A regex for `'[0-9A-Z]{5}'` misses
 *     it and every other named condition, and would then report `23001` as a contract
 *     entry nothing raises. The names are resolved by **raising them and catching the
 *     SQLSTATE**, which is the only mapping that cannot go stale.
 *
 *  2. **Scanning the migration FILES is not the same as scanning the database.** A code
 *     raised in a superseded `create or replace` body still appears in the files and is no
 *     longer raised by anything. `pg_proc` holds what is live.
 */

const reachable = await requireDatabase();

/** Every `errcode = '…'` token in every function body in `public`, live. */
const errcodeTokens = async (client: Client): Promise<string[]> => {
  const result = await client.query<{ token: string }>(
    `select distinct m[1] as token
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       cross join lateral regexp_matches(p.prosrc, 'errcode\\s*=\\s*''([A-Za-z0-9_]+)''', 'g') m
      where n.nspname = 'public'
      order by 1`,
  );
  return result.rows.map((r) => r.token);
};

/**
 * Resolves a token to its SQLSTATE. A five-character code is itself; a condition name is
 * resolved by raising it, because Postgres publishes no catalogue of the mapping and any
 * table written here would be the hand-maintained list this test exists to avoid.
 */
const toSqlState = async (client: Client, token: string): Promise<string> => {
  if (/^[0-9A-Z]{5}$/.test(token)) return token;
  await client.query('savepoint resolve_condition');
  try {
    await client.query(`do $$ begin raise exception 'probe' using errcode = '${token}'; end $$;`);
    throw new Error(`condition name ${token} did not raise`);
  } catch (error: unknown) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
    expect(code).toMatch(/^[0-9A-Z]{5}$/);
    return code;
  } finally {
    await client.query('rollback to savepoint resolve_condition');
  }
};

const raisedSqlStates = async (client: Client): Promise<string[]> => {
  const tokens = await errcodeTokens(client);
  const states: string[] = [];
  for (const token of tokens) states.push(await toSqlState(client, token));
  return [...new Set(states)].sort();
};

describe.skipIf(!reachable)('every SQLSTATE the database raises reaches the client', () => {
  it('derives a non-trivial set, so a broken query cannot make this vacuous', async () => {
    // A positive control on the derivation itself. If the regex or the schema ever
    // changes shape, this fails loudly rather than passing over an empty set.
    await inRolledBackTransaction(async (client) => {
      const raised = await raisedSqlStates(client);
      expect(raised.length).toBeGreaterThan(10);
      // The two that prove both halves of the derivation work: a literal code and a
      // condition name resolved by raising it.
      expect(raised).toContain('45001');
      expect(raised).toContain('23001');
    });
  });

  it('B1: no code is raised by the database and missing from the contract', async () => {
    // This is the assertion that would have caught 45004 in FIX-09.
    await inRolledBackTransaction(async (client) => {
      const raised = await raisedSqlStates(client);
      const unmapped = raised.filter((state) => BY_SQLSTATE[state] === undefined);
      // If this fails: a migration raised a code and packages/core does not know it, so
      // an MR sees "the app does not recognise the reason" for a refusal the server
      // explained. Add it to BY_SQLSTATE with an honest `actionable`.
      expect(unmapped).toEqual([]);
    });
  });

  /**
   * MR-48 / `FE-W56`. **Codes the GATEWAY raises, measured, not listed.** An expired or malformed
   * sign-in never reaches a function body: PostgREST answers it with its own code before the
   * database is involved, so `pg_proc` cannot see it. Following this file's own instruction --
   * "fix the derivation, do not delete the assertion" -- the derivation asks PostgREST, once per
   * run, with an expired token and a malformed one, and counts what comes back. A static list of
   * `PGRST` codes here would be the stale kind of entry B2 exists to catch.
   */
  const gatewayRaised = async (): Promise<string[]> => {
    const expired = mintAccessToken(
      { id: '00000000-0000-4000-8000-000000000001', role: 'mr', isActive: true, territoryId: null },
      -3600,
    );
    const codes: string[] = [];
    for (const token of [expired, 'not.a.token']) {
      const response = await fetch(`${API_URL}/rest/v1/rpc/sync_pull`, {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ p_cursor: null, p_entities: ['doctor'], p_limit: 1 }),
      });
      const body = (await response.json()) as { code?: unknown };
      if (typeof body.code === 'string') codes.push(body.code);
    }
    return codes;
  };

  it('the gateway derivation measures what it claims: PGRST303 expired, PGRST301 malformed', async () => {
    // The derivation's own positive control. If PostgREST changes its codes, this fails
    // rather than B2 quietly passing on an empty measurement.
    expect(await gatewayRaised()).toEqual(['PGRST303', 'PGRST301']);
  });

  it('B2: no code is declared by the contract and raised by nothing', async () => {
    // The other direction, and it is not symmetry for its own sake. A mapping for a
    // refusal that cannot happen is decoration, and decoration makes the real entries
    // harder to trust: a reader who finds one dead row stops believing the rest.
    await inRolledBackTransaction(async (client) => {
      const raised = new Set([...(await raisedSqlStates(client)), ...(await gatewayRaised())]);
      const orphaned = Object.keys(BY_SQLSTATE).filter((state) => !raised.has(state));
      // If this fails: either the code stopped being raised and the mapping should go,
      // or it is raised somewhere this derivation cannot see -- in which case fix the
      // derivation, do not delete the assertion.
      expect(orphaned).toEqual([]);
    });
  });

  it('every mapped code declares an actionability, and it is a boolean', () => {
    // `actionable` decides whether the UI offers a next step or explains a wall. An
    // undefined here renders as "not actionable" by accident rather than by decision.
    for (const [state, entry] of Object.entries(BY_SQLSTATE)) {
      expect(typeof entry.actionable, `${state} actionable`).toBe('boolean');
      expect(entry.code.length, `${state} code`).toBeGreaterThan(0);
    }
  });
});
