import { Client } from 'pg';
import { randomUUID } from 'node:crypto';

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

const deleteObject = async (config, storageKey) => {
  const response = await fetch(
    `${config.apiUrl}/storage/v1/object/${config.bucket}/${storageKey}`,
    {
      method: 'DELETE',
      headers: {
        apikey: config.serviceKey,
        authorization: `Bearer ${config.serviceKey}`,
      },
    },
  );

  // 404 means somebody already removed it — a previous run, or the withdrawal
  // cascade racing this one. Both are success for our purposes: the object is gone.
  if (response.ok || response.status === 404) return;

  throw new Error(
    `storage delete failed for ${storageKey}: ${String(response.status)} ${await response.text()}`,
  );
};

export const runPurge = async (overrides = {}) => {
  const config = { ...DEFAULTS, ...overrides };
  const runId = overrides.runId ?? randomUUID();

  const client = new Client({ connectionString: config.dbUrl });
  await client.connect();

  let claimed = 0;
  let destroyed = 0;
  let failed = 0;

  try {
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

  return { runId, claimed, destroyed, failed };
};

// CLI entry. Importing this module does not run anything.
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
) {
  const result = await runPurge();
  console.log(
    `purge ${result.runId}: claimed ${String(result.claimed)}, destroyed ${String(result.destroyed)}, failed ${String(result.failed)}`,
  );
  if (result.failed > 0) process.exit(1);
}
