import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { deleteStorageObject } from './storage.mjs';

/**
 * The 90-day audio retention worker.
 *
 * A storage object is not a row. Deleting from `storage.objects` in SQL leaves the
 * file behind in the storage backend, so the object has to go through the storage
 * API — which means this job cannot live entirely in Postgres.
 *
 * Shape: claim a batch, delete each object through the API, confirm each one.
 *
 *   * Idempotent — confirming an already-destroyed object is a no-op, and a missing
 *     object counts as destroyed rather than as a failure. Running it twice is safe.
 *   * Resumable — a crash between claim and confirm leaves rows claimed; the next
 *     run re-claims anything stale and finishes the job.
 *   * Safe to interleave with a consent withdrawal, which marks the same rows
 *     through the same machinery rather than deleting them itself.
 *
 * Run: pnpm --filter @elmiron/api purge:audio
 */

const DEFAULTS = {
  dbUrl: process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  apiUrl: process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
  serviceKey:
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
  bucket: 'audio',
  limit: 100,
};

/**
 * BE-W7: this used to live here as `response.ok || response.status === 404`, and
 * that check never fired. Supabase returns HTTP 400 for a missing object, with the
 * 404 in the response BODY — so "somebody already removed it" was being treated as a
 * hard failure. Nothing caught it because `claim_expired_audio` never re-claims a
 * destroyed row, so this worker never asked twice. See scripts/storage.mjs.
 */
const deleteObject = deleteStorageObject;

export const runPurge = async (overrides = {}) => {
  const config = { ...DEFAULTS, ...overrides };
  const runId = overrides.runId ?? randomUUID();

  const client = new Client({ connectionString: config.dbUrl });
  await client.connect();

  let claimed = 0;
  let destroyed = 0;
  let failed = 0;
  let abandoned = 0;

  try {
    // BE-W7. An upload session whose clocks ran out is still `open`, and
    // claim_expired_audio only collects partials that are `abandoned` or `revoked` —
    // so without this sweep a device that stopped uploading and never came back
    // leaves its partial object in the bucket FOREVER. Nothing else closes a session
    // the MR never returns to.
    //
    // Runs before the claim so anything it closes is collected on this pass rather
    // than the next one.
    const closed = await client.query('select public.close_stale_upload_sessions() as closed');
    abandoned = Number(closed.rows[0]?.closed ?? 0);

    const batch = await client.query('select * from public.claim_expired_audio($1, $2)', [
      runId,
      config.limit,
    ]);
    claimed = batch.rows.length;

    for (const row of batch.rows) {
      try {
        if (row.storage_key !== null) {
          await deleteObject(config, row.storage_key);
        }
        await client.query('select public.confirm_audio_destroyed($1, $2, $3)', [
          runId,
          row.object_kind,
          row.object_id,
        ]);
        destroyed += 1;
      } catch (error) {
        failed += 1;
        // Recorded rather than thrown: one unreachable object must not stop the
        // other ninety-nine from being destroyed on time.
        await client.query('select public.record_audio_purge_failure($1, $2)', [
          runId,
          error instanceof Error ? error.message : String(error),
        ]);
      }
    }

    await client.query('select public.finish_audio_purge_run($1, $2)', [runId, claimed]);
  } finally {
    await client.end();
  }

  return { runId, claimed, destroyed, failed, abandoned };
};

// CLI entry. Importing this module does not run anything.
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
) {
  const result = await runPurge();
  console.log(
    `purge ${result.runId}: closed ${String(result.abandoned)} stale session(s), ` +
      `claimed ${String(result.claimed)}, destroyed ${String(result.destroyed)}, ` +
      `failed ${String(result.failed)}`,
  );
  if (result.failed > 0) process.exit(1);
}
