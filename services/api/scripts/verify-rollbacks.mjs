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

const DB_URL =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const ROLLBACK_DIR = new URL('../rollbacks/', import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  '$1',
);
const MIGRATION_DIR = new URL('../supabase/migrations/', import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  '$1',
);

const migrations = (await readdir(MIGRATION_DIR))
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .reverse();

const rollbacks = await readdir(ROLLBACK_DIR);

const missing = migrations.filter(
  (name) => !rollbacks.includes(name.replace(/\.sql$/, '.down.sql')),
);
if (missing.length > 0) {
  console.error(`Migrations with no rollback file:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

const client = new Client({ connectionString: DB_URL });
await client.connect();

try {
  for (const migration of migrations) {
    const file = migration.replace(/\.sql$/, '.down.sql');
    const sql = await readFile(join(ROLLBACK_DIR, file), 'utf8');
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
    console.error(
      'Rollbacks ran but left objects behind in public:\n' +
        leftovers.rows.map((row) => `  ${row.relkind} ${row.relname}`).join('\n'),
    );
    process.exit(1);
  }

  console.log('All rollbacks applied in reverse order; public schema is empty.');
} finally {
  await client.end();
}
