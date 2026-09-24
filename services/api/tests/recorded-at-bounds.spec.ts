import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { API_URL, SERVICE_ROLE_KEY, asOwner, asUser } from './auth.js';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * MR-54 `BE-W96` — `recorded_at` is the device's word, and it is bounded in both directions.
 *
 * `capture_consent` has refused a future `captured_at` since FIX-12 and one older than
 * `consent_max_sync_lag_hours` since the same change. `complete_upload.p_recorded_at` had
 * neither, so a finalised upload could claim any date at all — and `recorded_at` is what a
 * coaching queue orders by and what a later citation of a consultation points at.
 *
 * **Both bounds are tested against real Storage**, because `complete_upload` refuses to
 * finalise an upload whose bytes were never stored (MR-37 B2). A test that skipped the PUT
 * would be refused for that reason instead and would prove nothing about the clock.
 *
 * No PHI: the synthetic audio is thirty-two zero bytes.
 */
const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

const SYNTHETIC_AUDIO = new Uint8Array(32);

const asUserTx = async <T>(user: FixtureUser, fn: (client: Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await asUser(client, user);
    return fn(client);
  });

/** Put the bytes where the grant says, as the service role — the storage policy is not what is under test here. */
const uploadAsService = async (storageKey: string): Promise<void> => {
  const response = await fetch(`${API_URL}/storage/v1/object/audio/${storageKey}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'audio/mp4',
    },
    body: SYNTHETIC_AUDIO,
  });
  if (!response.ok) throw new Error(`storage upload failed: ${String(response.status)}`);
};

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

interface Refusal {
  code?: string;
  message?: string;
  detail?: string;
  hint?: string;
}

/** Begin, store the bytes, then finalise with the `recorded_at` under test. */
const finaliseWith = async (client: Client, recordedAt: string): Promise<Refusal | 'accepted'> => {
  const visitId = await consentedVisit(client);
  const grant = await client.query<{ id: string; storage_key: string }>(
    'select * from public.begin_upload($1, $2, $3, $4)',
    [visitId, 'recording', SYNTHETIC_AUDIO.length, 240],
  );
  const row = grant.rows[0];
  if (row === undefined) throw new Error('begin_upload returned nothing');
  await uploadAsService(row.storage_key);

  return client
    .query('select public.complete_upload($1, $2, $3, $4, $5, $6)', [
      row.id,
      randomUUID(),
      60,
      SYNTHETIC_AUDIO.length,
      recordedAt,
      128,
    ])
    .then(() => 'accepted' as const)
    .catch((error: unknown) => error as Refusal);
};

const minutesFromNow = (minutes: number): string =>
  new Date(Date.now() + minutes * 60_000).toISOString();

describe.skipIf(!reachable)('BE-W96 — a recording cannot be made in the future', () => {
  it('refuses with 45009, and says so with figures rather than a bare code', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const refusal = await finaliseWith(client, minutesFromNow(60));
      expect(refusal).not.toBe('accepted');
      const error = refusal as Refusal;
      // 45009 and NOT 45007: the client turns a SQLSTATE straight into a sentence, and
      // 45007's sentence is about a CONSENT.
      expect(error.code).toBe('45009');
      expect(error.message).toMatch(/cannot be recorded in the future/u);
      expect(error.detail).toMatch(/after the server clock/u);
      // The remedy is the phone, and it does not blame the recording.
      expect(error.hint).toMatch(/device clock/iu);
    });
  });

  it('POSITIVE CONTROL: an ordinary recording from a moment ago is accepted', async () => {
    // Without this the test above would pass against a function that refused everything.
    await asUserTx(world.users.puneMr, async (client) => {
      expect(await finaliseWith(client, minutesFromNow(-1))).toBe('accepted');
    });
  });

  it('tolerates the forward skew a slightly fast handset produces', async () => {
    // MR-05 B1's whole argument, inherited: the client stamps this from the DEVICE clock,
    // and the handsets this product targets are the ones whose power managers kill the
    // background sync that keeps a clock right. A few seconds fast is a phone, not an
    // attack, and must not refuse the recording.
    await asUserTx(world.users.puneMr, async (client) => {
      const tolerance = await client.query<{ seconds: string | null }>(
        `select public.threshold_number('consent_future_tolerance_seconds') as seconds`,
      );
      // The bound is read from the same row the function reads, not hard-coded here: if the
      // operator ratifies a different number this test follows it instead of going red.
      const seconds = Number(tolerance.rows[0]?.seconds ?? 0);
      expect(seconds, 'the tolerance row must exist, or this test proves nothing').toBeGreaterThan(
        0,
      );
      const insideTheWindow = new Date(Date.now() + (seconds / 2) * 1000).toISOString();
      expect(await finaliseWith(client, insideTheWindow)).toBe('accepted');
    });
  });
});

describe.skipIf(!reachable)('BE-W96 — a recording too old for the device’s word', () => {
  it('refuses with 45010, naming the age and the maximum', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const maxLag = await client.query<{ hours: string | null }>(
        `select public.threshold_number('consent_max_sync_lag_hours') as hours`,
      );
      const hours = Number(maxLag.rows[0]?.hours ?? 0);
      expect(hours, 'the sync-lag row must exist, or this test proves nothing').toBeGreaterThan(0);

      const refusal = await finaliseWith(client, minutesFromNow(-(hours + 1) * 60));
      expect(refusal).not.toBe('accepted');
      const error = refusal as Refusal;
      expect(error.code).toBe('45010');
      expect(error.message).toMatch(/older than the server will accept/u);
      expect(error.detail).toMatch(/the maximum is \d+ hours/u);
      // The hint must SAY that waiting will not help -- an earlier draft of this assertion
      // banned the word "wait" and failed on a hint whose whole point is "waiting will not
      // make this acceptable". Assert the meaning, not a substring.
      expect(error.hint).toMatch(/will not become acceptable/u);
      expect(error.hint).toMatch(/sync sooner/iu);
    });
  });

  it('POSITIVE CONTROL: a recording queued offline overnight is still accepted', async () => {
    // The bound must not refuse the case the product promises. `consent_max_sync_lag_hours`
    // is 72h precisely so a full offline day can never be refused by it, and MR-54 A3 proved
    // on the emulator that recordings do queue and upload later.
    await asUserTx(world.users.puneMr, async (client) => {
      expect(await finaliseWith(client, minutesFromNow(-16 * 60))).toBe('accepted');
    });
  });
});

describe.skipIf(!reachable)('BE-W96 — the codes reach the client contract', () => {
  it('both are raised by complete_upload, which is what error-contract.spec.ts derives from', async () => {
    await inRolledBackTransaction(async (client) => {
      const { rows } = await client.query<{ prosrc: string }>(
        `select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'complete_upload'`,
      );
      const source = rows[0]?.prosrc ?? '';
      expect(source).toContain('45009');
      expect(source).toContain('45010');
      // And the rule this replacement inherited is still there -- a `create or replace` that
      // restored an older body would otherwise pass every test above.
      expect(source, 'MR-37 B2: the size must still be the one Storage observed').toContain(
        'metadata',
      );
    });
  });
});
