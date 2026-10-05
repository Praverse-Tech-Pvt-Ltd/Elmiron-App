import { Client } from 'pg';

/**
 * W1-G C1 — exclusive access to the GLOBAL `app_thresholds` rows, for the suites that must
 * commit them.
 *
 * ## The defect this closes (`BE-W124`)
 *
 * `ai-control-plane.spec.ts` asserts that a feature with **no** `app_thresholds` row refuses
 * `45011`. `ai-gateway.spec.ts` and `sim-gateway.spec.ts` must **commit** `ai_feature_enabled:*`
 * rows, because the Edge Function runs **out of process** and cannot see a transaction. Under
 * vitest's file parallelism those overlap, and while a gateway suite holds its flag `true` the
 * absence assertion sees it and fails.
 *
 * Before this lock existed the four-file set failed **5 times out of 5**.
 *
 * ## Why serialisation, and not any of the cheaper answers
 *
 * * **Not "assert absent or off".** That is the symptom, and it deletes the claim the test exists
 *   to make — *every feature is off out of the box*. A row that says `false` and no row at all are
 *   different states, and only one of them is what a fresh organisation gets.
 * * **Not a territory-scoped flag.** `app_thresholds.scope` does support `'territory'`, but
 *   `ai_begin_request` calls `public.threshold('ai_feature_enabled:' || feature)` with **no
 *   territory**, and the resolver then matches `territory_id is null` only. Making the suites
 *   isolate by scope would mean changing production SQL to suit a test, which is backwards.
 * * **Not a database per worker.** `create database … template postgres` requires no other session
 *   on the template, and PostgREST, GoTrue and the Edge Function hold connections to it for the
 *   whole run. It is not available here.
 * * **Not `fileParallelism: false`.** That turns a 55-second suite into roughly fifteen minutes to
 *   fix a race between three files out of 73.
 *
 * **So the cause — concurrent mutation of state one suite asserts about — is removed by making
 * those three suites take turns.** The assertion is untouched.
 *
 * ## Lock ordering, so this cannot deadlock
 *
 * Every holder takes **this lock BEFORE the identity lock** in `auth.ts` (which `seedFixtures()`
 * and `makeReviewer()` take). Suites that do not touch global thresholds take only the identity
 * lock. One consistent order, no cycle.
 *
 * ## Why the release is `end()` and not `pg_advisory_unlock`
 *
 * A session-level advisory lock is released when its backend connection drops, so closing the
 * client cannot strand it — whereas an explicit unlock that throws would. The same reasoning
 * `auth.ts` gives for its own lock's `finally`.
 */

/** Distinct from `IDENTITY_LOCK_KEY` in `auth.ts`. Two locks, two keys, one order. */
const GLOBAL_THRESHOLD_LOCK_KEY = 0x7f1a6d02;

const DB_URL =
  process.env['SUPABASE_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/**
 * Blocks until this process owns the global thresholds, and returns the release.
 *
 * The caller holds it for as long as its committed rows are visible to other suites — in practice
 * from before the first `setThreshold` in `beforeAll` to after the revert in `afterAll`.
 */
export const acquireGlobalThresholds = async (): Promise<() => Promise<void>> => {
  const lock = new Client({ connectionString: DB_URL });
  await lock.connect();
  try {
    await lock.query('select pg_advisory_lock($1)', [GLOBAL_THRESHOLD_LOCK_KEY]);
  } catch (error) {
    await lock.end().catch(() => undefined);
    throw error;
  }
  return async () => {
    // Dropping the connection releases the lock. Nothing here can leave it held.
    await lock.end().catch(() => undefined);
  };
};
