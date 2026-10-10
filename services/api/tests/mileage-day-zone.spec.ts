import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asOwner, asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * `BE-W174` (`20261009000400_mileage_day_zone`) — a check-in's mileage day is the SAME working day
 * the rest of the field day gives it.
 *
 * Every case checks in through `record_check_in`, then asks two questions of the same event: which
 * day `daily_mileage` counts it on, and which day `visit_day()` -- the rule the phone's Today and the
 * manager's coverage use -- puts its visit on. They must agree, and be the expected date.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

/** Every window of the fixture company: all day, every day, in one zone. */
const zoneEverywhere = async (client: Client, timezone: string): Promise<void> => {
  await asOwner(client, async () => {
    await client.query(
      `update public.territory_shift_windows w
          set shift_start = '00:00', shift_end = '23:59', grace_minutes = 60,
              active_weekdays = '{1,2,3,4,5,6,7}', timezone = $2
         from public.territories t
        where t.id = w.territory_id and t.organisation_id = $1`,
      [world.organisationId, timezone],
    );
  });
};

/** One check-in, on its own new visit, as the Pune rep. Returns the visit. */
const checkIn = async (client: Client, occurredAt: string): Promise<string> => {
  await asUser(client, world.users.puneMr);
  const visitId = randomUUID();
  await client.query(
    `insert into public.visits (id, mr_id, doctor_id, clinic_address_id, origin, unplanned_reason)
     values ($1, $2, $3, $4, 'unplanned', 'mileage day test')`,
    [visitId, world.users.puneMr.id, world.doctors.pune, world.clinicAddresses.pune],
  );
  await client.query('select public.record_check_in($1, $2, 18.5204, 73.8567, $3::timestamptz)', [
    randomUUID(),
    visitId,
    occurredAt,
  ]);
  return visitId;
};

/** `daily_mileage`'s count per day for the Pune rep, as the rep reads it. Wide enough for every case. */
const mileageCounts = async (client: Client): Promise<Map<string, number>> => {
  await asUser(client, world.users.puneMr);
  const rows = await client.query<{ d: string; n: number }>(
    `select travel_date::text as d, check_in_count as n
       from public.daily_mileage('2026-01-01', '2026-12-31', $1)`,
    [world.users.puneMr.id],
  );
  return new Map(rows.rows.map((r) => [r.d, r.n]));
};

/**
 * Check in once, and OBSERVE where mileage counted it: the one day whose count rose by one. Nothing
 * here recomputes a day by the rule under test -- that would make the assertion circular.
 */
const expectDay = async (client: Client, occurredAt: string, expected: string): Promise<string> => {
  const before = await mileageCounts(client);
  const visitId = await checkIn(client, occurredAt);
  const after = await mileageCounts(client);
  const counted = [...after].filter(([d, n]) => n !== (before.get(d) ?? 0)).map(([d]) => d);
  const visitDay = await asOwner(client, async () =>
    client.query<{ d: string }>(
      'select public.visit_day(v)::text as d from public.visits v where v.id = $1',
      [visitId],
    ),
  );
  expect(visitDay.rows[0]?.d, `visit_day of ${occurredAt}`).toBe(expected);
  expect(counted, `mileage day of ${occurredAt}`).toEqual([expected]);
  return visitId;
};

