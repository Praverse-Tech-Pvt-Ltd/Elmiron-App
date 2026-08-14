import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';

/**
 * Applies every rollback in reverse migration order and asserts the public schema
 * comes back empty.
 *
 * BE-W1 shipped rollback SQL that nothing ever executed — a file that has never
 * run is a claim, not a rollback. This is destructive by design, so it runs LAST
 * in CI's database job, after the test suites.
 *
 * Local use: `pnpm --filter @elmiron/api verify:rollbacks && pnpm db:reset`
 */

const DEFAULTS = {
  dbUrl: process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
};

const LOCALHOST_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * Pure, so the refusal is testable without a real remote database.
 *
 * This drops the entire public schema. `handover.md` documented the remote-URL
 * hazard three times and every mitigation was a rule for a human to follow —
 * "never export the remote URL in a shell where this runs." A guard that is not
 * enforced in code is not a guard, so this refuses before a connection is even
 * opened. No `--force`, no environment escape hatch.
 *
 * @param {string} dbUrl
 * @throws {Error} if the URL's host is not localhost
 */
export const assertLocalhostOnly = (dbUrl) => {
  let host;
  try {
    // Node's URL.hostname keeps the brackets on an IPv6 literal (e.g. "[::1]").
    host = new URL(dbUrl).hostname.replace(/^\[|\]$/g, '');
  } catch {
    throw new Error(`verify:rollbacks refuses to run: could not parse database URL "${dbUrl}".`);
  }

  if (!LOCALHOST_HOSTS.has(host)) {
    throw new Error(
      `verify:rollbacks refuses to run against host "${host}". ` +
        'This applies every rollback and asserts the public schema is empty afterward — ' +
        'it is destructive by design and only ever allowed against 127.0.0.1, ::1 or localhost. ' +
        'If you genuinely need to reverse migrations on a remote database, write that command by hand and own it.',
    );
  }
};

export const verifyRollbacks = async (overrides = {}) => {
  const config = { ...DEFAULTS, ...overrides };
  assertLocalhostOnly(config.dbUrl);

  const rollbackDir = new URL('../rollbacks/', import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    '$1',
  );
  const migrationDir = new URL('../supabase/migrations/', import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    '$1',
  );

  const migrations = (await readdir(migrationDir))
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .reverse();

  const rollbacks = await readdir(rollbackDir);

  const missing = migrations.filter(
    (name) => !rollbacks.includes(name.replace(/\.sql$/, '.down.sql')),
  );
  if (missing.length > 0) {
    throw new Error(`Migrations with no rollback file:\n  ${missing.join('\n  ')}`);
  }

  const client = new Client({ connectionString: config.dbUrl });
  await client.connect();

  try {
    for (const migration of migrations) {
      const file = migration.replace(/\.sql$/, '.down.sql');
      const sql = await readFile(join(rollbackDir, file), 'utf8');
      process.stdout.write(`applying ${file} ... `);
      await client.query(sql);
      process.stdout.write('ok\n');
    }

    const leftovers = await client.query(
      `select c.relname, c.relkind
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'v')`,
    );

    if (leftovers.rows.length > 0) {
      throw new Error(
        'Rollbacks ran but left objects behind in public:\n' +
          leftovers.rows.map((row) => `  ${row.relkind} ${row.relname}`).join('\n'),
      );
    }
  } finally {
    await client.end();
  }
};

// CLI entry. Importing this module does not run anything.
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
) {
  try {
    await verifyRollbacks();
    console.log('All rollbacks applied in reverse order; public schema is empty.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
