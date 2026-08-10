import { Client } from 'pg';

/**
 * Connection helper for database tests.
 *
 * Tests skip rather than fail when there is no database reachable, so that a
 * contributor without Docker running still gets a useful `pnpm test`. CI always
 * sets SUPABASE_DB_URL, so CI never skips — see .github/workflows/ci.yml.
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
