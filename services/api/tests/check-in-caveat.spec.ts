import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { knownSyncWarnings } from '@fieldforce/core';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * W2-B A / `BE-W147` — the rep is TOLD when the clinic could not be confirmed (`BE-C5`, `BE-C2`).
 *
 * Driven through `sync_push`, the path the phone uses, rather than `record_check_in` directly: the
 * warnings are a fact of the PUSH verdict, and `approximate-check-in.spec.ts` already owns the row.
 *
 * **Two-sided on purpose.** The ordinary check-in — at the clinic, a tight fix — must carry NO
 * warning. A test suite that only asserts the warning appears passes against a function that warns
 * on every check-in, which would teach every rep to ignore the line on day one.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;
let clinic: { latitude: number; longitude: number };

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
  await inRolledBackTransaction(async (db) => {
    const { rows } = await db.query<{ latitude: number; longitude: number }>(
      `select a.latitude, a.longitude from public.clinic_addresses a
         join public.visits v on v.clinic_address_id = a.id where v.id = $1`,
      [world.visits.pune],
    );
    const found = rows[0];
    if (found === undefined) throw new Error('the fixture Pune visit has no clinic address');
    clinic = found;
  });
}, 120_000);

interface Verdict {
  id: string;
  status: string;
  warnings: string[];
}

/** One check-in, pushed as the Pune rep. `away` moves it ~111 km north; `accuracy` is the fix's. */
const push = async (
  db: Client,
  opts: { away: boolean; accuracy: number | null; itemId?: string; rowId?: string },
): Promise<Verdict> => {
  const rowId = opts.rowId ?? randomUUID();
  const item = {
    id: opts.itemId ?? randomUUID(),
    entity: 'check_in',
    operation: 'create',
    entityId: world.visits.pune,
    clientCreatedAt: '2026-09-10T10:00:00+05:30',
    payload: {
      id: rowId,
      visitId: world.visits.pune,
      coordinates: {
        latitude: opts.away ? clinic.latitude + 1 : clinic.latitude,
        longitude: clinic.longitude,
        accuracyMetres: opts.accuracy,
      },
      occurredAt: '2026-09-10T10:00:00+05:30',
      source: 'manual',
    },
  };
  await asUser(db, world.users.puneMr);
  const { rows } = await db.query<{ result: { results: Verdict[] } }>(
    'select public.sync_push($1, $2::jsonb) as result',
    [randomUUID(), JSON.stringify([item])],
  );
  await db.query('reset role');
  const verdict = rows[0]?.result.results[0];
  if (verdict === undefined) throw new Error('sync_push returned no verdict');
  return verdict;
};

describe.skipIf(!reachable)(
  'W2-B A — BE-C5: a check-in the clinic could not confirm says so',
  () => {
    it('an ORDINARY check-in — at the clinic, a tight fix — carries NO warning', async () => {
      await inRolledBackTransaction(async (db) => {
        const verdict = await push(db, { away: false, accuracy: 8 });
        expect(verdict.status).toBe('accepted');
        expect(verdict.warnings).toEqual([]);
      });
    });

    it('a check-in with NO accuracy reported carries no warning — null is "not assessed", never "approximate"', async () => {
      await inRolledBackTransaction(async (db) => {
        const verdict = await push(db, { away: false, accuracy: null });
        expect(verdict.warnings).toEqual([]);
      });
    });

    it('an off-site check-in is ACCEPTED and warned outside — never refused (BE-C5)', async () => {
      await inRolledBackTransaction(async (db) => {
        const verdict = await push(db, { away: true, accuracy: 8 });
        expect(verdict.status, 'BE-C5: recorded and flagged, never refused').toBe('accepted');
        expect(verdict.warnings).toEqual(['check_in_outside_geofence']);
      });
    });

    it('a coarse fix at the clinic is warned approximate, and not outside (BE-C2: not a second verdict)', async () => {
      await inRolledBackTransaction(async (db) => {
        const verdict = await push(db, { away: false, accuracy: 5000 });
        expect(verdict.status).toBe('accepted');
        expect(verdict.warnings).toEqual(['check_in_location_approximate']);
      });
    });

    it('off-site AND coarse carries both facts, so the client can choose which to say', async () => {
      await inRolledBackTransaction(async (db) => {
        const verdict = await push(db, { away: true, accuracy: 5000 });
        expect(verdict.warnings).toEqual([
          'check_in_outside_geofence',
          'check_in_location_approximate',
        ]);
      });
    });

    it('CONTRACT: every warning the server sends is one the app knows — or the app drops it silently', async () => {
      // `knownSyncWarnings` filters unknown strings by design (a newer server must not break an older
      // app). The price is that a RENAME on either side makes the line disappear with nothing red. This
      // is the red: the server's spelling, checked against the client's list.
      await inRolledBackTransaction(async (db) => {
        const verdict = await push(db, { away: true, accuracy: 5000 });
        expect(verdict.warnings.length).toBe(2);
        expect(knownSyncWarnings(verdict.warnings)).toEqual(verdict.warnings);
      });
    });

    it('a clinic with NO location (`unavailable`) carries no warning — not a fact about the rep', async () => {
      // Added after mutant M5 (warn on anything but `inside`) SURVIVED: nothing exercised a visit the
      // geofence could not judge. `BE-C5` rules on an OFF-SITE check-in; a clinic the company never
      // located says nothing about where the rep stood.
      await inRolledBackTransaction(async (db) => {
        await db.query('update public.visits set clinic_address_id = null where id = $1', [
          world.visits.pune,
        ]);
        const verdict = await push(db, { away: true, accuracy: 8 });
        expect(verdict.status).toBe('accepted');
        expect(verdict.warnings).toEqual([]);
        // The positive control: the case really was `unavailable`, or the line above proves nothing.
        const { rows } = await db.query<{ geofence_status: string }>(
          'select geofence_status from public.check_ins where visit_id = $1 order by created_at desc limit 1',
          [world.visits.pune],
        );
        expect(rows[0]?.geofence_status).toBe('unavailable');
      });
    });

    it('a REPLAYED item — the phone that never heard the answer — gets the same warning back', async () => {
      // The queued-offline case: the first push landed and its answer was lost, so the phone sends the
      // same item again. `sync_push` answers `duplicate` from `sync_items`; the warning must survive
      // that, or a rep whose signal dropped at the clinic door is the one rep never told.
      await inRolledBackTransaction(async (db) => {
        const itemId = randomUUID();
        const rowId = randomUUID();
        const first = await push(db, { away: true, accuracy: 8, itemId, rowId });
        const again = await push(db, { away: true, accuracy: 8, itemId, rowId });
        expect(first.status).toBe('accepted');
        expect(again.status).toBe('duplicate');
        expect(again.warnings).toEqual(['check_in_outside_geofence']);
      });
    });
  },
);
