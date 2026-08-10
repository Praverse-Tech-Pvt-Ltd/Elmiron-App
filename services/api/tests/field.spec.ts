import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * BE-W3 — field operations.
 *
 * Everything here tests something the client is not trusted with: when a capture
 * happened, where it happened, whether it was inside working hours, and how far the
 * MR travelled. Each of those is either an expense claim or an attendance record,
 * so each is computed or validated server-side.
 *
 * Same harness discipline as the Gate 0 suite: every call runs as a real
 * `authenticated` user with real claims, never as `postgres`.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

// Fixed dates, weekday verified against the database rather than assumed:
// 2026-08-12 is a Wednesday, 2026-08-16 is a Sunday.
const WED_1000_IST = '2026-08-12T10:00:00+05:30';
const WED_0300_IST = '2026-08-12T03:00:00+05:30';
const WED_0500_UTC = '2026-08-12T05:00:00Z'; // 10:30 IST
const SUN_1000_IST = '2026-08-16T10:00:00+05:30';

// The Pune clinic fixture sits at 18.5204, 73.8567 with a 150 m geofence.
const CLINIC_LAT = 18.5204;
const CLINIC_LON = 73.8567;
// Roughly 3.3 km north-east of it.
const FAR_LAT = 18.55;
const FAR_LON = 73.87;

interface CheckInRow {
  id: string;
  geofence_status: string;
  distance_from_clinic_metres: number | null;
  occurred_at: string;
  received_at: string;
}

const asUserTx = async <T>(user: FixtureUser, fn: (client: Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await asUser(client, user);
    return fn(client);
  });

const checkIn = async (
  client: Client,
  args: { id?: string; visitId: string; lat: number; lon: number; at: string },
): Promise<CheckInRow> => {
  // `select f()` hands back an opaque composite string; `select * from f()`
  // expands it into real columns.
  const result = await client.query<CheckInRow>(
    'select * from public.record_check_in($1, $2, $3, $4, $5)',
    [args.id ?? randomUUID(), args.visitId, args.lat, args.lon, args.at],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('record_check_in returned nothing');
  return row;
};

// =============================================================================
// Work hours — enforced server-side, in the territory's own timezone
// =============================================================================

describe.skipIf(!reachable)('work-hours enforcement', () => {
  it('accepts a capture inside the configured window', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const row = await checkIn(client, {
        visitId: world.visits.pune,
        lat: CLINIC_LAT,
        lon: CLINIC_LON,
        at: WED_1000_IST,
      });
      expect(row.id).toBeDefined();
    });
  });

  it('rejects a capture before the window opens', async () => {
    await expect(
      asUserTx(world.users.puneMr, (client) =>
        checkIn(client, {
          visitId: world.visits.pune,
          lat: CLINIC_LAT,
          lon: CLINIC_LON,
          at: WED_0300_IST,
        }),
      ),
    ).rejects.toThrow(/outside the configured shift window/);
  });

  it('rejects a capture on a non-working day', async () => {
    await expect(
      asUserTx(world.users.puneMr, (client) =>
        checkIn(client, {
          visitId: world.visits.pune,
          lat: CLINIC_LAT,
          lon: CLINIC_LON,
          at: SUN_1000_IST,
        }),
      ),
    ).rejects.toThrow(/outside the configured shift window/);
  });

  it('evaluates the window in the territory timezone, not UTC', async () => {
    // 05:00 UTC is 10:30 IST — inside a 09:00–19:00 window. If the comparison were
    // done against the UTC clock this would be rejected, so accepting it is the
    // proof that the conversion happens. A five-and-a-half hour error, silently.
    await asUserTx(world.users.puneMr, async (client) => {
      const row = await checkIn(client, {
        visitId: world.visits.pune,
        lat: CLINIC_LAT,
        lon: CLINIC_LON,
        at: WED_0500_UTC,
      });
      expect(row.id).toBeDefined();
    });
  });

  it('inherits the window from the nearest ancestor territory', async () => {
    await inRolledBackTransaction(async (client) => {
      // Pune has no window of its own; National does.
      const result = await client.query<{ start: string; territory_id: string }>(
        `select (public.effective_shift_window($1)).shift_start::text as start,
                (public.effective_shift_window($1)).territory_id as territory_id`,
        [world.territories.pune],
      );
      expect(result.rows[0]?.start).toBe('09:00:00');
      expect(result.rows[0]?.territory_id).toBe(world.territories.national);
    });
  });

  it('prefers a territory own window over an ancestor', async () => {
    await inRolledBackTransaction(async (client) => {
      const result = await client.query<{ start: string; territory_id: string }>(
        `select (public.effective_shift_window($1)).shift_start::text as start,
                (public.effective_shift_window($1)).territory_id as territory_id`,
        [world.territories.nagpur],
      );
      expect(result.rows[0]?.start).toBe('06:00:00');
      expect(result.rows[0]?.territory_id).toBe(world.territories.nagpur);
    });
  });

  it('refuses rather than defaults when no window is configured anywhere', async () => {
    // A missing shift window must be a loud error naming the gap, not a plausible
    // default that quietly accepts captures at 3am.
    await expect(
      inRolledBackTransaction(async (client) => {
        const orphanTerritory = randomUUID();
        await client.query(
          `insert into public.territories (id, name, code, parent_id, organisation_id)
           values ($1, 'Orphan', $2, null, $3)`,
          [orphanTerritory, `ORPH-${world.runId}`, world.organisationId],
        );
        return client.query('select public.is_within_shift($1, now())', [orphanTerritory]);
      }),
    ).rejects.toThrow(/no shift window configured/);
  });
});

