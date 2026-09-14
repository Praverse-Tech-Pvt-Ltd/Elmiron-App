import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from 'pg';

/**
 * `BE-W40` — a hand-run `supabase db push` cannot be prevented from here, so make it
 * impossible to HIDE.
 *
 * **The situation this exists for.** Two `supabase db push` calls were run by hand against
 * production during BE-W8, both outside CI, with nothing recording that they happened. CI
 * never deploys migrations — every job in `ci.yml` runs against `127.0.0.1:54322` — so the
 * ONLY path from a migration file to production is a person typing the command.
 *
 * **What an audit trail can and cannot be here, stated rather than implied.**
 * `supabase_migrations.schema_migrations` has three columns — `version`, `name` and
 * `statements`. There is **no timestamp and no actor**. So nothing can tell you WHO applied a
 * migration or WHEN, and no check written against that table can invent it.
 *
 * What it CAN do is compare the set of versions the database has applied against the set of
 * migration files in the repository, and fail when they differ. That catches both directions
 * of the thing that actually goes wrong:
 *
 *   - **a version in the database with no file** — something was applied from a branch, a
 *     working copy, or by hand, and is not in `main`;
 *   - **a file with no version in the database** — a migration was merged and never deployed,
 *     which is the failure that looks like nothing at all until a query hits a missing column.
 *
 * It is an **after-the-fact detector, not a preventer**, and that is the honest description.
 * A preventer would need production credentials to be unavailable to people, which is an
 * access decision and not an engineering one.
 *
 * Read-only: it runs one `select` and writes nothing. Unlike
 * `reconcile-after-restore.mjs --apply`, it therefore does NOT demand `--db-url` on the
 * command line — BE-W8's rule is about operations that destroy things. It still prints the
 * host it checked, so a run against the wrong target is visible in the log.
 *
 * Run: pnpm --filter @fieldforce/api check:migration-drift
 *      pnpm --filter @fieldforce/api check:migration-drift --db-url "<pooler url>"
 */

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'supabase',
  'migrations',
);

/**
 * A migration filename is `<version>_<name>.sql`; the version is the leading digits.
 *
 * @param {readonly string[]} filenames
 * @returns {readonly string[]} versions, sorted
 */
export const versionsFromFilenames = (filenames) =>
  filenames
    .filter((name) => name.endsWith('.sql'))
    .map((name) => /^(\d+)_/u.exec(name)?.[1])
    .filter((version) => version !== undefined)
    .sort();

/**
 * Pure, so both failure directions are testable without arranging a real divergence.
 *
 * @param {readonly string[]} fileVersions
 * @param {readonly string[]} appliedVersions
 * @returns {{ drifted: boolean, appliedWithoutFile: string[], fileNotApplied: string[] }}
 */
export const compareMigrations = (fileVersions, appliedVersions) => {
  const files = new Set(fileVersions);
  const applied = new Set(appliedVersions);
  const appliedWithoutFile = [...applied].filter((v) => !files.has(v)).sort();
  const fileNotApplied = [...files].filter((v) => !applied.has(v)).sort();
  return {
    drifted: appliedWithoutFile.length > 0 || fileNotApplied.length > 0,
    appliedWithoutFile,
    fileNotApplied,
  };
};

const argValue = (flag) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
};

const main = async () => {
  const dbUrl =
    argValue('--db-url') ??
    process.env.SUPABASE_DB_URL ??
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

  // Printed so a run against an unintended target is visible in the log rather than inferred
  // afterwards. The password is never printed.
  const host = new URL(dbUrl).hostname;
  console.log(`Checking migration drift against ${host}`);

  const fileVersions = versionsFromFilenames(readdirSync(MIGRATIONS_DIR));

  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  let appliedVersions;
  try {
    const { rows } = await client.query(
      'select version from supabase_migrations.schema_migrations order by version',
    );
    appliedVersions = rows.map((row) => String(row.version));
  } finally {
    await client.end();
  }

  const result = compareMigrations(fileVersions, appliedVersions);

  console.log(
    JSON.stringify(
      {
        host,
        migrationFiles: fileVersions.length,
        appliedVersions: appliedVersions.length,
        ...result,
      },
      null,
      2,
    ),
  );

  if (!result.drifted) {
    console.log(`\nNo drift. ${String(fileVersions.length)} migration(s), all applied.`);
    return;
  }

  if (result.appliedWithoutFile.length > 0) {
    console.error(
      `\nAPPLIED WITHOUT A FILE IN THIS REPOSITORY: ${result.appliedWithoutFile.join(', ')}` +
        '\n  Something was applied outside `main` -- a branch, a working copy, or a hand-run' +
        '\n  `supabase db push`. `schema_migrations` records no actor and no timestamp, so who' +
        '\n  and when cannot be recovered from the database. Find the file and open a PR for it.',
    );
  }
  if (result.fileNotApplied.length > 0) {
    console.error(
      `\nIN THIS REPOSITORY BUT NOT APPLIED: ${result.fileNotApplied.join(', ')}` +
        '\n  A merged migration has not reached this database. This is the quiet direction: it' +
        '\n  looks like nothing at all until a query hits a column that does not exist.',
    );
  }
  process.exitCode = 1;
};

// Importable for tests without running the check.
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/gu, '/'))
) {
  await main();
}
