import { Client } from 'pg';

/**
 * Connection helper for database tests.
 *
 * A contributor without Docker running still gets a useful `pnpm test`: the
 * database tests report as SKIPPED, not passed. That distinction is the whole
 * point — a suite that reports 18 passed against no database manufactures
 * confidence, which is worse than having no suite.
 *
 * In CI an unreachable database is a hard failure. Note that SUPABASE_DB_URL
 * being *set* proves nothing: DB_URL has a default, and reachability is a TCP
 * connection, not an env var. Only an actual connection counts.
 */

export const DB_URL =
  process.env['SUPABASE_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/**
 * Minutes past due that guarantees a COMMITTED `recordings`/`voice_notes` row is
 * claim-eligible (`purge_after` in the past) WITHOUT crossing
 * `audio_purge_is_stalled()`'s window and tripping the *global* stall check for
 * every other test running concurrently on this shared database.
 *
 * BE-W8 Part 3.2, promoted from an incident rather than a guess: a committed
 * fixture backdated by 1 day sat safely under the old 48h stall threshold and
 * silently became a cross-file hazard the moment Part 3.1 tightened it to 3h.
 * Reach for this constant whenever a COMMITTED fixture needs to be "overdue but
 * not stalled" — it will always be small next to any reasonable
 * purge_max_silence_hours value, current or future.
 *
 * NOT for a test that deliberately SIMULATES a stalled worker (those want to
 * cross the threshold on purpose) — but those run inside
 * `inRolledBackTransaction`/`asUserTx`, which never commits, so they cannot leak
 * into another file's global check regardless of how large the backdate is.
 */
export const OVERDUE_NOT_STALLED_MINUTES = 5;

export const databaseIsReachable = async (): Promise<boolean> => {
  const client = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
};

const check = async (): Promise<boolean> => {
  const reachable = await databaseIsReachable();
  if (!reachable) {
    if (process.env['CI'] !== undefined && process.env['CI'] !== '') {
      throw new Error(
        `No database reachable at ${DB_URL}. CI must never skip the database tests — ` +
          'check that the `supabase start` step actually succeeded.',
      );
    }
    console.warn(`No database at ${DB_URL} — database tests will be skipped.`);
    console.warn('Run `pnpm db:start` first if you meant to run them.');
  }
  return reachable;
};

/**
 * Memoised so the connection attempt happens once per spec file rather than once
 * per call site, and so the skip warning is not repeated within a file.
 *
 * Measured, not assumed: this does NOT dedupe across spec files. Vitest gives each
 * file its own module registry, so `pending` is fresh per file — with two files and
 * the database down, `check()` runs twice. Files run in parallel, so the cost is
 * ceil(files / workers) x 3s rather than files x 3s.
 *
 * Deduping across files needs vitest `globalSetup` with provide/inject. Deferred
 * until rls.spec.ts exists, so it is written against real call sites.
 */
let pending: Promise<boolean> | undefined;

/**
 * Resolves to whether the database is reachable. Throws in CI when it is not,
 * so a green CI run always means the assertions actually ran.
 */
export const requireDatabase = async (): Promise<boolean> => {
  pending ??= check();
  return pending;
};

/**
 * Runs `fn` on a plain connection with no transaction. Used for fixture setup,
 * which has to COMMIT: the PostgREST and GoTrue paths run over HTTP on their own
 * connections and cannot see uncommitted rows.
 */
export const withClient = async <T>(fn: (client: Client) => Promise<T>): Promise<T> => {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    try {
      await client.end();
    } catch {
      // Nothing useful to add if teardown of the connection itself fails.
    }
  }
};

/**
 * Runs `fn` inside a transaction that is always rolled back.
 *
 * Cleanup failures are swallowed on purpose. If `fn` threw because the connection
 * died, the rollback throws too, and an unguarded `finally` would replace the real
 * assertion failure with a connection error — which is a miserable thing to debug
 * in an adversarial RLS suite. The original exception always wins.
 */
export const inRolledBackTransaction = async <T>(
  fn: (client: Client) => Promise<T>,
): Promise<T> => {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query('begin');
    return await fn(client);
  } finally {
    try {
      await client.query('rollback');
    } catch {
      // Already failing, or the connection is gone. Nothing useful to add.
    }
    try {
      await client.end();
    } catch {
      // Same.
    }
  }
};
