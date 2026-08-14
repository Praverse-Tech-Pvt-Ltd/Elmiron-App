import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { DB_URL, inRolledBackTransaction, requireDatabase, withClient } from './db.js';
import { API_URL, SERVICE_ROLE_KEY, asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';
import { evaluatePurgeHealth, checkPurgeHealth } from '../scripts/check-purge-health.mjs';
import { reconcileAfterRestore } from '../scripts/reconcile-after-restore.mjs';
import { deleteStorageObject, isAlreadyGone } from '../scripts/storage.mjs';

/**
 * BE-W7 — the operational half.
 *
 *   1. The purge is scheduled, and something notices when it stops.
 *   2. A database restore is reconciled against storage, in both directions.
 *   3. The organisation default shift window expires on its own.
 *
 * BE-W6 shipped `audio_purge_health()` so a stopped purge would be visible. Nothing
 * called it, so the 90-day promise was not approximately true — it was false. Most of
 * what follows exists to make that impossible to be true again.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

const asUserTx = async <T>(user: FixtureUser, fn: (client: Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await asUser(client, user);
    return fn(client);
  });

const SYNTHETIC_AUDIO = new Uint8Array(32);

const storageObjectExists = async (storageKey: string): Promise<boolean> => {
  const response = await fetch(`${API_URL}/storage/v1/object/audio/${storageKey}`, {
    headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  return response.ok;
};

const uploadObject = async (storageKey: string): Promise<void> => {
  const response = await fetch(`${API_URL}/storage/v1/object/audio/${storageKey}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'audio/ogg',
    },
    body: SYNTHETIC_AUDIO,
  });
  if (!response.ok) {
    throw new Error(`upload failed: ${String(response.status)} ${await response.text()}`);
  }
};

const deleteObjectOutOfBand = async (storageKey: string): Promise<void> => {
  await fetch(`${API_URL}/storage/v1/object/audio/${storageKey}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
};

const opaqueKey = (): string => `recordings/${randomUUID()}/${randomUUID()}.opus`;

// =============================================================================
// 1. The schedule exists, and something watches it
// =============================================================================

describe('the purge is actually scheduled', () => {
  const workflow = (name: string): string =>
    readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url), 'utf8');

  // A test that only checks a job is registered proves nothing about whether it
  // works — but a worker that works and is never run proves nothing either, and that
  // was exactly the BE-W6 state.
  it('has a cron schedule that runs the retention worker', () => {
    const yaml = workflow('retention.yml');

    const cron = /-\s*cron:\s*'([^']+)'/.exec(yaml)?.[1];
    expect(cron, 'retention.yml declares no cron schedule').toBeDefined();
    // Five fields, or it is not a cron expression and GitHub will ignore it.
    expect((cron ?? '').trim().split(/\s+/)).toHaveLength(5);

    expect(yaml).toMatch(/purge:audio/);
  });

  it('watches the purge from a separate workflow, so one cannot silence the other', () => {
    const watchdog = workflow('retention-watchdog.yml');

    const cron = /-\s*cron:\s*'([^']+)'/.exec(watchdog)?.[1];
    expect(cron, 'retention-watchdog.yml declares no cron schedule').toBeDefined();
    expect((cron ?? '').trim().split(/\s+/)).toHaveLength(5);

    expect(watchdog).toMatch(/check:purge-health/);
    // A watchdog that shares a job with the thing it watches dies with it.
    expect(watchdog).not.toMatch(/purge:audio/);
  });

  it('fails rather than skips when no database is configured', () => {
    // Skipping quietly would recreate the exact BE-W6 gap: a schedule that exists,
    // reports success, and enforces nothing.
    for (const name of ['retention.yml', 'retention-watchdog.yml']) {
      expect(workflow(name), name).toMatch(/exit 1/);
    }
  });
});

describe('the watchdog verdict', () => {
  const HEALTHY = {
    lastSuccessfulRunAt: new Date().toISOString(),
    lastRunAt: new Date().toISOString(),
    overdueObjectCount: 0,
    liveObjectCount: 12,
    stalled: false,
  };

  it('is quiet when the worker is keeping up', () => {
    expect(evaluatePurgeHealth(HEALTHY).healthy).toBe(true);
  });

  it('is quiet on a fresh system that has never held any audio', () => {
    // Otherwise it fires on day one, and an alert that fires on day one is an alert
    // everybody has muted by day three.
    const verdict = evaluatePurgeHealth({
      ...HEALTHY,
      lastSuccessfulRunAt: null,
      lastRunAt: null,
      liveObjectCount: 0,
    });
    expect(verdict.healthy).toBe(true);
  });

  it('fires when the database reports objects past their purge date', () => {
    const verdict = evaluatePurgeHealth({ ...HEALTHY, stalled: true, overdueObjectCount: 7 });
    expect(verdict.healthy).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/7 object\(s\) are past their purge date/);
  });

  it('fires when audio exists and the worker has never completed a run', () => {
    const verdict = evaluatePurgeHealth({ ...HEALTHY, lastSuccessfulRunAt: null });
    expect(verdict.healthy).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/never completed a successful run/);
  });

  it('fires before anything goes overdue, by watching the worker rather than its effect', () => {
    // The whole point of the second rule. If it only watched `stalled`, the first
    // signal would arrive after MRs were already being refused uploads.
    const verdict = evaluatePurgeHealth({
      ...HEALTHY,
      stalled: false,
      overdueObjectCount: 0,
      lastSuccessfulRunAt: new Date(Date.now() - 72 * 3600 * 1000).toISOString(),
    });
    expect(verdict.healthy).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/last succeeded 72.0h ago/);
  });
});

describe.skipIf(!reachable)('the watchdog against the real database', () => {
  it('reads a health shape it can actually evaluate', async () => {
    const result = await checkPurgeHealth({ dbUrl: DB_URL });
    // Guards the join between the SQL and the script: a renamed key in
    // audio_purge_health() would leave the watchdog permanently, silently healthy.
    expect(result.health).toHaveProperty('lastSuccessfulRunAt');
    expect(result.health).toHaveProperty('liveObjectCount');
    expect(result.health).toHaveProperty('stalled');
    expect(typeof result.healthy).toBe('boolean');
  });

  it('reports a simulated stopped worker as unhealthy', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const visitId = randomUUID();
      const consentId = randomUUID();
      await client.query('reset role');
      await client.query(
        `insert into public.visits (id, mr_id, doctor_id, status) values ($1, $2, $3, 'completed')`,
        [visitId, world.users.puneMr.id, world.doctors.pune],
      );
      await client.query(
        `insert into public.consent_records
           (id, visit_id, doctor_id, captured_by_mr_id, outcome, consent_text_version_id,
            displayed_language, captured_at)
         values ($1, $2, $3, $4, 'consented', $5, 'en-IN', now())`,
        [consentId, visitId, world.doctors.pune, world.users.puneMr.id, world.consentTextVersionId],
      );

      const recordingId = randomUUID();
      await client.query(
        `insert into public.recordings
           (id, visit_id, mr_id, consent_record_id, storage_key, bitrate_kbps,
            duration_seconds, size_bytes, recorded_at, purge_after)
         values ($1, $2, $3, $4, $5, 28, 240, 32, now(), now())`,
        [recordingId, visitId, world.users.puneMr.id, consentId, opaqueKey()],
      );
      // Ten days past its purge date. Nothing destroyed it, so nothing is running --
      // DELIBERATELY simulating a stalled worker, safe only because asUserTx never
      // commits. See OVERDUE_NOT_STALLED_MINUTES in db.ts for the COMMITTED case.
      await client.query(
        `update public.recordings set purge_after = now() - interval '10 days' where id = $1`,
        [recordingId],
      );

      const health = await client.query<{ audio_purge_health: Record<string, unknown> }>(
        'select public.audio_purge_health() as audio_purge_health',
      );
      const verdict = evaluatePurgeHealth(health.rows[0]?.audio_purge_health ?? {});

      expect(verdict.healthy).toBe(false);
      expect(verdict.reasons.join(' ')).toMatch(/past their purge date/);
    });
  });
});

// =============================================================================
// 2. The organisation default shift window expires on its own
// =============================================================================

describe.skipIf(!reachable)('the org default shift window', () => {
  const configure = async (
    client: Client,
    value: Record<string, unknown>,
    effectiveFrom = 'now()',
  ): Promise<void> => {
    await client.query(
      `insert into public.app_thresholds (key, value, effective_from, note)
       values ('org_default_shift_window', $1::jsonb, ${effectiveFrom}, 'test')`,
      [JSON.stringify(value)],
    );
  };

  const WINDOW = {
    shiftStart: '09:00',
    shiftEnd: '19:00',
    timezone: 'Asia/Kolkata',
    graceMinutes: 15,
    activeWeekdays: [1, 2, 3, 4, 5, 6],
  };

  it('refuses a default with no expiry at all', async () => {
    await expect(
      inRolledBackTransaction(async (client) => configure(client, WINDOW)),
    ).rejects.toThrow(/must carry an expiresAt/);
  });

  it('refuses an expiry more than sixty days out', async () => {
    await expect(
      inRolledBackTransaction(async (client) =>
        configure(client, {
          ...WINDOW,
          expiresAt: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
        }),
      ),
    ).rejects.toThrow(/more than 60 days/);
  });

  it('refuses an expiry that is not after the moment it starts applying', async () => {
    await expect(
      inRolledBackTransaction(async (client) =>
        configure(client, {
          ...WINDOW,
          expiresAt: new Date(Date.now() - 3600 * 1000).toISOString(),
        }),
      ),
    ).rejects.toThrow(/is not after effective_from/);
  });

  it('still allows null — switching the fallback off needs no expiry', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(
        `insert into public.app_thresholds (key, value, note)
         values ('org_default_shift_window', 'null'::jsonb, 'test: switched off')`,
      );
      const status = await client.query<{ s: { configured: boolean } }>(
        'select public.org_default_shift_window_status() as s',
      );
      expect(status.rows[0]?.s.configured).toBe(false);
    });
  });

  // The two sides of the boundary.
  it('applies, and is flagged as the org default, before it expires', async () => {
    await inRolledBackTransaction(async (client) => {
      await configure(client, {
        ...WINDOW,
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      });

      // A territory window always wins, and never expires: a territory's real
      // working hours are a fact about the territory, not a stopgap. South inherits
      // National's, so the default must not reach it.
      const resolved = await client.query<{ source: string }>(
        'select source from public.resolve_shift_window($1)',
        [world.territories.south],
      );
      expect(resolved.rows[0]?.source).toBe('territory');

      // A territory with no window anywhere in its ancestry.
      const orphanTerritory = randomUUID();
      await client.query(
        `insert into public.territories (id, name, code, parent_id, organisation_id)
         values ($1, 'Orphan', $2, null, $3)`,
        [orphanTerritory, `IN-ORPH-${randomUUID().slice(0, 8)}`, world.organisationId],
      );

      const fallback = await client.query<{ source: string }>(
        'select source from public.resolve_shift_window($1)',
        [orphanTerritory],
      );
      expect(fallback.rows[0]?.source).toBe('org_default');

      const within = await client.query<{ is_within_shift: boolean }>(
        'select public.is_within_shift($1, $2)',
        [orphanTerritory, '2026-08-12T11:00:00+05:30'],
      );
      expect(within.rows[0]?.is_within_shift).toBe(true);

      const status = await client.query<{ s: { expired: boolean; daysRemaining: number } }>(
        'select public.org_default_shift_window_status() as s',
      );
      expect(status.rows[0]?.s.expired).toBe(false);
      expect(status.rows[0]?.s.daysRemaining).toBeGreaterThan(28);
    });
  });

  it('stops applying after it expires, and capture refuses again', async () => {
    await inRolledBackTransaction(async (client) => {
      const orphanTerritory = randomUUID();
      await client.query(
        `insert into public.territories (id, name, code, parent_id, organisation_id)
         values ($1, 'Orphan', $2, null, $3)`,
        [orphanTerritory, `IN-ORPH-${randomUUID().slice(0, 8)}`, world.organisationId],
      );

      // Backdated so both dates are already in the past, which is the only honest
      // way to reach the expired branch — see the migration header. Anchored to the
      // newest existing row so this row is still the one `threshold()` picks.
      await client.query(
        `insert into public.app_thresholds (key, value, effective_from, note)
         select 'org_default_shift_window',
                jsonb_build_object(
                  'shiftStart', '09:00', 'shiftEnd', '19:00', 'timezone', 'Asia/Kolkata',
                  'graceMinutes', 15, 'activeWeekdays', '[1,2,3,4,5,6]'::jsonb,
                  'expiresAt', to_char(max(t.effective_from) + interval '2 seconds',
                                       'YYYY-MM-DD"T"HH24:MI:SSOF')),
                max(t.effective_from) + interval '1 second',
                'test: already expired'
           from public.app_thresholds t
          where t.key = 'org_default_shift_window'`,
      );

      const status = await client.query<{ s: { expired: boolean } }>(
        'select public.org_default_shift_window_status() as s',
      );
      // If this is false the row was written into the future and everything below
      // would pass for the wrong reason.
      expect(status.rows[0]?.s.expired, 'the test row is not actually expired').toBe(true);

      const resolved = await client.query('select * from public.resolve_shift_window($1)', [
        orphanTerritory,
      ]);
      expect(resolved.rows).toHaveLength(0);

      // Back to the strict BE-W3 rule, automatically, with nobody needing to
      // remember — and the refusal names which of the two problems it is.
      await expect(
        client.query('select public.is_within_shift($1, $2)', [
          orphanTerritory,
          '2026-08-12T11:00:00+05:30',
        ]),
      ).rejects.toThrow(/organisation default shift window expired/);
    });
  });
});

// =============================================================================
// 3. Reconciling a restore
// =============================================================================

describe.skipIf(!reachable)('post-restore reconciliation', () => {
  /** A committed recording whose object really is in the bucket. */
  const committedRecording = async (): Promise<{
    visitId: string;
    recordingId: string;
    storageKey: string;
  }> => {
    const storageKey = opaqueKey();
    const result = await withClient(async (client) => {
      const visitId = randomUUID();
      const consentId = randomUUID();
      const recordingId = randomUUID();
      await client.query(
        `insert into public.visits (id, mr_id, doctor_id, status) values ($1, $2, $3, 'completed')`,
        [visitId, world.users.puneMr.id, world.doctors.pune],
      );
      await client.query(
        `insert into public.consent_records
           (id, visit_id, doctor_id, captured_by_mr_id, outcome, consent_text_version_id,
            displayed_language, captured_at)
         values ($1, $2, $3, $4, 'consented', $5, 'en-IN', now())`,
        [consentId, visitId, world.doctors.pune, world.users.puneMr.id, world.consentTextVersionId],
      );
      // The row before the object, so a concurrent reconciliation in another spec
      // file can never see this key as an orphan.
      await client.query(
        `insert into public.recordings
           (id, visit_id, mr_id, consent_record_id, storage_key, bitrate_kbps,
            duration_seconds, size_bytes, recorded_at, upload_status, purge_after)
         values ($1, $2, $3, $4, $5, 28, 240, 32, now(), 'uploaded', now())`,
        [recordingId, visitId, world.users.puneMr.id, consentId, storageKey],
      );
      return { visitId, recordingId, storageKey };
    });
    await uploadObject(result.storageKey);
    return result;
  };

  it('changes nothing on a dry run', async () => {
    const { recordingId, storageKey } = await committedRecording();
    await deleteObjectOutOfBand(storageKey);

    const result = await reconcileAfterRestore({ dbUrl: DB_URL, apiUrl: API_URL });

    expect(result.applied).toBe(false);
    expect(result.rowsWithoutObject.map((r) => r.id)).toContain(recordingId);

    await withClient(async (client) => {
      const row = await client.query<{ purge_state: string }>(
        'select purge_state from public.recordings where id = $1',
        [recordingId],
      );
      // A tool that destroys audio the first time somebody runs it to see what it
      // does is not a compliance tool.
      expect(row.rows[0]?.purge_state).toBe('live');
    });
  });

  it('re-applies the destruction a restore erased, and says the cause is unknown', async () => {
    const { visitId, recordingId, storageKey } = await committedRecording();

    // The restore rewound the row and the object did not come back with it.
    await deleteObjectOutOfBand(storageKey);

    await reconcileAfterRestore({ dbUrl: DB_URL, apiUrl: API_URL, apply: true, note: 'test' });

    await withClient(async (client) => {
      const row = await client.query<{
        purge_state: string;
        destruction_reason: string;
        storage_key: string | null;
      }>(
        'select purge_state, destruction_reason, storage_key from public.recordings where id = $1',
        [recordingId],
      );
      expect(row.rows[0]?.purge_state).toBe('destroyed');
      // Not `retention` and not `withdrawal`. Absence cannot tell those apart, and a
      // guess written into a compliance record is worse than a recorded unknown.
      expect(row.rows[0]?.destruction_reason).toBe('restore_reconciled');
      expect(row.rows[0]?.storage_key).toBeNull();

      const finding = await client.query<{ kind: string; resolution: string; detail: unknown }>(
        `select kind, resolution, detail from public.restore_reconciliation_findings
          where object_id = $1`,
        [recordingId],
      );
      expect(finding.rows[0]?.kind).toBe('row_without_object');
      expect(finding.rows[0]?.resolution).toBe('quarantined');

      const quarantined = await client.query<{ count: string }>(
        'select count(*) as count from public.visit_audio_quarantine where visit_id = $1',
        [visitId],
      );
      expect(Number(quarantined.rows[0]?.count)).toBe(1);
    });
  });

  it('does not fabricate the withdrawal it cannot prove', async () => {
    const { visitId, recordingId } = await committedRecording();
    await withClient(async (client) => {
      const key = await client.query<{ storage_key: string }>(
        'select storage_key from public.recordings where id = $1',
        [recordingId],
      );
      await deleteObjectOutOfBand(key.rows[0]?.storage_key ?? '');
    });

    await reconcileAfterRestore({ dbUrl: DB_URL, apiUrl: API_URL, apply: true });

    await withClient(async (client) => {
      const withdrawals = await client.query<{ count: string }>(
        `select count(*) as count from public.consent_records
          where visit_id = $1 and is_withdrawal`,
        [visitId],
      );
      // The consent ledger's whole value is that every row in it is a real thing a
      // real doctor really did. An inferred row would be indistinguishable from a
      // genuine one forever afterwards.
      expect(Number(withdrawals.rows[0]?.count)).toBe(0);
    });
  });

  it('blocks new audio for a quarantined visit until a person clears it', async () => {
    const { visitId, storageKey } = await committedRecording();
    await deleteObjectOutOfBand(storageKey);
    await reconcileAfterRestore({ dbUrl: DB_URL, apiUrl: API_URL, apply: true });

    await expect(
      withClient(async (client) => {
        await client.query('begin');
        await asUser(client, world.users.puneMr);
        try {
          return await client.query('select public.begin_upload($1, $2, $3, $4)', [
            visitId,
            'recording',
            4096,
            240,
          ]);
        } finally {
          await client.query('rollback');
        }
      }),
    ).rejects.toThrow(/quarantined after a database restore/);
  });

  it('needs a manager, a reason, and leaves an append-only record of the clearance', async () => {
    const { visitId, storageKey } = await committedRecording();
    await deleteObjectOutOfBand(storageKey);
    await reconcileAfterRestore({ dbUrl: DB_URL, apiUrl: API_URL, apply: true });

    // An MR cannot lift a block placed on their own work.
    await expect(
      asUserTx(world.users.puneMr, (client) =>
        client.query('select public.clear_audio_quarantine($1, $2)', [visitId, 'let me through']),
      ),
    ).rejects.toThrow(/only a field_manager or admin/);

    await expect(
      asUserTx(world.users.westManager, (client) =>
        client.query('select public.clear_audio_quarantine($1, $2)', [visitId, '   ']),
      ),
    ).rejects.toThrow(/requires a reason/);

    await withClient(async (client) => {
      await client.query('begin');
      await asUser(client, world.users.westManager);
      await client.query('select public.clear_audio_quarantine($1, $2)', [
        visitId,
        'Spoke to the doctor on 16 Aug; consent confirmed as standing.',
      ]);
      await client.query('commit');
    });

    await withClient(async (client) => {
      const still = await client.query<{ count: string }>(
        'select count(*) as count from public.visit_audio_quarantine where visit_id = $1',
        [visitId],
      );
      expect(Number(still.rows[0]?.count)).toBe(0);

      const clearance = await client.query<{ reason: string; cleared_by_user_id: string }>(
        `select reason, cleared_by_user_id from public.visit_audio_quarantine_clearances
          where visit_id = $1`,
        [visitId],
      );
      expect(clearance.rows[0]?.cleared_by_user_id).toBe(world.users.westManager.id);
      expect(clearance.rows[0]?.reason).toMatch(/consent confirmed/);

      // The record of who lifted the block outlives the block itself.
      await expect(
        client.query('update public.visit_audio_quarantine_clearances set reason = $1', ['edited']),
      ).rejects.toThrow(/append-only/);
    });
  });

  it('destroys an object no live row references — the worse direction', async () => {
    // An upload that completed after the restore point: the object stayed, the row
    // that bound it to a consent record went back. Audio held with no lawful basis
    // and no retention clock, which nothing else in this system would ever notice.
    const orphanKey = opaqueKey();
    await uploadObject(orphanKey);
    expect(await storageObjectExists(orphanKey)).toBe(true);

    const result = await reconcileAfterRestore({
      dbUrl: DB_URL,
      apiUrl: API_URL,
      apply: true,
      note: 'orphan test',
    });

    expect(result.objectsWithoutRow).toContain(orphanKey);
    expect(await storageObjectExists(orphanKey)).toBe(false);

    await withClient(async (client) => {
      const finding = await client.query<{ kind: string; resolution: string }>(
        `select kind, resolution from public.restore_reconciliation_findings
          where storage_key_hash = public.sha256_hex($1)`,
        [orphanKey],
      );
      expect(finding.rows[0]?.kind).toBe('object_without_row');
      expect(finding.rows[0]?.resolution).toBe('destroyed_object');
    });
  });

  it('leaves an in-flight upload alone — an open session is a live row', async () => {
    const visitId = await withClient(async (client) => {
      const id = randomUUID();
      const consentId = randomUUID();
      await client.query(
        `insert into public.visits (id, mr_id, doctor_id, status) values ($1, $2, $3, 'completed')`,
        [id, world.users.puneMr.id, world.doctors.pune],
      );
      await client.query(
        `insert into public.consent_records
           (id, visit_id, doctor_id, captured_by_mr_id, outcome, consent_text_version_id,
            displayed_language, captured_at)
         values ($1, $2, $3, $4, 'consented', $5, 'en-IN', now())`,
        [consentId, id, world.doctors.pune, world.users.puneMr.id, world.consentTextVersionId],
      );
      return id;
    });

    const grant = await withClient(async (client) => {
      await client.query('begin');
      await asUser(client, world.users.puneMr);
      const row = await client.query<{ storage_key: string }>(
        `select storage_key from public.begin_upload($1, 'recording', 4096, 240)`,
        [visitId],
      );
      await client.query('commit');
      return row.rows[0]?.storage_key ?? '';
    });
    await uploadObject(grant);

    await reconcileAfterRestore({ dbUrl: DB_URL, apiUrl: API_URL, apply: true });

    // Otherwise the reconciliation would destroy every upload in progress at the
    // moment an operator ran it.
    expect(await storageObjectExists(grant)).toBe(true);
  });

  it('treats an object somebody else already deleted as gone, not as a failure', async () => {
    // BE-W6's worker tested this with `response.status === 404` and the branch never
    // fired, because Supabase returns HTTP 400 with the 404 in the BODY. It stayed
    // invisible for a week: claim_expired_audio never re-claims a destroyed row, so
    // the retention worker never asks twice. The reconciliation walks the bucket
    // instead of a claim list and hits it on the first run.
    const missing = `recordings/${randomUUID()}/${randomUUID()}.opus`;
    const response = await fetch(`${API_URL}/storage/v1/object/audio/${missing}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    });
    const body = await response.text();

    // Pinned, so a future Supabase version that starts returning a real 404 breaks
    // this test rather than silently changing what the workers treat as success.
    expect(response.status).toBe(400);
    expect(body).toMatch(/NoSuchKey/);
    expect(isAlreadyGone(response.status, body)).toBe(true);

    await expect(
      deleteStorageObject(
        { apiUrl: API_URL, bucket: 'audio', serviceKey: SERVICE_ROLE_KEY },
        missing,
      ),
    ).resolves.toBeUndefined();
  });

  it('records findings that cannot be edited afterwards', async () => {
    await withClient(async (client) => {
      await expect(
        client.query(`update public.restore_reconciliation_findings set detail = '{}'::jsonb`),
      ).rejects.toThrow(/append-only/);
    });
  });
});
