import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';

/**
 * `BE-W11` — produce a restorable artefact, and a manifest that can be checked without this
 * script, without `pg_restore`, and without trusting an exit code.
 *
 * **Why this exists.** MR-32 executed `docs/restore-runbook.md` for the first time and found
 * its step 2 was the single word *"Restore."* There is no PITR (declined), and there was no
 * dump, no schedule and no off-machine copy. The reconciliation that follows a restore works
 * and has nothing to reconcile against.
 *
 * **The artefact is plain SQL, deliberately.** `--format=custom` is smaller and parallel and
 * it can only be read by `pg_restore` of a compatible version. Plain SQL is restorable by
 * `psql`, readable by anything, and diffable — and the manifest beside it is checkable with
 * `sha256sum`. A backup whose only reader is the tool that wrote it is a backup you find out
 * about on the day you need it.
 *
 * **NOT `supabase db dump`, and this was measured rather than assumed.** The project already
 * depends on that CLI, so it was the obvious choice. Against the local stack it produces a
 * 340 KB schema dump containing **zero `auth.` and zero `storage.` tables**, and a 16 MB
 * `--data-only` dump containing **zero rows of `auth.users`** — it is scoped to `public`.
 * A database restored from it has the consent ledger and **nobody who can sign in**, and
 * `storage.objects` empty, which is the metadata the whole reconciliation walks. `pg_dump`
 * of the database carries all of it: MR-32's drill restored 5,033/5,033 auth identities and
 * 128/128 storage rows. The obvious tool produces something that looks like a backup and is
 * not one, which is exactly why B4 proves an artefact by restoring it.
 *
 * **`--container` exists because `pg_dump` is not on this machine's PATH.** The Postgres
 * client lives inside the `supabase_db_*` container here; on a CI runner it is an
 * `apt-get install postgresql-client` away and the flag is omitted. Naming the real
 * deployment is better than a script that only runs somewhere nobody is.
 *
 * **What it verifies, and what it refuses to claim.** It re-reads the file it just wrote,
 * hashes it, and records counts taken from the SOURCE database in the same run. It does NOT
 * claim the artefact restores — only a restore proves that, which is `verifyBackup` below and
 * `pnpm --filter @fieldforce/api backup:verify`. MR-32's first drill exited 0 having restored
 * nothing; only a query caught it.
 *
 * **A non-localhost target must be named on the command line.** This is read-only, so it is
 * not the `reconcile:restore --apply` rule — it is a different one. A dump of this database
 * contains `doctors.full_name`, `user_profiles`, `adverse_event_reports.reported_text` (whose
 * lawful contents are open question 4.1), `transcripts_redacted` and every row of
 * `auth.users`. Producing that file is a data-processing act, and an act like that should
 * never happen because a stale environment variable was lying around.
 *
 * Run: pnpm --filter @fieldforce/api backup:database --container supabase_db_Elmiron-App
 *      pnpm --filter @fieldforce/api backup:database --db-url "<url>" --out ./backups
 */

const LOCAL_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', '[::1]']);

const argValue = (flag, argv = process.argv) => {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
};

/**
 * The tables whose row counts go in the manifest.
 *
 * Chosen so a restore can be checked against something that MEANS something rather than
 * against a byte count: the consent ledger, the visits it hangs off, the thresholds that
 * govern refusals, and the identities without which nobody can sign in.
 *
 * @type {readonly string[]}
 */
export const MANIFEST_TABLES = [
  'public.consent_records',
  'public.visits',
  'public.doctors',
  'public.app_thresholds',
  'auth.users',
];

/**
 * Refuse a non-local target that was not named on the command line.
 *
 * Pure, so the refusal is testable without a database.
 *
 * @param {{ dbUrlFlag?: string, envUrl?: string }} input
 * @returns {string} the URL to use
 */
export const resolveTarget = ({ dbUrlFlag, envUrl }) => {
  if (dbUrlFlag !== undefined && dbUrlFlag !== '') return dbUrlFlag;
  const fallback = envUrl ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  const host = new URL(fallback).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      'backup:database refuses a non-local target that was not named on the command line. ' +
        `SUPABASE_DB_URL points at ${host}. A dump of this database contains doctors' names, ` +
        'user profiles, adverse-event report text and every auth identity; producing that file ' +
        'is a data-processing act and must not happen because an environment variable was ' +
        'left set. Pass --db-url "<url>" explicitly.',
    );
  }
  return fallback;
};

/**
 * What a restored database must match for the restore to be believed.
 *
 * @param {{ migrations: number, tables: number, rlsTables: number, policies: number, rows: Record<string, number> }} a
 * @param {{ migrations: number, tables: number, rlsTables: number, policies: number, rows: Record<string, number> }} b
 * @returns {{ ok: boolean, differences: string[] }}
 */
export const compareCounts = (a, b) => {
  const differences = [];
  for (const key of ['migrations', 'tables', 'rlsTables', 'policies']) {
    if (a[key] !== b[key])
      differences.push(`${key}: source ${String(a[key])}, restored ${String(b[key])}`);
  }
  for (const table of Object.keys(a.rows)) {
    if (a.rows[table] !== b.rows[table]) {
      differences.push(
        `${table}: source ${String(a.rows[table])}, restored ${String(b.rows[table])}`,
      );
    }
  }
  return { ok: differences.length === 0, differences };
};

