import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { compareCounts, readCounts } from './backup-database.mjs';

/**
 * `BE-W11` — prove an artefact by RESTORING FROM IT, never by having produced it.
 *
 * **This is the half that matters.** MR-32's first restore drill exited 0 with zero rows
 * restored: `pg_dump` had written nothing because a path was rewritten, `create database`
 * succeeded, the restore log contained zero `ERROR` lines, and only a query — *"migrations:
 * source 56, restored 0"* — revealed it. Every check here is therefore a query against the
 * restored database, compared against a manifest written when the dump was taken.
 *
 * **It restores into a scratch database it creates and drops.** It refuses to restore over an
 * existing one: a verifier that can overwrite the thing it is verifying is a delete command
 * with a reassuring name.
 *
 * Run: pnpm --filter @fieldforce/api backup:verify --artefact ./backups/elmiron-....sql \
 *        --container supabase_db_Elmiron-App
 */

const argValue = (flag) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
};

/**
 * Run `psql` on PATH, or inside a container when one is named.
 *
 * Same reasoning as `pgDumpCommand`: the Postgres client is not on this machine's PATH, it
 * is inside the `supabase_db_*` container, and inside that container the database is on the
 * local socket rather than on the host's published 54322. `--container` therefore means
 * "this container IS the database".
 *
 * @param {{ container?: string, database: string }} target
 */
const makePsql =
  ({ container, adminUrl }) =>
  (database, args) => {
    if (container === undefined || container === '') {
      const url = new URL(adminUrl);
      url.pathname = `/${database}`;
      return spawnSync('psql', ['--dbname', url.toString(), '--no-psqlrc', ...args], {
        encoding: 'utf8',
      });
    }
    const user = new URL(adminUrl).username || 'postgres';
    return spawnSync(
      'docker',
      ['exec', container, 'psql', '-U', user, '-d', database, '--no-psqlrc', ...args],
      { encoding: 'utf8' },
    );
  };

/**
 * Is the hash of the file on disk the one the manifest recorded?
 *
 * Separated and pure-ish so the mismatch path is assertable. A corrupted or truncated
 * artefact is the failure a backup system is most likely to have and least likely to notice.
 *
 * @param {Buffer} bytes
 * @param {string} expected
 * @returns {{ ok: boolean, actual: string }}
 */
export const checkDigest = (bytes, expected) => {
  const actual = createHash('sha256').update(bytes).digest('hex');
  return { ok: actual === expected, actual };
};

const main = async () => {
  const artefact = argValue('--artefact');
  if (artefact === undefined) throw new Error('backup:verify needs --artefact <path to .sql>');
  const manifestPath = `${artefact}.manifest.json`;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  const adminUrl =
    argValue('--db-url') ??
    process.env.SUPABASE_DB_URL ??
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  const scratch = argValue('--scratch') ?? 'backup_verify';
  const container = argValue('--container');
  const psql = makePsql({ container, adminUrl });
  // The counts are always read from the HOST over TCP, whichever way psql runs: the scratch
  // database is in the same cluster, and the checks must not depend on the tool that did the
  // restore.
  const scratchUrlFor = (name) => {
    const url = new URL(adminUrl);
    url.pathname = `/${name}`;
    return url.toString();
  };

  console.log(`Verifying ${artefact}`);
  console.log(`  manifest taken ${manifest.createdAt} from ${manifest.host}`);

  // 1. The bytes on disk are the bytes that were hashed.
  const bytes = readFileSync(artefact);
  const digest = checkDigest(bytes, manifest.sha256);
  if (!digest.ok) {
    throw new Error(
      `sha256 mismatch.\n  manifest: ${manifest.sha256}\n  on disk:  ${digest.actual}\n` +
        'The artefact is not the file the manifest describes.',
    );
  }
  console.log(`  sha256 matches (${String(bytes.length)} bytes)`);

  // 2. Restore into a scratch database, refusing to reuse an existing one.
  const exists = psql('postgres', [
    '-tAc',
    `select 1 from pg_database where datname = '${scratch}'`,
  ]);
  if (exists.stdout.trim() === '1') {
    throw new Error(
      `database "${scratch}" already exists. Refusing to restore over it — drop it, or pass ` +
        'a different --scratch name. A verifier that overwrites is a delete command with a ' +
        'reassuring name.',
    );
  }
  const created = psql('postgres', ['-c', `create database ${scratch}`]);
  if (created.status !== 0) throw new Error(`could not create ${scratch}:\n${created.stderr}`);

  const scratchUrl = scratchUrlFor(scratch);
  // With a container, the artefact has to be put where psql can see it. The in-container
  // path is fixed for the same MSYS reason recorded in MR-32: a host path passed through
  // `docker exec` is rewritten on Windows.
  const innerArtefact = '/tmp/elmiron-verify.sql';
  if (container !== undefined && container !== '') {
    const copied = spawnSync('docker', ['cp', artefact, `${container}:${innerArtefact}`], {
      encoding: 'utf8',
    });
    if (copied.status !== 0) throw new Error(`docker cp failed:\n${copied.stderr}`);
  }

  try {
    const restore = psql(scratch, [
      '-v',
      'ON_ERROR_STOP=0',
      '-f',
      container !== undefined && container !== '' ? innerArtefact : artefact,
    ]);
    const errorLines = (restore.stdout + restore.stderr)
      .split('\n')
      .filter((line) => line.startsWith('ERROR')).length;
    console.log(
      `  restore finished, psql exit ${String(restore.status)}, ${String(errorLines)} ERROR line(s)`,
    );

    // 3. THE PART THAT MATTERS. Query the restored database and compare against the
    //    manifest. `restore.status` and `errorLines` above are context, not evidence --
    //    MR-32's failed drill had exit 0 and zero error lines.
    const restored = await readCounts(scratchUrl);
    const verdict = compareCounts(manifest.counts, restored);

    console.log(JSON.stringify({ source: manifest.counts, restored, ...verdict }, null, 2));

    if (!verdict.ok) {
      console.error(`\nRESTORE DID NOT MATCH:\n  ${verdict.differences.join('\n  ')}`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `\nVerified by restoring: ${String(restored.migrations)} migrations, ` +
        `${String(restored.tables)} tables, ${String(restored.rlsTables)} with RLS, ` +
        `${String(restored.policies)} policies, and every recorded row count matched.`,
    );
  } finally {
    if (container !== undefined && container !== '') {
      spawnSync('docker', ['exec', container, 'rm', '-f', innerArtefact]);
    }
    const dropped = psql('postgres', ['-c', `drop database if exists ${scratch}`]);
    console.log(
      dropped.status === 0
        ? `  scratch ${scratch} dropped`
        : `  WARNING: could not drop ${scratch}`,
    );
  }
};

if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/gu, '/'))
) {
  await main();
}
