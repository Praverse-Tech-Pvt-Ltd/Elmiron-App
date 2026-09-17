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

/**
 * MR-35 C1. The check's own preconditions, asserted rather than assumed.
 *
 * **Why this exists.** MR-34 ran `verify:rollbacks`, which reverses every migration and leaves
 * the public schema empty — and then measured `public tables = 0, schema_migrations rows = 56`.
 * This check reported **no drift** against a database with nothing in it, because the ledger and
 * the files agreed perfectly. They were agreeing about a database that no longer existed.
 *
 * That is the same class as `verify:rollbacks`' own localhost guard and
 * `check:decision-debt`'s fail-closed branch: a guard that cannot tell "healthy" from
 * "unreadable" reports healthy, which is the one answer it must never invent.
 *
 * Pure, so every branch is testable without arranging a mutilated database.
 *
 * @param {{ migrationFileCount: number, appliedCount: number, publicTableCount: number }} facts
 * @returns {{ ok: boolean, reasons: string[] }}
 */
export const evaluatePreconditions = ({ migrationFileCount, appliedCount, publicTableCount }) => {
  const reasons = [];

  // Reading zero files is never a finding about the database. It is this script standing in the
  // wrong directory, and without this it would be reported as "56 applied with no file here" —
  // a confident diagnosis pointing at the wrong system.
  if (migrationFileCount === 0) {
    reasons.push(
      'read ZERO migration files. That is a problem with this check, not with the database: ' +
        'it is almost certainly running from the wrong working directory. Refusing to report ' +
        'on drift computed against an empty file set.',
    );
  }

  // The rollback trap, and it is the reason this function exists.
  if (appliedCount > 0 && publicTableCount === 0) {
    reasons.push(
      `the ledger claims ${String(appliedCount)} migration(s) are applied and the public schema ` +
        'has NO TABLES. The rollback scripts do not touch ' +
        '`supabase_migrations.schema_migrations`, so a fully rolled-back database still reports ' +
        'every version as applied. Drift would say "no drift" here and it would be describing a ' +
        'database that is gone.',
    );
  }

  // The other direction: a schema that exists without a ledger that explains it.
  if (appliedCount === 0 && publicTableCount > 0) {
    reasons.push(
      `the public schema has ${String(publicTableCount)} table(s) and the ledger is EMPTY. ` +
        'Something built this schema outside the migration path, so "every file is unapplied" ' +
        'would be the wrong conclusion to draw from a true statement.',
    );
  }

  return { ok: reasons.length === 0, reasons };
};

/**
 * MR-35 C1. HOW the applied set falls short, not how far.
 *
 * A count cannot tell a deploy that stopped part-way from a set of cherry-picked versions, and
 * those need different responses: the first resumes with another `db push`, the second means
 * somebody applied migrations out of band and the repository is not the record of production.
 *
 * `partial-prefix` is the shape MR-34 produced deliberately: the push applied 17 of 37 in order
 * and stopped, so the applied set is exactly the first N files.
 *
 * @param {readonly string[]} fileVersions sorted
 * @param {readonly string[]} appliedVersions sorted
 * @returns {'complete' | 'partial-prefix' | 'interleaved' | 'foreign-versions'}
 */
/**
 * MR-42 C1 — WHICH of three states this run is in, so a red means something.
 *
 * **The problem this solves.** Production has applied the first 19 migrations and `main` has
 * 60, because the schema has not been deployed yet. That is a KNOWN, ACCEPTED state, and the
 * check has reported it as a failure on every commit for weeks. **A red that is correct every
 * day is indistinguishable from a red that is broken**, and the thing it would need to shout
 * about — somebody hand-running `supabase db push` against production — arrives as one more
 * red on a pile of reds. 22 August is what that looks like when it happens.
 *
 * So, the same three states `backup.yml` uses for `BE-W11`, with the deferral as a dated,
 * attributable record rather than an absence:
 *
 * - `no-drift` — everything applied. Green.
 * - `accepted-not-deployed` — the ONLY shortfall is a trailing run of unapplied migrations,
 *   nothing was applied that has no file here, and the accept-by date has not passed. Green,
 *   with a notice naming the state and the date. **The deploy is the trigger that ends it.**
 * - `deferral-expired` — the same shape, but the date has passed. Red, and the red means the
 *   deferral lapsed rather than the schema broke.
 * - `real-drift` — anything else. Red.
 *
 * **`foreign-versions` and `interleaved` are NEVER accepted, at any date.** A version applied
 * with no file here means somebody pushed out of band; an interleaved gap means versions were
 * applied individually. Those are the findings this check exists for, and accepting them
 * because a date has not passed would be the check certifying the thing it is watching for.
 *
 * Pure, so all four states are asserted without arranging a database.
 *
 * @param {{ result: { drifted: boolean, appliedWithoutFile: readonly string[] },
 *           shortfall: 'complete' | 'partial-prefix' | 'interleaved' | 'foreign-versions',
 *           today: string, acceptUntil: string | null }} facts
 * @returns {'no-drift' | 'accepted-not-deployed' | 'deferral-expired' | 'real-drift'}
 */
