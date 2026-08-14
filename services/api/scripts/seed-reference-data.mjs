import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Client } from 'pg';

/**
 * Seeds organisations, territories, doctors and consent-text versions from a JSON
 * file. Nothing about the actual reference data lives in this repo — no
 * organisation name, no territory list, no doctor, no legal consent-text copy — and
 * that is deliberate. `handover.md` is explicit: do not create org/territory/doctor
 * rows on production just to test. This script is infrastructure; the data file is
 * supplied separately, and this script never invents one.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write. BE-W8 §1.2's reasoning applies here
 * too: --apply requires --db-url on the command line, not inherited from the
 * environment, because a stale SUPABASE_DB_URL would seed the wrong project.
 *
 * IDEMPOTENT BY CONSTRUCTION, not by an ON CONFLICT DO NOTHING against a natural
 * key that might not exist. Every row's id is derived deterministically from a
 * stable "key" string in the data file (sha256 of "<table>:<key>", formatted as a
 * uuid) rather than gen_random_uuid(). Running the same file twice inserts nothing
 * the second time, because the second run computes the same ids and ON CONFLICT
 * (id) DO NOTHING skips them. Renaming a key in the data file creates a new row
 * rather than renaming the old one -- there is no update path here on purpose;
 * correcting seeded reference data is a decision for a person, not this script.
 *
 * TERRITORY SHIFT WINDOWS ARE DELIBERATELY NOT SEEDED. capture must keep refusing
 * until the client's real per-territory hours arrive. Nothing in this script can
 * set org_default_shift_window or a territory_shift_windows row.
 *
 * AUDIT_LOG: territories, doctors and consent_text_versions each carry an
 * unconditional AFTER INSERT trigger (write_audit_row) that fires for every writer,
 * including service_role -- BYPASSRLS skips RLS policies, not triggers. Seeding
 * through this script therefore writes real, permanent audit_log rows, with
 * actor_id and actor_role both null because there is no JWT behind a direct
 * database connection. This is not suppressed and cannot be without disabling the
 * trigger, which would be exactly the kind of guard-that-can-be-switched-off this
 * project's constraints.md rules out. Read plainly: the audit trail will show that
 * a system/service-role process inserted these rows, which is true, and is a
 * feature of the audit log rather than a hole in it. organisations has no audit
 * trigger, so organisation inserts write nothing to audit_log.
 *
 * Run: pnpm --filter @elmiron/api seed:reference -- --data path/to/reference.json --apply --db-url "<pooler url>"
 */

const NAMESPACE = 'elmiron-reference-data-seed';

