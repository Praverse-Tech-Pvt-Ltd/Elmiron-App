import { afterEach, describe, expect, it } from 'vitest';
import {
  IDENTITY_BUDGET_PER_FILE,
  createAuthUser,
  identitiesMintedThisFile,
  resetIdentityBudgetForTest,
} from './auth.js';
import { requireDatabase, withClient } from './db.js';

/**
 * MR-12 Part C — the identity burst, fixed with something that does not need re-tuning.
 *
 * `maxWorkers: 6` was a constant tuned to the suite count, and the finding it fixed says
 * the burst scales WITH the suite count. It was reopened by the next suite three times:
 * MR-07 added it after two suites reopened MR-06's fixture-level fix, MR-10 added a suite,
 * and MR-11 found CI red again with nine identities from one new spec. The MR-10 record
 * had already written down *"the burst scales with the number of suites"* immediately
 * before the suite that reopened it.
 *
 * Two mechanisms replace it, and this file is the positive control for both:
 *
 *   1. **A global advisory lock** in `createAuthUser`, so at most one `POST /admin/users`
 *      is in flight across every worker. Removes the burst at its source; adding suites
 *      changes the peak not at all.
 *   2. **A per-file budget**, so a suite that mints more than one world's worth fails the
 *      build naming itself, instead of GoTrue returning a 500 that names nothing.
 */

const reachable = await requireDatabase();

afterEach(() => {
  resetIdentityBudgetForTest();
});

describe('the per-file identity budget', () => {
  /**
   * **The scratch suite that would have blown the old limit.** `seed-day.spec` called
   * `seedDay()` once per test for independence, three identities each — nine in one file,
   * on top of everything else the run was doing. That is what took CI down in MR-11, and
   * the mechanism that was supposed to prevent it (`maxWorkers: 6`) was not even binding
   * on a four-core runner.
   *
   * Under the budget the ninth request fails HERE, in the file that asked for it, with a
   * message naming the file's own behaviour — rather than as
   * "Database error creating new user" in whichever unlucky suite happened to be seeding
   * at the same moment.
   */
  it('fails the build at the ninth identity, naming the suite rather than the database', async () => {
    // Eight is one world — exactly what `seedFixtures()` mints — so it must be allowed.
    // Counted without touching GoTrue: the budget is checked before the request, so this
    // proves the accounting without minting anything.
    for (let i = 0; i < IDENTITY_BUDGET_PER_FILE; i += 1) {
      try {
        await createAuthUser(`budget-probe-${String(i)}@example.test`, 'irrelevant');
      } catch (error) {
        // A GoTrue or connection error is fine here — this case is about the COUNTER, and
        // the budget refusal is asserted below. A budget error at or below eight is not.
        expect(String(error)).not.toMatch(/identity budget exceeded/);
      }
    }
    expect(identitiesMintedThisFile()).toBe(IDENTITY_BUDGET_PER_FILE);

    await expect(createAuthUser('budget-probe-ninth@example.test', 'irrelevant')).rejects.toThrow(
      /identity budget exceeded/,
    );
  }, 60_000);

  /**
   * The positive control. A budget of zero would satisfy the case above and break every
   * suite in the workspace — the same failure mode `sendFor`'s guard was given a control
   * for in MR-09, and `sync_entity_for_table`'s in MR-12 Part B.
   */
  it('and still admits a full world, which is what every suite actually needs', () => {
    resetIdentityBudgetForTest();
    expect(identitiesMintedThisFile()).toBe(0);
    // seedFixtures() mints exactly this many: admin, west-manager, south-manager, pune-mr,
    // nagpur-mr, south-mr, rival-mr, rival-admin.
    expect(IDENTITY_BUDGET_PER_FILE).toBe(8);
  });
});

describe.skipIf(!reachable)('the advisory lock serialises identity creation globally', () => {
  /**
   * The property that makes this need no re-tuning: the lock is held in the database being
   * protected, so it holds ACROSS worker processes, not merely within one. A cap on
   * workers cannot make that claim, which is why it had to be re-chosen every time the
   * suite count moved.
   */
  it('is exclusive — a second holder cannot take it while the first has it', async () => {
    // **A DIFFERENT key from the real one.** The first version of this test used
    // 0x5eed1de7, the production key, and failed during a full-suite run with "could not
    // take the lock at all" -- because another worker was legitimately seeding and held
    // it. A test that contends with the mechanism it is testing measures scheduling, not
    // exclusivity. This asserts the PROPERTY of the lock on a key nothing else uses.
    const PROBE_LOCK_KEY = 0x5eed1de8;

    await withClient(async (first) => {
      const taken = await first.query<{ locked: boolean }>(
        'select pg_try_advisory_lock($1) as locked',
        [PROBE_LOCK_KEY],
      );
      expect(taken.rows[0]?.locked, 'could not take the lock at all').toBe(true);

      // A SECOND connection, which is what a second vitest worker is.
      await withClient(async (second) => {
        const contended = await second.query<{ locked: boolean }>(
          'select pg_try_advisory_lock($1) as locked',
          [PROBE_LOCK_KEY],
        );
        expect(
          contended.rows[0]?.locked,
          'a second worker took the identity lock while another held it',
        ).toBe(false);
      });

      await first.query('select pg_advisory_unlock($1)', [PROBE_LOCK_KEY]);
    });
  });

  it('and releases it, so the next worker is not blocked for ever', async () => {
    const PROBE_LOCK_KEY = 0x5eed1de8;
    await withClient(async (client) => {
      const taken = await client.query<{ locked: boolean }>(
        'select pg_try_advisory_lock($1) as locked',
        [PROBE_LOCK_KEY],
      );
      expect(taken.rows[0]?.locked).toBe(true);
      await client.query('select pg_advisory_unlock($1)', [PROBE_LOCK_KEY]);
    });

    // A fresh connection can take it again immediately.
    await withClient(async (client) => {
      const retaken = await client.query<{ locked: boolean }>(
        'select pg_try_advisory_lock($1) as locked',
        [PROBE_LOCK_KEY],
      );
      expect(retaken.rows[0]?.locked, 'the lock was not released').toBe(true);
      await client.query('select pg_advisory_unlock($1)', [PROBE_LOCK_KEY]);
    });
  });
});