export const classifyRun = ({ result, shortfall, today, acceptUntil }) => {
  if (!result.drifted) return 'no-drift';

  // Out-of-band application is never acceptable, whatever the date says.
  if (result.appliedWithoutFile.length > 0) return 'real-drift';
  if (shortfall !== 'partial-prefix') return 'real-drift';

  if (acceptUntil === null) return 'real-drift';
  return today > acceptUntil ? 'deferral-expired' : 'accepted-not-deployed';
};

export const classifyShortfall = (fileVersions, appliedVersions) => {
  const files = [...fileVersions].sort();
  const applied = [...appliedVersions].sort();

  if (applied.some((v) => !files.includes(v))) return 'foreign-versions';
  if (applied.length === files.length) return 'complete';

  const prefix = files.slice(0, applied.length);
  return prefix.every((v, i) => v === applied[i]) ? 'partial-prefix' : 'interleaved';
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
  let publicTableCount;
  try {
    const { rows } = await client.query(
      'select version from supabase_migrations.schema_migrations order by version',
    );
    appliedVersions = rows.map((row) => String(row.version));

    // MR-35 C1. Read the SCHEMA, not just the ledger. The ledger is a claim about the database;
    // this is the database. Asking only the claim is how "no drift" was reported against an
    // empty one.
    const tables = await client.query(
      "select count(*)::int as n from pg_tables where schemaname = 'public'",
    );
    publicTableCount = Number(tables.rows[0]?.n ?? 0);
  } finally {
    await client.end();
  }

  const preconditions = evaluatePreconditions({
    migrationFileCount: fileVersions.length,
    appliedCount: appliedVersions.length,
    publicTableCount,
  });

  if (!preconditions.ok) {
    console.error('\nThis check cannot report on drift, because its own preconditions fail:');
    for (const reason of preconditions.reasons) console.error(`  - ${reason}`);
    console.error(
      '\nNo drift verdict is being given either way. A guard that cannot tell healthy from ' +
        'unreadable must not answer healthy.',
    );
    process.exitCode = 1;
    return;
  }

  const result = compareMigrations(fileVersions, appliedVersions);

  console.log(
    JSON.stringify(
      {
        host,
        migrationFiles: fileVersions.length,
        appliedVersions: appliedVersions.length,
        publicTables: publicTableCount,
        shortfall: classifyShortfall(fileVersions, appliedVersions),
        ...result,
      },
      null,
      2,
    ),
  );

  // MR-42 C1. Which of the three states, decided by a pure function so it is asserted in
  // `migration-drift.spec.ts` rather than only observed in a workflow run.
  const shortfallNow = classifyShortfall(fileVersions, appliedVersions);
  const acceptIndex = process.argv.indexOf('--accept-undeployed-until');
  const acceptUntil = acceptIndex === -1 ? null : (process.argv[acceptIndex + 1] ?? null);
  const state = classifyRun({
    result,
    shortfall: shortfallNow,
    today: new Date().toISOString().slice(0, 10),
    acceptUntil,
  });

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

    // MR-35 C1. WHICH shortfall, because the responses differ.
    const shortfall = classifyShortfall(fileVersions, appliedVersions);
    if (shortfall === 'partial-prefix') {
      console.error(
        '\n  SHAPE: partial-prefix. The applied set is exactly the first ' +
          `${String(appliedVersions.length)} files in order, so this looks like a deploy that ` +
          'STOPPED rather than a schema that was never deployed. `supabase db push` resumes ' +
          'from where it stopped -- read the error from that run before pushing again. Note ' +
          'that a half-applied schema can have the same TABLE COUNT as a complete one, so do ' +
          'not judge this by structure.',
      );
    } else if (shortfall === 'interleaved') {
      console.error(
        '\n  SHAPE: interleaved. The missing versions are NOT a trailing run, so this was not ' +
          'one deploy that stopped. Versions were applied out of band, individually. Find out ' +
          'who did that before applying anything on top.',
      );
    }
  }
  // MR-42 C1. Three outcomes, so a red now means one of exactly two things and says which.
  if (state === 'accepted-not-deployed') {
    console.log(
      '::notice title=BE-W40 schema not deployed yet::Production has applied the first ' +
        String(appliedVersions.length) +
        ' of ' +
        String(fileVersions.length) +
        ' migrations, in order, with nothing applied that has no file here. This is the known ' +
        'pre-deploy state, ACCEPTED until ' +
        String(acceptUntil) +
        '. THE DEPLOY ENDS IT: once the schema is pushed this goes green on its own.',
    );
    console.log(
      'Accepted -- not green by accident. An out-of-band version or an interleaved gap is ' +
        'still red today, and this acceptance expires on its own date.',
    );
    return;
  }

  if (state === 'deferral-expired') {
    console.error(
      '::error title=BE-W40 acceptance expired::The undeployed-schema state was accepted until ' +
        String(acceptUntil) +
        ' and that date has passed. THIS IS NOT NEW DRIFT -- the shape is still a clean ' +
        'trailing shortfall. Either deploy, or move the date in ' +
        '.github/workflows/migration-drift.yml in a commit that says why.',
    );
  } else {
    console.error(
      '::error title=BE-W40 REAL DRIFT::This is NOT the known pre-deploy state. Either a ' +
        'version was applied that has no file in this repository, or the gaps are not a ' +
        'trailing run. Read the detail above before applying anything on top.',
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
