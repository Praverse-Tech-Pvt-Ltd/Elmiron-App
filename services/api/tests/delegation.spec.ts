import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * MR-43 C — the functions that are safe ONLY because they delegate.
 *
 * `approve_call_reports_bulk` has no scoping of its own. It was never open, because it calls
 * `approve_call_report` per id — but **nothing would have failed if somebody inlined that loop,
 * added a fast path, or changed what the delegate returns.** A property that is real and
 * unprotected is exactly how `BE-W101` got in: eight bodies drifted away from
 * `visible_user_ids()` and no test noticed, because no test asserted the boundary at those
 * sites.
 *
 * ### The population, enumerated from the catalogue — and the first enumeration was wrong
 *
 * MR-42 found this class with a string match and reported ONE member. The catalogue query that
 * replaced it reported one too — and was still wrong, because it defined delegation as *"calls
 * something that uses `visible_user_ids`"*. That misses delegation to a **self-scoped** function,
 * which is a different way of being scoped and just as load-bearing.
 *
 * Widening the definition to *"has no scoping of its own and calls something that has either
 * kind"* gives **four**:
 *
 * | Function | Delegates to | Boundary it inherits |
 * | --- | --- | --- |
 * | `approve_call_reports_bulk` | `approve_call_report` | the tenant boundary, on a WRITE |
 * | `issue_recording_upload_grant` | `begin_upload` | the caller's own visits |
 * | `active_consent_text` | `current_user_organisation_id` | the caller's own tenant |
 * | `is_admin` | `effective_role` | none — see below |
 *
 * **`is_admin` is deliberately not tested here and that is not an oversight.** It takes no
 * target and returns a boolean about the caller. There is no row to reach and no boundary to
 * cross, so there is no property of the shape "A must not see B's thing" to assert. Its
 * correctness is the role predicate itself, which `rls.spec.ts` covers.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
});

const asUserTx = async <T>(user: FixtureUser, fn: (client: Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await asUser(client, user);
    return fn(client);
  });

describe.skipIf(!reachable)(
  'MR-43 C1 — approve_call_reports_bulk inherits the tenant boundary',
  () => {
    /**
     * The bulk path reports per id rather than raising, so the assertion is on the COUNTS it
     * returns. A refusal that arrives as `decidedCount: 1` would be the defect wearing the shape
     * of a success.
     */
    const bulk = async (
      client: Client,
      id: string,
    ): Promise<{ decided: number; failed: number }> => {
      const { rows } = await client.query<{
        page: { decidedCount: number; notDecidedCount: number };
      }>('select public.approve_call_reports_bulk($1::uuid[], true, $2) as page', [
        [id],
        'MR-43 C1 delegation probe',
      ]);
      return {
        decided: rows[0]?.page.decidedCount ?? -1,
        failed: rows[0]?.page.notDecidedCount ?? -1,
      };
    };

    it('does NOT decide another organisation’s call report, for an admin of the other tenant', async () => {
      // This is the test that fails the moment the loop stops delegating. Inline the body without
      // the scope check, add a fast path, or widen what the delegate accepts, and this goes red.
      const result = await asUserTx(world.users.rivalAdmin, (client) =>
        bulk(client, world.callReports.pune),
      );

      expect(result.decided).toBe(0);
      expect(result.failed).toBe(1);
    });

    it('DOES decide it for that organisation’s own admin — the positive control', async () => {
      // Without this, a bulk function that decided nothing at all would satisfy the assertion
      // above. It is also the C1 half of the boundary: a tenant admin did not lose the capability.
      const result = await asUserTx(world.users.admin, (client) =>
        bulk(client, world.callReports.pune),
      );

      expect(result.decided).toBe(1);
      expect(result.failed).toBe(0);
    });
  },
);

describe.skipIf(!reachable)('MR-43 C3 — active_consent_text inherits the caller’s tenant', () => {
  const activeId = async (client: Client): Promise<string | null> => {
    const { rows } = await client.query<{ id: string | null }>(
      "select (public.active_consent_text('en-IN')).id as id",
    );
    return rows[0]?.id ?? null;
  };

  it('gives an MR of organisation A the notice belonging to organisation A', async () => {
    // The positive control comes first here, because the absence below means nothing unless
    // the function is known to return something to somebody.
    const id = await asUserTx(world.users.puneMr, activeId);

    expect(id).toBe(world.consentTextVersionId);
  });

  it('does NOT give the rival tenant organisation A’s notice', async () => {
    // `active_consent_text` passes `current_user_organisation_id()` down to
    // `active_consent_text_at`. If that argument were ever dropped, or defaulted, this is what
    // catches it — and a doctor would otherwise be shown another company's consent notice,
    // which is a compliance record about who is processing their data.
    const id = await asUserTx(world.users.rivalMr, activeId);

    expect(id).not.toBe(world.consentTextVersionId);
  });
});
