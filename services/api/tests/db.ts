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

/**
 * Resolves to whether the database is reachable. Throws in CI when it is not,
 * so a green CI run always means the assertions actually ran.
 */
export const requireDatabase = async (): Promise<boolean> => {
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

/** Runs `fn` inside a transaction that is always rolled back. */
export const inRolledBackTransaction = async <T>(
  fn: (client: Client) => Promise<T>,
): Promise<T> => {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query('begin');
    return await fn(client);
  } finally {
    await client.query('rollback');
    await client.end();
  }
};
