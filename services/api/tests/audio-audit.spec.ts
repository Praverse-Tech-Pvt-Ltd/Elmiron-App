import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asOwner, asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * MR-54 `BE-W112` — audio rows are audited, and the grant's progress noise is not.
 *
 * **The asymmetry this pins.** Sixteen tables carried `write_audit_row` and the three that
 * hold audio of a named doctor carried none, so after MR-54 A2 put four real recordings on
 * the server, `audit_log` held zero rows about them. The system recorded that a doctor
 * agreed and not that audio of them was made — and the agreement was about the audio.
 *
 * **Destruction was never the gap**, and these tests do not claim it was:
 * `audio_destruction_log` has recorded destructions since `20260815000300`. The gap is
 * creation, and the change of custody before it.
 *
 * **The two-sided case is the grant.** `record_upload_progress` updates it on every chunk
 * without touching `state`; a trigger that wrote a row for each of those would bury
 * `issued -> revoked` under progress. So: a progress update writes NOTHING, a state change
 * writes ONE, and both halves are asserted in the same transaction so neither can pass by
 * the trigger simply being absent.
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

const consentedVisit = async (client: Client): Promise<string> => {
  const visitId = randomUUID();
  await client.query(
    `insert into public.visits (id, mr_id, doctor_id, status) values ($1, $2, $3, 'completed')`,
    [visitId, world.users.puneMr.id, world.doctors.pune],
  );
  await asOwner(client, () =>
    client.query(
      `insert into public.consent_records
         (id, visit_id, doctor_id, captured_by_mr_id, outcome, consent_text_version_id,
          displayed_language, captured_at)
       values ($1, $2, $3, $4, 'consented', $5, 'en-IN', now())`,
      [
        randomUUID(),
        visitId,
        world.doctors.pune,
        world.users.puneMr.id,
        world.consentTextVersionId,
      ],
    ),
  );
  return visitId;
};

interface AuditRow {
  action: string;
  actor_id: string | null;
  table_name: string;
}

/** Audit rows about one row id, newest last. Read as owner: `audit_log` is function-scoped. */
const auditFor = async (client: Client, rowId: string): Promise<AuditRow[]> =>
  asOwner(client, async () => {
    const { rows } = await client.query<AuditRow>(
      `select action::text as action, actor_id, table_name
         from public.audit_log where row_id = $1 order by id`,
      [rowId],
    );
    return rows;
  });

describe.skipIf(!reachable)('BE-W112 — a recording is audited when it is created', () => {
  it('writes an insert row naming the table, the row and the MR who made it', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const visitId = await consentedVisit(client);
      const grant = await client.query<{ id: string; storage_key: string }>(
        'select * from public.begin_upload($1, $2, $3, $4)',
        [visitId, 'recording', 4096, 240],
      );
      const recordingId = randomUUID();

      await asOwner(client, () =>
        client.query(
          `insert into public.recordings
             (id, visit_id, mr_id, consent_record_id, storage_key, bitrate_kbps,
              duration_seconds, size_bytes, upload_status, recorded_at)
           select $1, $2, $3, c.id, $4, 128, 60, 4096, 'uploaded', now()
             from public.consent_records c where c.visit_id = $2`,
          [recordingId, visitId, world.users.puneMr.id, grant.rows[0]?.storage_key],
        ),
      );

      const rows = await auditFor(client, recordingId);
      // CONTENT, not just "something was logged": the action and the table are what make the
      // row answerable to "when was audio of this doctor created".
      expect(rows).toHaveLength(1);
      expect(rows[0]?.action).toBe('insert');
      expect(rows[0]?.table_name).toBe('recordings');
    });
  });

  it('audits an update too — a purge claim or a withdrawal stamp is a change worth seeing', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const visitId = await consentedVisit(client);
      const recordingId = randomUUID();
      await asOwner(client, async () => {
        await client.query(
          `insert into public.recordings
             (id, visit_id, mr_id, consent_record_id, storage_key, bitrate_kbps,
              duration_seconds, size_bytes, upload_status, recorded_at)
           select $1, $2, $3, c.id, $4, 128, 60, 4096, 'uploaded', now()
             from public.consent_records c where c.visit_id = $2`,
          [
            recordingId,
            visitId,
            world.users.puneMr.id,
            `recordings/${randomUUID()}/${randomUUID()}.m4a`,
          ],
        );
        await client.query('update public.recordings set purge_state = $2 where id = $1', [
          recordingId,
          'claimed',
        ]);
      });

      const rows = await auditFor(client, recordingId);
      expect(rows.map((row) => row.action)).toEqual(['insert', 'update']);
    });
  });
});

describe.skipIf(!reachable)('BE-W112 — a voice note is audited on creation', () => {
  it('writes an insert row', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const visitId = await consentedVisit(client);
      const noteId = randomUUID();
      await asOwner(client, () =>
        client.query(
          `insert into public.voice_notes
             (id, visit_id, mr_id, storage_key, duration_seconds, size_bytes, upload_status,
              recorded_at)
           values ($1, $2, $3, $4, 30, 2048, 'uploaded', now())`,
          [
            noteId,
            visitId,
            world.users.puneMr.id,
            `voice-notes/${randomUUID()}/${randomUUID()}.m4a`,
          ],
        ),
      );

      const rows = await auditFor(client, noteId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.table_name).toBe('voice_notes');
    });
  });
});

describe.skipIf(!reachable)('BE-W112 — the grant is audited on custody, not on progress', () => {
  it('TWO-SIDED: a per-chunk progress update writes nothing, a state change writes one', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const visitId = await consentedVisit(client);
      const grant = await client.query<{ id: string }>(
        'select * from public.begin_upload($1, $2, $3, $4)',
        [visitId, 'recording', 4096, 240],
      );
      const grantId = grant.rows[0]?.id ?? '';

      // Issuing it is custody changing hands, and is recorded.
      expect((await auditFor(client, grantId)).map((row) => row.action)).toEqual(['insert']);

      // Three chunks. `record_upload_progress` never touches `state`, so the filtered trigger
      // must stay silent -- this is the half that fails if the `when` clause is dropped.
      await client.query('select public.record_upload_progress($1, $2)', [grantId, 512]);
      await client.query('select public.record_upload_progress($1, $2)', [grantId, 1024]);
      await client.query('select public.record_upload_progress($1, $2)', [grantId, 2048]);
      expect(
        (await auditFor(client, grantId)).map((row) => row.action),
        'progress updates must not be audited, or the transitions drown',
      ).toEqual(['insert']);

      // And the half that fails if the trigger is missing altogether.
      await asOwner(client, () =>
        client.query(
          `update public.upload_grants
              set state = 'revoked', closed_at = now(), closed_reason = 'MR-54 BE-W112 fixture'
            where id = $1`,
          [grantId],
        ),
      );

      expect((await auditFor(client, grantId)).map((row) => row.action)).toEqual([
        'insert',
        'update',
      ]);
    });
  });
});

describe.skipIf(!reachable)('BE-W112 — what this does NOT claim', () => {
  it('destruction was already logged, and still is, in its own table', async () => {
    // Stated as a test so the register's claim cannot quietly widen into "audio was
    // unlogged". `audio_destruction_log` predates this work by a month.
    await inRolledBackTransaction(async (client) => {
      const { rows } = await client.query<{ exists: boolean }>(
        `select to_regclass('public.audio_destruction_log') is not null as exists`,
      );
      expect(rows[0]?.exists).toBe(true);
    });
  });
});
