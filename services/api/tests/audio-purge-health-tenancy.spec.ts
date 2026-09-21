import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * MR-46 B3/B4 — `BE-W106`'s proven half: `audio_purge_health()` counted every company's
 * recordings and handed them to any MR.
 *
 * Measured before the fix: an MR of a company with no recordings read `liveObjectCount = 56`,
 * all of them other companies'. `20260921000100` revokes the function from every signed-in
 * role. The per-company view is `retention_status()`.
 *
 * Two-sided, on one recording that belongs to the fixture company and to nothing else:
 *
 * - **refused** — the rival company's MR and admin, and the owning company's own MR and admin.
 *   A tenant admin is refused too, because `admin` is a tenant role (`decisions.md` C1).
 * - **positive control, owning company** — the fixture company's admin still sees the
 *   recording through `retention_status()`, so the revoke did not take the per-company path
 *   with it.
 * - **negative control, rival company** — the rival admin's `retention_status()` does not
 *   count it.
 * - **positive control, operator** — the database owner, which is how the watchdog connects,
 *   still reads the whole-database figure and it includes the recording.
 */
const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
});

const REASON = 'MR-46 B4 — audio_purge_health tenancy';

/** A live recording owned by the fixture company's Pune MR, inserted as the owner. */
const ownedRecording = async (client: Client): Promise<string> => {
  await client.query('reset role');
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
  await client.query(
    `insert into public.recordings
       (id, visit_id, mr_id, consent_record_id, storage_key, bitrate_kbps,
        duration_seconds, size_bytes, recorded_at, upload_status)
     values ($1, $2, $3, $4, $5, 28, 600, 32, now(), 'uploaded')`,
    [
      recordingId,
      visitId,
      world.users.puneMr.id,
      consentId,
      `recordings/${randomUUID()}/${randomUUID()}.opus`,
    ],
  );
  return recordingId;
};

const liveCount = async (client: Client, user: FixtureUser): Promise<number> => {
  await asUser(client, user);
  const { rows } = await client.query<{ status: { liveCount: number } }>(
    'select public.retention_status($1) as status',
    [REASON],
  );
  return Number(rows[0]?.status.liveCount);
};

describe.skipIf(!reachable)('BE-W106 — audio_purge_health() is not for signed-in users', () => {
  it.each([
    ['the rival company’s MR', 'rivalMr'],
    ['the rival company’s admin', 'rivalAdmin'],
    ['the owning company’s MR', 'puneMr'],
    ['the owning company’s admin — admin is a tenant role', 'admin'],
  ] as const)('refuses %s', async (_label, who) => {
    await expect(
      inRolledBackTransaction(async (client) => {
        await asUser(client, world.users[who]);
        return client.query('select public.audio_purge_health()');
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('POSITIVE CONTROL, owning company: its admin still sees its recording through retention_status()', async () => {
    await inRolledBackTransaction(async (client) => {
      const before = await liveCount(client, world.users.admin);
      await ownedRecording(client);
      expect(await liveCount(client, world.users.admin)).toBe(before + 1);
    });
  });

  it('NEGATIVE CONTROL, rival company: its admin’s retention_status() does not count it', async () => {
    await inRolledBackTransaction(async (client) => {
      const before = await liveCount(client, world.users.rivalAdmin);
      await ownedRecording(client);
      expect(await liveCount(client, world.users.rivalAdmin)).toBe(before);
    });
  });

  it('POSITIVE CONTROL, operator: the owner still reads the whole database, recording included', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query('reset role');
      const read = async (): Promise<number> => {
        const { rows } = await client.query<{ h: { liveObjectCount: number } }>(
          'select public.audio_purge_health() as h',
        );
        return Number(rows[0]?.h.liveObjectCount);
      };
      const before = await read();
      await ownedRecording(client);
      expect(await read()).toBe(before + 1);
    });
  });
});