// =============================================================================
// Geofence — computed here, never accepted from the request
// =============================================================================

describe.skipIf(!reachable)('geofence is computed server-side', () => {
  it('records inside when the coordinates are at the clinic', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const row = await checkIn(client, {
        visitId: world.visits.pune,
        lat: CLINIC_LAT,
        lon: CLINIC_LON,
        at: WED_1000_IST,
      });
      expect(row.geofence_status).toBe('inside');
      expect(row.distance_from_clinic_metres).toBeLessThan(50);
    });
  });

  it('records outside when the MR is kilometres away, whatever the app believes', async () => {
    // record_check_in takes no geofence argument at all, which is the structural
    // half of this. The computed distance is the measurable half.
    await asUserTx(world.users.puneMr, async (client) => {
      const row = await checkIn(client, {
        visitId: world.visits.pune,
        lat: FAR_LAT,
        lon: FAR_LON,
        at: WED_1000_IST,
      });
      expect(row.geofence_status).toBe('outside');
      expect(row.distance_from_clinic_metres).toBeGreaterThan(2000);
      expect(row.distance_from_clinic_metres).toBeLessThan(5000);
    });
  });

  it('records unavailable when the visit has no clinic address', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const visitId = randomUUID();
      await client.query(
        `insert into public.visits (id, mr_id, doctor_id, status) values ($1, $2, $3, 'in_progress')`,
        [visitId, world.users.puneMr.id, world.doctors.pune],
      );
      const row = await checkIn(client, {
        visitId,
        lat: CLINIC_LAT,
        lon: CLINIC_LON,
        at: WED_1000_IST,
      });
      expect(row.geofence_status).toBe('unavailable');
      expect(row.distance_from_clinic_metres).toBeNull();
    });
  });

  it('computes a known distance to within a metre', async () => {
    await inRolledBackTransaction(async (client) => {
      // One degree of latitude is ~111.19 km on a sphere of radius 6371 km.
      const result = await client.query<{ d: number }>(
        'select public.distance_metres(0, 0, 1, 0) as d',
      );
      expect(result.rows[0]?.d).toBeGreaterThan(111_100);
      expect(result.rows[0]?.d).toBeLessThan(111_300);
    });
  });
});

// =============================================================================
// received_at — stamped by the server, unwritable by anyone
// =============================================================================

