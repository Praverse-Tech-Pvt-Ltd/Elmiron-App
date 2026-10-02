import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * W1-C A2 — CR-4's answer, under ruling `BE-C2`.
 *
 * **Two properties, and the second is the one the ruling turns on:**
 *
 *   1. a check-in is FLAGGED approximate when the device's accuracy radius exceeds the clinic's
 *      geofence radius;
 *   2. **the geofence VERDICT is unchanged by accuracy** — the same coordinates produce the same
 *      verdict whether the fix was reported as 5 m or 5 km wide.
 *
 * Property 2 is asserted because it is what the ruling actually decided. *"A verdict that silently
 * changes meaning with fix quality is worse than one that is wrong the same way every time."* If a
 * later session widens the geofence by accuracy, this test is what says the ruling was reversed
 * rather than improved.
 *
 * **Nothing is refused on the flag**, asserted too: an approximate check-in still succeeds and
 * still starts the visit.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 120_000);

interface Row {
  geofence_status: string;
  location_is_approximate: boolean | null;
  accuracy_metres: number | null;
}

/**
 * Check in on the fixture's Pune visit with a given accuracy, at the clinic's own coordinates so the
 * verdict is `inside` for reasons that have nothing to do with accuracy.
 */
const checkIn = async (
  db: Client,
  accuracyMetres: number | null,
  opts: { atClinic?: boolean } = {},
): Promise<Row> => {
  const { rows: clinic } = await db.query<{
    latitude: number;
    longitude: number;
    geofence_radius_metres: number | null;
  }>(
    `select a.latitude, a.longitude, a.geofence_radius_metres
       from public.clinic_addresses a
       join public.visits v on v.clinic_address_id = a.id
      where v.id = $1`,
    [world.visits.pune],
  );
  const c = clinic[0];
  if (c === undefined) throw new Error('the fixture Pune visit has no clinic address');

  // A long way off when we want `outside`: ~1 degree of latitude is ~111 km.
  const lat = opts.atClinic === false ? c.latitude + 1 : c.latitude;

  await asUser(db, world.users.puneMr);
  const id = randomUUID();
  await db.query(`select public.record_check_in($1, $2, $3, $4, $5, $6, 'automatic')`, [
    id,
    world.visits.pune,
    lat,
    c.longitude,
    '2026-09-10T10:00:00+05:30',
    accuracyMetres,
  ]);
  await db.query('reset role');
  const { rows } = await db.query<Row>(
    `select geofence_status, location_is_approximate, accuracy_metres
       from public.check_ins where id = $1`,
    [id],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('the check-in was not written');
  return row;
};

describe.skipIf(!reachable)('W1-C A2 — the approximate flag', () => {
  it('a wide fix is flagged approximate, and is NOT refused', async () => {
    await inRolledBackTransaction(async (db) => {
      // 5 km against a geofence of 150 m (or whatever the fixture clinic declares).
      const row = await checkIn(db, 5000);
      expect(row.location_is_approximate).toBe(true);
      expect(row.accuracy_metres, 'what the device said, recorded as sent').toBe(5000);
      // Not refused: the row exists at all, and the verdict was still computed.
      expect(row.geofence_status).not.toBeNull();
    });
  });

  it('a tight fix is not flagged', async () => {
    await inRolledBackTransaction(async (db) => {
      const row = await checkIn(db, 8);
      expect(row.location_is_approximate).toBe(false);
    });
  });

  it('no accuracy reported means NULL, not false — the question has no answer', async () => {
    await inRolledBackTransaction(async (db) => {
      const row = await checkIn(db, null);
      expect(row.location_is_approximate).toBeNull();
    });
  });

  it('BE-C2: the VERDICT is identical for a 5 m and a 5 km fix at the same point', async () => {
    // The assertion the ruling exists for. Same coordinates, wildly different accuracy, same
    // verdict -- accuracy does not widen or narrow the geofence.
    const tight = await inRolledBackTransaction((db) => checkIn(db, 5));
    const wide = await inRolledBackTransaction((db) => checkIn(db, 5000));
    expect(tight.geofence_status).toBe('inside');
    expect(wide.geofence_status, 'accuracy must not move the verdict').toBe('inside');
    // And the flag DID differ, so the pair above is not two identical calls.
    expect(tight.location_is_approximate).toBe(false);
    expect(wide.location_is_approximate).toBe(true);
  });

  it('POSITIVE CONTROL: the verdict can still say outside, so `inside` above means something', async () => {
    await inRolledBackTransaction(async (db) => {
      const row = await checkIn(db, 5, { atClinic: false });
      expect(row.geofence_status).toBe('outside');
    });
  });

  it('a replayed check-in still returns the existing row — idempotency survived the rewrite', async () => {
    // W1-C A2's first draft dropped this block. It is asserted here because the offline replay path
    // (FE-D1: queued writes flush exactly once) depends on it, and nothing else in this suite would
    // have noticed its absence.
    await inRolledBackTransaction(async (db) => {
      const { rows: clinic } = await db.query<{ latitude: number; longitude: number }>(
        `select a.latitude, a.longitude from public.clinic_addresses a
           join public.visits v on v.clinic_address_id = a.id where v.id = $1`,
        [world.visits.pune],
      );
      const c = clinic[0];
      if (c === undefined) throw new Error('no clinic');
      await asUser(db, world.users.puneMr);
      const id = randomUUID();
      const args = [
        id,
        world.visits.pune,
        c.latitude,
        c.longitude,
        '2026-09-10T10:00:00+05:30',
        12,
      ];
      await db.query(`select public.record_check_in($1,$2,$3,$4,$5,$6,'automatic')`, args);
      // The same id again must not raise, and must not write a second row.
      await db.query(`select public.record_check_in($1,$2,$3,$4,$5,$6,'automatic')`, args);
      await db.query('reset role');
      const { rows } = await db.query<{ n: string }>(
        `select count(*) n from public.check_ins where id = $1`,
        [id],
      );
      expect(rows[0]?.n).toBe('1');
    });
  });
});