/** Deterministic, stable across runs. Not RFC 4122 v5, just a valid uuid shape. */
const deterministicId = (table, key) => {
  const hash = createHash('sha256').update(`${NAMESPACE}:${table}:${key}`).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `${['8', '9', 'a', 'b'][parseInt(hash[16], 16) % 4]}${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join('-');
};

const readReferenceData = async (path) => {
  const raw = await readFile(path, 'utf8');
  const data = JSON.parse(raw);
  for (const field of ['organisations', 'territories', 'doctors', 'consentTextVersions']) {
    if (!Array.isArray(data[field])) {
      throw new Error(`reference data file is missing a "${field}" array`);
    }
  }
  return data;
};

export const seedReferenceData = async (data, overrides = {}) => {
  const apply = overrides.apply === true;
  const client = new Client({ connectionString: overrides.dbUrl });
  await client.connect();

  const counts = { organisations: 0, territories: 0, doctors: 0, consentTextVersions: 0 };

  try {
    // Always runs inside a transaction, applied or not -- a dry run that skips the
    // transaction wrapper still executes real inserts in autocommit mode, which is
    // not a dry run at all. Committed only when apply is true; rolled back otherwise,
    // so a dry run's reported counts come from the database actually attempting the
    // insert (ON CONFLICT included) rather than from a guess.
    await client.query('begin');

    for (const org of data.organisations) {
      const id = deterministicId('organisations', org.key);
      const result = await client.query(
        `insert into public.organisations (id, name)
         values ($1, $2)
         on conflict (id) do nothing`,
        [id, org.name],
      );
      counts.organisations += result.rowCount ?? 0;
    }

    // Parent territories must exist before children reference them; the data file
    // is expected to list a territory after its parent.
    for (const territory of data.territories) {
      const id = deterministicId('territories', territory.key);
      const organisationId = deterministicId('organisations', territory.organisationKey);
      const parentId =
        territory.parentKey === null || territory.parentKey === undefined
          ? null
          : deterministicId('territories', territory.parentKey);
      const result = await client.query(
        `insert into public.territories (id, name, code, parent_id, organisation_id)
         values ($1, $2, $3, $4, $5)
         on conflict (id) do nothing`,
        [id, territory.name, territory.code, parentId, organisationId],
      );
      counts.territories += result.rowCount ?? 0;
    }

    for (const doctor of data.doctors) {
      const id = deterministicId('doctors', doctor.key);
      const organisationId = deterministicId('organisations', doctor.organisationKey);
      const territoryId = deterministicId('territories', doctor.territoryKey);
      const result = await client.query(
        `insert into public.doctors
           (id, organisation_id, full_name, registration_number, specialty, qualification, territory_id)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (id) do nothing`,
        [
          id,
          organisationId,
          doctor.fullName,
          doctor.registrationNumber ?? null,
          doctor.specialty ?? null,
          doctor.qualification ?? null,
          territoryId,
        ],
      );
      counts.doctors += result.rowCount ?? 0;
    }

    for (const version of data.consentTextVersions) {
      const id = deterministicId('consentTextVersions', version.key);
      const result = await client.query(
        `insert into public.consent_text_versions (id, version_label, language, full_text)
         values ($1, $2, $3, $4)
         on conflict (id) do nothing`,
        [id, version.versionLabel, version.language, version.fullText],
      );
      counts.consentTextVersions += result.rowCount ?? 0;
    }

    await client.query(apply ? 'commit' : 'rollback');

    return { applied: apply, counts };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
};

/**
 * Pure, so the refusal is testable without a real database.
 *
 * @param {string[]} argv arguments after the script path
 */
export const parseSeedCliArgs = (argv) => {
  const apply = argv.includes('--apply');

  const dataIndex = argv.indexOf('--data');
  const dataPath = dataIndex === -1 ? undefined : argv[dataIndex + 1];
  if (dataPath === undefined || dataPath === '') {
    throw new Error('seed:reference requires --data <path to reference JSON>.');
  }

  const dbUrlIndex = argv.indexOf('--db-url');
  const dbUrl = dbUrlIndex === -1 ? undefined : argv[dbUrlIndex + 1];

  if (apply && (dbUrl === undefined || dbUrl === '')) {
    throw new Error(
      'seed:reference --apply refuses to run without --db-url on the command line. ' +
        'Inheriting the target from SUPABASE_DB_URL risks seeding the wrong project.',
    );
  }

  return { apply, dataPath, dbUrl };
};

// CLI entry. Importing this module does not run anything.
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
) {
  let args;
  try {
    args = parseSeedCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const data = await readReferenceData(args.dataPath);
  const dbUrl =
    args.dbUrl ??
    process.env.SUPABASE_DB_URL ??
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  const result = await seedReferenceData(data, { apply: args.apply, dbUrl });

  console.log(
    `${result.applied ? 'APPLIED' : 'DRY RUN'}: ` +
      `${String(result.counts.organisations)} organisation(s), ` +
      `${String(result.counts.territories)} territory(ies), ` +
      `${String(result.counts.doctors)} doctor(s), ` +
      `${String(result.counts.consentTextVersions)} consent-text version(s) ` +
      `${result.applied ? 'inserted (new rows only; existing keys were skipped)' : 'would be attempted'}.`,
  );

  if (!result.applied) {
    console.log(
      '\nNothing was changed. Re-run with --apply --db-url "<pooler url>" to seed for real.',
    );
  }
}