describe.skipIf(!reachable)('received_at', () => {
  it('is stamped on capture and is close to now, not to occurred_at', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const row = await checkIn(client, {
        visitId: world.visits.pune,
        lat: CLINIC_LAT,
        lon: CLINIC_LON,
        at: WED_1000_IST,
      });
      const skewMs = Math.abs(Date.now() - new Date(row.received_at).getTime());
      expect(skewMs).toBeLessThan(60_000);
      expect(new Date(row.occurred_at).toISOString()).toBe(new Date(WED_1000_IST).toISOString());
    });
  });

  it('discards a supplied value even from the table owner', async () => {
    // The column has a default, and a default is not enforcement — anything that can
    // INSERT can override it. The trigger is what makes it unwritable.
    await inRolledBackTransaction(async (client) => {
      const id = randomUUID();
      await client.query(
        `insert into public.check_ins
           (id, visit_id, mr_id, latitude, longitude, geofence_status, source, occurred_at, received_at)
         values ($1, $2, $3, 18.5, 73.8, 'inside', 'manual', $4, '2001-01-01T00:00:00Z')`,
        [id, world.visits.pune, world.users.puneMr.id, WED_1000_IST],
      );
      const result = await client.query<{ received_at: string }>(
        'select received_at from public.check_ins where id = $1',
        [id],
      );
      expect(new Date(result.rows[0]?.received_at ?? 0).getUTCFullYear()).toBeGreaterThan(2020);
    });
  });

  it('exists on every table that accepts a client-originated row', async () => {
    await inRolledBackTransaction(async (client) => {
      const result = await client.query<{ table_name: string }>(
        `select t.table_name
           from information_schema.tables t
          where t.table_schema = 'public'
            and t.table_name in ('visits','check_ins','check_outs','call_reports',
                                 'samples_and_inputs','consent_records')
            and not exists (
              select 1 from information_schema.columns c
               where c.table_schema = 'public' and c.table_name = t.table_name
                 and c.column_name = 'received_at')`,
      );
      expect(result.rows.map((r) => r.table_name)).toEqual([]);
    });
  });
});

// =============================================================================
// Idempotency and the closed direct-insert path
// =============================================================================