describe.skipIf(!reachable)('BE-W174 — mileage and the visit agree on the working day', () => {
  it('the device’s own offset does not matter: one instant, two spellings, one day', async () => {
    await inRolledBackTransaction(async (client) => {
      await zoneEverywhere(client, 'Asia/Kolkata');
      await expectDay(client, '2026-08-12T23:30:00+05:30', '2026-08-12');
      await expectDay(client, '2026-08-12T18:00:00Z', '2026-08-12');
    });
  });

  it('23:59 and 00:00 in the territory zone are two days', async () => {
    await inRolledBackTransaction(async (client) => {
      await zoneEverywhere(client, 'Asia/Kolkata');
      await expectDay(client, '2026-08-12T23:59:00+05:30', '2026-08-12');
      await expectDay(client, '2026-08-13T00:00:00+05:30', '2026-08-13');
    });
  });

  it('the UTC date is not the working date: 18:31Z is already tomorrow in India', async () => {
    await inRolledBackTransaction(async (client) => {
      await zoneEverywhere(client, 'Asia/Kolkata');
      await expectDay(client, '2026-08-12T18:29:00Z', '2026-08-12');
      await expectDay(client, '2026-08-12T18:31:00Z', '2026-08-13');
    });
  });

  it('a check-in made at 23:50 and synced after midnight (here: months later) keeps its own day', async () => {
    await inRolledBackTransaction(async (client) => {
      await zoneEverywhere(client, 'Asia/Kolkata');
      await expectDay(client, '2026-08-12T23:50:00+05:30', '2026-08-12');
    });
  });

  it('a DST zone: both sides of the spring change, and midnight after it', async () => {
    await inRolledBackTransaction(async (client) => {
      await zoneEverywhere(client, 'America/New_York');
      await expectDay(client, '2026-03-08T06:59:00Z', '2026-03-08'); // 01:59 EST
      await expectDay(client, '2026-03-09T03:59:00Z', '2026-03-08'); // 23:59 EDT
      await expectDay(client, '2026-03-09T04:01:00Z', '2026-03-09'); // 00:01 EDT
    });
  });

  it('the DOCTOR’s territory is not the clock: a doctor moved to a New York territory changes nothing', async () => {
    await inRolledBackTransaction(async (client) => {
      await zoneEverywhere(client, 'Asia/Kolkata');
      // 02:00 IST on the 13th is 16:30 on the 12th in New York -- the old rule's answer.
      const visitId = await expectDay(client, '2026-08-13T02:00:00+05:30', '2026-08-13');
      const before = await mileageCounts(client);
      await asOwner(client, async () => {
        await client.query(
          `update public.territory_shift_windows set timezone = 'America/New_York' where territory_id = $1`,
          [world.territories.nagpur],
        );
        await client.query('update public.doctors set territory_id = $1 where id = $2', [
          world.territories.nagpur,
          world.doctors.pune,
        ]);
      });
      expect(await mileageCounts(client), 'moving the doctor moved no check-in').toEqual(before);
      const day = await asOwner(client, async () =>
        client.query<{ d: string }>(
          'select public.visit_day(v)::text as d from public.visits v where v.id = $1',
          [visitId],
        ),
      );
      expect(day.rows[0]?.d).toBe('2026-08-13');
    });
  });

  it('with no zone configured anywhere, mileage falls back exactly as visit_day does — never Asia/Kolkata', async () => {
    await inRolledBackTransaction(async (client) => {
      await zoneEverywhere(client, 'Asia/Kolkata');
      // 20:00Z is 01:30 IST on the 13th. Under the UTC fallback it is the 12th. The check-in is made
      // while a window exists (it must be, to be accepted); the zone is then removed everywhere.
      const visitId = await checkIn(client, '2026-08-12T20:00:00Z');
      const source = await asOwner(client, async () => {
        await client.query(
          `delete from public.territory_shift_windows w using public.territories t
            where t.id = w.territory_id and t.organisation_id = $1`,
          [world.organisationId],
        );
        // No company default either: `org_default_shift_window` is null, and `source` below proves it.
        return client.query<{ source: string; zone: string }>(
          'select source, time_zone as zone from public.day_zone_unchecked($1)',
          [world.users.puneMr.id],
        );
      });
      expect(source.rows[0]).toEqual({ source: 'fallback_utc', zone: 'UTC' });
      const counts = await mileageCounts(client);
      const day = await asOwner(client, async () =>
        client.query<{ d: string }>(
          'select public.visit_day(v)::text as d from public.visits v where v.id = $1',
          [visitId],
        ),
      );
      expect(day.rows[0]?.d).toBe('2026-08-12');
      expect(counts.get('2026-08-12'), 'counted on the UTC day, as visit_day').toBeGreaterThan(0);
      expect(counts.get('2026-08-13') ?? 0, 'not on the Asia/Kolkata day').toBe(0);
    });
  });
});