/** Counts taken from a live database, in the shape `compareCounts` takes. */
export const readCounts = async (dbUrl) => {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    const one = async (sql) => Number((await client.query(sql)).rows[0].n);
    const rows = {};
    for (const table of MANIFEST_TABLES) {
      // A table absent from an older dump is recorded as -1 rather than crashing the
      // comparison: "this table did not exist" and "this table was empty" are different.
      try {
        rows[table] = await one(`select count(*)::int as n from ${table}`);
      } catch {
        rows[table] = -1;
      }
    }
    return {
      migrations: await one('select count(*)::int as n from supabase_migrations.schema_migrations'),
      tables: await one(
        "select count(*)::int as n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'",
      ),
      rlsTables: await one(
        "select count(*)::int as n from pg_tables t join pg_class c on c.relname=t.tablename and c.relrowsecurity where t.schemaname='public'",
      ),
      policies: await one("select count(*)::int as n from pg_policies where schemaname='public'"),
      rows,
    };
  } finally {
    await client.end();
  }
};

/**
 * Run `pg_dump` on PATH, or inside a container when one is named.
 *
 * The container form dumps to a path inside the container and copies the file out, because
 * the manifest, the hash and every later check happen on the host. Exported so the argument
 * construction is assertable without a database or a container.
 *
 * @param {{ dbUrl: string, sqlPath: string, container?: string }} input
 */
export const pgDumpCommand = ({ dbUrl, sqlPath, container }) => {
  if (container === undefined || container === '') {
    return {
      command: 'pg_dump',
      args: [
        '--dbname',
        dbUrl,
        '--format=plain',
        '--no-owner',
        '--no-privileges',
        '--file',
        sqlPath,
      ],
      copyOut: undefined,
    };
  }
  // A fixed in-container path: the host path is a Windows path here and would be rewritten
  // on the way in, which is the MSYS trap MR-32 recorded against docker and adb alike.
  const inner = '/tmp/elmiron-backup.sql';
  // **Inside the container, connect over the local socket, not over the URL.** The host URL
  // names port 54322, which is the PUBLISHED port; the container's own localhost has
  // Postgres on 5432. Passing the host URL through `docker exec` produced
  // "connection to server at 127.0.0.1, port 54322 failed: Connection refused" -- the
  // container looking for a port only the host has. `--container` therefore means "this
  // container IS the database", and any non-local target must not use it.
  const url = new URL(dbUrl);
  const user = url.username === '' ? 'postgres' : decodeURIComponent(url.username);
  const database = url.pathname.replace(/^\//u, '') || 'postgres';
  return {
    command: 'docker',
    args: [
      'exec',
      container,
      'pg_dump',
      '-U',
      user,
      '-d',
      database,
      '--format=plain',
      '--no-owner',
      '--no-privileges',
      '--file',
      inner,
    ],
    copyOut: { container, inner },
  };
};

const runPgDump = ({ dbUrl, sqlPath, container }) => {
  const plan = pgDumpCommand({ dbUrl, sqlPath, container });
  const result = spawnSync(plan.command, plan.args, { encoding: 'utf8' });
  if (result.status !== 0 || plan.copyOut === undefined) return result;
  const copied = spawnSync(
    'docker',
    ['cp', `${plan.copyOut.container}:${plan.copyOut.inner}`, sqlPath],
    { encoding: 'utf8' },
  );
  spawnSync('docker', ['exec', plan.copyOut.container, 'rm', '-f', plan.copyOut.inner]);
  if (copied.status !== 0) {
    return { ...copied, status: copied.status, stderr: `docker cp failed:\n${copied.stderr}` };
  }
  return result;
};

const main = async () => {
  const dbUrl = resolveTarget({
    dbUrlFlag: argValue('--db-url'),
    envUrl: process.env.SUPABASE_DB_URL,
  });
  const outDir = resolve(argValue('--out') ?? 'backups');
  const host = new URL(dbUrl).hostname;
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  mkdirSync(outDir, { recursive: true });
  const sqlPath = join(outDir, `elmiron-${stamp}.sql`);
  const manifestPath = `${sqlPath}.manifest.json`;

  console.log(`Backing up ${host} to ${sqlPath}`);

  // Counts from the SOURCE, in the same run, so the manifest describes what was dumped
  // rather than what the database happened to hold when somebody later went looking.
  const counts = await readCounts(dbUrl);

  const dump = runPgDump({ dbUrl, sqlPath, container: argValue('--container') });
  if (dump.error !== undefined && dump.error !== null) {
    throw new Error(
      `pg_dump could not be run (${dump.error.message}). It is not on PATH here; on Debian/Ubuntu ` +
        'install postgresql-client, or pass --container <supabase_db container> to use the ' +
        'client inside it.',
    );
  }
  if (dump.status !== 0) {
    throw new Error(`pg_dump exited ${String(dump.status)}:\n${dump.stderr}`);
  }

  // Re-read what was written. `pg_dump` exiting 0 is not the same as a file on disk with
  // bytes in it -- MR-32's drill produced exactly that combination.
  const bytes = readFileSync(sqlPath);
  const size = statSync(sqlPath).size;
  if (size === 0) throw new Error(`pg_dump exited 0 and wrote an empty file to ${sqlPath}.`);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  const manifest = {
    createdAt: new Date().toISOString(),
    host,
    artefact: sqlPath,
    sizeBytes: size,
    sha256,
    counts,
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(JSON.stringify(manifest, null, 2));
  console.log(
    `\nWrote ${String(size)} bytes. Check it without this script:\n` +
      `  sha256sum ${sqlPath}\n` +
      `  # expect ${sha256}\n` +
      '\nTHIS DOES NOT PROVE IT RESTORES. Run backup:verify against the artefact to prove that.',
  );
};

if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/gu, '/'))
) {
  await main();
}
