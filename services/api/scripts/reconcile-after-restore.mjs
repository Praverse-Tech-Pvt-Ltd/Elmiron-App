import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { deleteStorageObject } from './storage.mjs';

/**
 * Post-restore reconciliation.
 *
 * A point-in-time restore rewinds the database and not the object store. That breaks
 * the two systems apart in both directions at once:
 *
 *   * rows that claim live audio whose object is gone — and the withdrawal that
 *     probably destroyed it was rewound away with everything else, so the consent
 *     ledger now says the doctor never withdrew;
 *   * objects with no row at all — an upload that completed after the restore point,
 *     whose recording row was rewound away, leaving audio held with no consent
 *     record and no retention clock.
 *
 * `storage.objects` cannot answer either question: it is a table in the same
 * database and it was rewound too. The object store is the only witness that did not
 * travel back, so this walks it over HTTP.
 *
 * DRY RUN BY DEFAULT. Pass --apply to act. A tool that destroys audio the first time
 * somebody runs it to see what it does is not a compliance tool.
 *
 * BE-W8 §1.2: --apply also requires --db-url on the command line. A restore is a
 * rare, deliberate event — the operator is present and already typing a command —
 * so there is no cost to naming the target explicitly, and inheriting it from
 * SUPABASE_DB_URL means a stale or wrong value in the environment reconciles the
 * wrong project's storage objects against the wrong project's database. Dry runs
 * still fall back to the environment; nothing is destroyed by a dry run.
 *
 * Run: pnpm --filter @elmiron/api reconcile:restore -- --apply --db-url "<pooler url>" --note "PITR to 14 Aug"
 */

const DEFAULTS = {
  dbUrl: process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  apiUrl: process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
  serviceKey:
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
  bucket: 'audio',
  apply: false,
  note: null,
};

const authHeaders = (config) => ({
  apikey: config.serviceKey,
  authorization: `Bearer ${config.serviceKey}`,
});

/**
 * Every object key in the bucket, walked prefix by prefix.
 *
 * The list endpoint returns one directory level at a time — entries with a null id
 * are folders — so reaching `recordings/{uuid}/{uuid}.opus` takes three levels. That
 * is O(number of objects) requests, which is slow and is the right trade for
 * something that runs after a restore rather than on a schedule.
 */
const listAllKeys = async (config, prefix = '', seen = new Set()) => {
  const pageSize = 1000;
  let offset = 0;

  for (;;) {
    const response = await fetch(`${config.apiUrl}/storage/v1/object/list/${config.bucket}`, {
      method: 'POST',
      headers: { ...authHeaders(config), 'content-type': 'application/json' },
      body: JSON.stringify({
        prefix,
        limit: pageSize,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      }),
    });

    if (!response.ok) {
      throw new Error(
        `listing ${config.bucket}/${prefix} failed: ${String(response.status)} ${await response.text()}`,
      );
    }

    const page = await response.json();
    if (!Array.isArray(page) || page.length === 0) return seen;

    for (const entry of page) {
      const path = prefix === '' ? entry.name : `${prefix}${entry.name}`;
      // A null id means this is a folder rather than an object.
      if (entry.id === null || entry.id === undefined) {
        await listAllKeys(config, `${path}/`, seen);
      } else {
        seen.add(path);
      }
    }

    if (page.length < pageSize) return seen;
    offset += pageSize;
  }
};

// Shared with the retention worker. An object another process removed between the
// bucket walk and this delete is a success, not a failure — and getting that right
// is less obvious than it looks. See scripts/storage.mjs.
const deleteObject = deleteStorageObject;

/** One key, checked directly. Used to re-verify a finding before acting on it. */
const objectExists = async (config, storageKey) => {
  const response = await fetch(
    `${config.apiUrl}/storage/v1/object/${config.bucket}/${storageKey}`,
    { method: 'GET', headers: authHeaders(config) },
  );
  return response.ok;
};