describe.skipIf(!reachable)('idempotency', () => {
  it('returns the existing row on a retry with the same id', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const id = randomUUID();
      const first = await checkIn(client, {
        id,
        visitId: world.visits.pune,
        lat: CLINIC_LAT,
        lon: CLINIC_LON,
        at: WED_1000_IST,
      });
      const second = await checkIn(client, {
        id,
        visitId: world.visits.pune,
        lat: FAR_LAT,
        lon: FAR_LON,
        at: WED_1000_IST,
      });

      expect(second.id).toBe(first.id);
      // The retry did not overwrite the original with its own coordinates.
      expect(second.geofence_status).toBe(first.geofence_status);

      const count = await client.query<{ count: string }>(
        'select count(*) as count from public.check_ins where id = $1',
        [id],
      );
      expect(Number(count.rows[0]?.count)).toBe(1);
    });
  });

  it('does not let a retry outside working hours succeed by replaying an id', async () => {
    // The idempotency check runs before the work-hours check on purpose: a retry of
    // something that was accepted at 10:00 must not be refused because the phone
    // finally got signal at 23:00.
    await asUserTx(world.users.puneMr, async (client) => {
      const id = randomUUID();
      await checkIn(client, {
        id,
        visitId: world.visits.pune,
        lat: CLINIC_LAT,
        lon: CLINIC_LON,
        at: WED_1000_IST,
      });
      const replay = await checkIn(client, {
        id,
        visitId: world.visits.pune,
        lat: CLINIC_LAT,
        lon: CLINIC_LON,
        at: WED_0300_IST,
      });
      expect(new Date(replay.occurred_at).toISOString()).toBe(new Date(WED_1000_IST).toISOString());
    });
  });

  it('refuses to replay another user check-in id', async () => {
    await inRolledBackTransaction(async (client) => {
      const id = randomUUID();
      // Seeded as the owner, before the role switch — `authenticated` has no INSERT
      // grant on check_ins any more, which is the previous test.
      await client.query(
        `insert into public.check_ins
           (id, visit_id, mr_id, latitude, longitude, geofence_status, source, occurred_at)
         values ($1, $2, $3, 12.97, 77.59, 'inside', 'manual', $4)`,
        [id, world.visits.south, world.users.southMr.id, WED_1000_IST],
      );
      await asUser(client, world.users.puneMr);
      await expect(
        checkIn(client, {
          id,
          visitId: world.visits.pune,
          lat: CLINIC_LAT,
          lon: CLINIC_LON,
          at: WED_1000_IST,
        }),
      ).rejects.toThrow(/belongs to another user/);
    });
  });

  it('refuses a check-in against another MR visit', async () => {
    await expect(
      asUserTx(world.users.puneMr, (client) =>
        checkIn(client, {
          visitId: world.visits.south,
          lat: CLINIC_LAT,
          lon: CLINIC_LON,
          at: WED_1000_IST,
        }),
      ),
    ).rejects.toThrow(/is not yours/);
  });

  it('closes the direct INSERT path so capture cannot skip the checks', async () => {
    // If an MR could INSERT into check_ins directly, work hours and the geofence
    // would both be optional. The grant and the policy are both gone.
    await expect(
      asUserTx(world.users.puneMr, (client) =>
        client.query(
          `insert into public.check_ins
             (id, visit_id, mr_id, latitude, longitude, geofence_status, source, occurred_at)
           values (gen_random_uuid(), $1, $2, 18.5, 73.8, 'inside', 'manual', now())`,
          [world.visits.pune, world.users.puneMr.id],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

// =============================================================================
// Check-out duration
// =============================================================================

describe.skipIf(!reachable)('check-out', () => {
  it('computes duration from the visit earliest check-in', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const visitId = randomUUID();
      await client.query(
        `insert into public.visits (id, mr_id, doctor_id, clinic_address_id, status)
         values ($1, $2, $3, $4, 'in_progress')`,
        [visitId, world.users.puneMr.id, world.doctors.pune, world.clinicAddresses.pune],
      );
      await checkIn(client, {
        visitId,
        lat: CLINIC_LAT,
        lon: CLINIC_LON,
        at: '2026-08-12T10:00:00+05:30',
      });
      const result = await client.query<{ duration_seconds: number }>(
        'select * from public.record_check_out($1, $2, $3, $4, $5)',
        [randomUUID(), visitId, CLINIC_LAT, CLINIC_LON, '2026-08-12T10:25:00+05:30'],
      );
      expect(result.rows[0]?.duration_seconds).toBe(25 * 60);
    });
  });

  it('leaves duration null when no check-in has arrived yet', async () => {
    // Out-of-order arrival is normal. A check-out that lands first is not an error.
    await asUserTx(world.users.puneMr, async (client) => {
      const visitId = randomUUID();
      await client.query(
        `insert into public.visits (id, mr_id, doctor_id, clinic_address_id, status)
         values ($1, $2, $3, $4, 'in_progress')`,
        [visitId, world.users.puneMr.id, world.doctors.pune, world.clinicAddresses.pune],
      );
      const result = await client.query<{ duration_seconds: number | null }>(
        'select * from public.record_check_out($1, $2, $3, $4, $5)',
        [randomUUID(), visitId, CLINIC_LAT, CLINIC_LON, WED_1000_IST],
      );
      expect(result.rows[0]?.duration_seconds).toBeNull();
    });
  });
});

// =============================================================================
// Mileage
// =============================================================================

interface MileageRow {
  mr_id: string;
  travel_date: string;
  check_in_count: number;
  distance_metres: number;
}

/** Three points roughly 1 km apart along a line, visited in that order. */
const LEG_POINTS: Array<[number, number]> = [
  [18.52, 73.85],
  [18.529, 73.85],
  [18.538, 73.85],
];

const seedDay = async (client: Client, order: number[]): Promise<void> => {
  for (const index of order) {
    const point = LEG_POINTS[index];
    if (point === undefined) continue;
    const visitId = randomUUID();
    await client.query(
      `insert into public.visits (id, mr_id, doctor_id, clinic_address_id, status)
       values ($1, $2, $3, $4, 'completed')`,
      [visitId, world.users.puneMr.id, world.doctors.pune, world.clinicAddresses.pune],
    );
    await checkIn(client, {
      visitId,
      lat: point[0],
      lon: point[1],
      at: `2026-08-12T1${String(index)}:00:00+05:30`,
    });
  }
};

const mileageFor = async (client: Client, mrId: string): Promise<MileageRow[]> => {
  const result = await client.query<MileageRow>(
    `select * from public.daily_mileage('2026-08-12', '2026-08-12', $1)`,
    [mrId],
  );
  return result.rows;
};

describe.skipIf(!reachable)('mileage', () => {
  it('sums the distance between consecutive check-ins', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      await seedDay(client, [0, 1, 2]);
      const rows = await mileageFor(client, world.users.puneMr.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.check_in_count).toBe(3);
      // Two legs of ~1 km each.
      expect(Number(rows[0]?.distance_metres)).toBeGreaterThan(1800);
      expect(Number(rows[0]?.distance_metres)).toBeLessThan(2200);
    });
  });

  it('gives the same total when the day arrives out of order', async () => {
    // This is the whole point of ordering by occurred_at rather than by arrival. A
    // day that synced backwards would otherwise produce a different expense claim.
    const inOrder = await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      await seedDay(client, [0, 1, 2]);
      return mileageFor(client, world.users.puneMr.id);
    });
    const reversed = await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      await seedDay(client, [2, 0, 1]);
      return mileageFor(client, world.users.puneMr.id);
    });

    expect(Number(reversed[0]?.distance_metres)).toBeCloseTo(
      Number(inOrder[0]?.distance_metres),
      2,
    );
  });

  it('reports zero for a single check-in rather than failing', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      await seedDay(client, [1]);
      const rows = await mileageFor(client, world.users.puneMr.id);
      expect(rows[0]?.check_in_count).toBe(1);
      expect(Number(rows[0]?.distance_metres)).toBe(0);
    });
  });

  it('is visible to the MR themselves', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      await seedDay(client, [0, 1]);
      const rows = await mileageFor(client, world.users.puneMr.id);
      expect(rows).toHaveLength(1);
    });
  });

  it('is visible to their manager', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      await seedDay(client, [0, 1]);
      await client.query('reset role');
      await asUser(client, world.users.westManager);
      const rows = await mileageFor(client, world.users.puneMr.id);
      expect(rows).toHaveLength(1);
    });
  });

  it('is not visible to a manager outside the team', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      await seedDay(client, [0, 1]);
      await client.query('reset role');
      await asUser(client, world.users.southManager);
      const rows = await mileageFor(client, world.users.puneMr.id);
      expect(rows).toEqual([]);
    });
  });
});

