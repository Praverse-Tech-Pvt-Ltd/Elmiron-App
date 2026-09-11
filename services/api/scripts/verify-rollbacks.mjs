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
 * Local use: `pnpm --filter @fieldforce/api verify:rollbacks && pnpm db:reset`
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
  // MR-27 A1. `--files-only` checks the PAIRING and stops -- no database, no destruction.
  //
  // **Why this mode exists.** The pairing check lived only behind the full run, which needs
  // Docker and empties the public schema, so it is the `database` CI job and it is not the
  // default locally. Twice now -- MR-24 and MR-26 -- migrations have reached `main` with no
  // rollback file, and both times the push failed on a step nothing local had run.
  //
  // MR-26 A4 made `ci:local` say loudly what it was skipping. That helped and it was not
  // enough: the warning prints at the END OF A RUN, and the moment that matters is when
  // somebody ADDS A MIGRATION. I read that warning in MR-26 Part A, added two migrations in
  // Part B, and pushed. The control was correct, ran, was seen, and still did not fire at the
  // point of the mistake.
  //
  // So the half that needs no database moves to the STATIC job, where it runs on every push
  // and -- because `ci-local.mjs` derives its steps from `ci.yml` -- in the DEFAULT local
  // command. Deliberately the same function rather than a second script: the rule about which
  // file pairs with which is stated once, which is the whole argument of this session.
  const filesOnly = process.argv.includes('--files-only');
  if (!filesOnly) assertLocalhostOnly(config.dbUrl);

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

  // A positive control on the pairing check itself, and it is not decorative: with an empty
  // or unreadable migration directory `missing` is `[]` and the check above passes while
  // having compared nothing. That is "assert the content, not the container" -- the same
  // failure the ci:local warning control had, where a non-empty list of `undefined` labels
  // satisfied a length check.
  if (migrations.length < 10) {
    throw new Error(
      'verify-rollbacks read only ' +
        migrations.length +
        ' migration(s). That is not this repository; fix the reader rather than trusting ' +
        'this run.',
    );
  }

  if (filesOnly) {
    process.stdout.write(
      'Every one of ' +
        migrations.length +
        ' migration(s) has a rollback file. NOT EXECUTED -- run ' +
        '`pnpm --filter @fieldforce/api verify:rollbacks` for that.' +
        String.fromCharCode(10),
    );
    return 0;
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

  process.stdout.write(
    'All rollbacks applied in reverse order; public schema is empty.' + String.fromCharCode(10),
  );
  return 0;
};

// CLI entry. Importing this module does not run anything.
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
) {
  try {
    // **The message belongs to whatever actually ran.** This line was
    // `console.log('All rollbacks applied in reverse order; public schema is empty.')`,
    // printed unconditionally -- so `--files-only`, which applies nothing, still announced
    // that every rollback had been applied and the schema emptied. Neither was true.
    //
    // That is MR-26 F2's rule -- a message assembled from a fixed part and a variable part is
    // not fixed by fixing the variable part -- and this is a fourth instance, written by me
    // one day after recording the rule. The caller had a hardcoded sentence about work the
    // callee decides whether to do. So the callee says what it did.
    await verifyRollbacks();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