export const reconcileAfterRestore = async (overrides = {}) => {
  const config = { ...DEFAULTS, ...overrides };
  const runId = overrides.runId ?? randomUUID();

  const client = new Client({ connectionString: config.dbUrl });
  await client.connect();

  const rowsWithoutObject = [];
  const objectsWithoutRow = [];

  try {
    const claimed = await client.query(
      'select * from public.begin_restore_reconciliation($1, $2)',
      [runId, config.note],
    );

    const objectKeys = await listAllKeys(config);
    const rowKeys = new Set(claimed.rows.map((row) => row.storage_key));

    // Direction one: the database believes it holds audio the object store does not
    // have. The audio is gone and is not coming back.
    for (const row of claimed.rows) {
      if (objectKeys.has(row.storage_key)) continue;
      // The walk is a smear across time, not a snapshot. An upload that finished
      // after this bucket prefix was listed looks identical to one that never
      // arrived, so the object is re-checked directly before anything is destroyed.
      if (await objectExists(config, row.storage_key)) continue;

      rowsWithoutObject.push({ kind: row.object_kind, id: row.object_id, visitId: row.visit_id });
      if (config.apply) {
        await client.query('select public.reconcile_row_without_object($1, $2, $3)', [
          runId,
          row.object_kind,
          row.object_id,
        ]);
      }
    }

    // Direction two, and the worse one: audio nothing references. No consent record
    // covers it and no retention clock governs it, and neither can be recovered
    // after the fact, so it cannot be kept.
    for (const key of objectKeys) {
      if (rowKeys.has(key)) continue;
      // Same smear, other direction: a session opened after the row snapshot owns an
      // object that was already in the bucket. Destroying it would delete a live
      // upload out from under the MR making it.
      const referenced = await client.query('select public.storage_key_is_referenced($1) as ok', [
        key,
      ]);
      if (referenced.rows[0]?.ok === true) continue;

      objectsWithoutRow.push(key);
      if (config.apply) {
        await deleteObject(config, key);
        await client.query('select public.reconcile_object_without_row($1, $2)', [runId, key]);
      }
    }

    if (config.apply) {
      await client.query('select * from public.finish_restore_reconciliation($1, $2, $3)', [
        runId,
        claimed.rows.length,
        objectKeys.size,
      ]);
    }

    return {
      runId,
      applied: config.apply,
      rowsChecked: claimed.rows.length,
      objectsSeen: objectKeys.size,
      rowsWithoutObject,
      objectsWithoutRow,
    };
  } finally {
    await client.end();
  }
};

/**
 * Pure, so the refusal is testable without arranging a real restore.
 *
 * `--apply` reconciles storage against the database for real — deleting objects and
 * writing `audit_log` rows — so it must not silently inherit its target from
 * `SUPABASE_DB_URL`. A dry run is harmless and keeps the environment fallback.
 *
 * @param {string[]} argv arguments after the script path (`process.argv.slice(2)`)
 * @returns {{ apply: boolean, dbUrl: string | undefined, note: string | null }}
 * @throws {Error} if --apply is passed without --db-url
 */
export const parseCliArgs = (argv) => {
  const apply = argv.includes('--apply');

  const dbUrlIndex = argv.indexOf('--db-url');
  const dbUrl = dbUrlIndex === -1 ? undefined : argv[dbUrlIndex + 1];

  const noteIndex = argv.indexOf('--note');
  const note = noteIndex === -1 ? null : (argv[noteIndex + 1] ?? null);

  if (apply && (dbUrl === undefined || dbUrl === '')) {
    throw new Error(
      'reconcile:restore --apply refuses to run without --db-url on the command line. ' +
        'This deletes storage objects and writes permanent audit_log rows; inheriting the ' +
        'target from SUPABASE_DB_URL risks reconciling the wrong project against a stale or ' +
        'wrong environment value. Pass --db-url "<pooler url>" explicitly.',
    );
  }

  return { apply, dbUrl, note };
};

// CLI entry. Importing this module does not run anything.
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
) {
  let args;
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const result = await reconcileAfterRestore({
    apply: args.apply,
    note: args.note,
    ...(args.dbUrl !== undefined ? { dbUrl: args.dbUrl } : {}),
  });

  console.log(JSON.stringify(result, null, 2));
  console.log(
    `\n${result.applied ? 'APPLIED' : 'DRY RUN'}: ` +
      `${String(result.rowsChecked)} row(s) checked against ${String(result.objectsSeen)} object(s). ` +
      `${String(result.rowsWithoutObject.length)} row(s) had no object; ` +
      `${String(result.objectsWithoutRow.length)} object(s) had no row.`,
  );

  if (
    !result.applied &&
    (result.rowsWithoutObject.length > 0 || result.objectsWithoutRow.length > 0)
  ) {
    console.log('\nNothing was changed. Re-run with --apply to reconcile.');
  }

  if (result.applied && result.rowsWithoutObject.some((row) => row.kind === 'recording')) {
    console.log(
      '\nOne or more visits are now QUARANTINED. Their audio was destroyed and the record of ' +
        'why is unrecoverable — a withdrawal may have been erased by the restore. No upload ' +
        'grant will be issued for them until a named person clears the quarantine with a reason.',
    );
  }
}