// =============================================================================
// Doctor search
// =============================================================================

describe.skipIf(!reachable)('doctor search', () => {
  it('finds a doctor by partial name', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const result = await client.query<{ id: string }>(
        'select id from public.search_doctors($1)',
        ['Pune Fix'],
      );
      expect(result.rows.map((r) => r.id)).toContain(world.doctors.pune);
    });
  });

  it('finds a doctor by specialty', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const result = await client.query<{ id: string }>(
        'select id from public.search_doctors($1)',
        ['Urol'],
      );
      expect(result.rows.map((r) => r.id)).toContain(world.doctors.pune);
    });
  });

  it('never returns a doctor outside the caller territory', async () => {
    // The function is SECURITY INVOKER, so the doctors policy is the scope filter.
    // A search that could widen scope would be a hole with a convenient name.
    await asUserTx(world.users.puneMr, async (client) => {
      const result = await client.query<{ id: string }>(
        'select id from public.search_doctors($1)',
        ['Fixture'],
      );
      const ids = result.rows.map((r) => r.id);
      expect(ids).toContain(world.doctors.pune);
      expect(ids).not.toContain(world.doctors.south);
    });
  });

  it('uses the trigram index rather than a sequential scan', async () => {
    // An MR in a waiting room has three seconds. Asserting the plan rather than the
    // wall clock keeps this honest on a two-row fixture table.
    await inRolledBackTransaction(async (client) => {
      await client.query('set local enable_seqscan = off');
      const plan = await client.query<{ 'QUERY PLAN': string }>(
        `explain select id from public.doctors where full_name ilike '%Fixture%'`,
      );
      const text = plan.rows.map((r) => r['QUERY PLAN']).join('\n');
      expect(text).toMatch(/doctors_full_name_trgm_idx/);
    });
  });
});
