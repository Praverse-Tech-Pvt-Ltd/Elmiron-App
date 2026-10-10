import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asOwner, asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * `BE-W173` (`20261009000300_check_in_out_clock_bounds`) — check-in and check-out against the
 * server's clock.
 *
 * The rule is the system's existing one (`consent_future_tolerance_seconds`, 120): an event may be
 * up to and INCLUDING 120 seconds after the server clock, never more. Every time below is computed
 * from `now()` INSIDE the same transaction the function reads it in, so "+120 s" is exactly that.
 *
 * Each case widens the territory's working hours to the whole day inside its own rolled-back
 * transaction, so what is tested is the clock rule and not the hour the suite happens to run at.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

const LAT = 18.5204;
const LON = 73.8567;

/** The whole day, every day, for the fixture company -- inside the caller's transaction. */
const allDayShift = async (client: Client): Promise<void> => {
  await asOwner(client, async () => {
    await client.query(
      `update public.territory_shift_windows w
          set shift_start = '00:00', shift_end = '23:59', grace_minutes = 60,
              active_weekdays = '{1,2,3,4,5,6,7}'
         from public.territories t
        where t.id = w.territory_id and t.organisation_id = $1`,
      [world.organisationId],
    );
  });
};

/** A fresh unplanned visit of the Pune rep's, at a clinic. */
const aVisit = async (client: Client): Promise<string> => {
  const id = randomUUID();
  await client.query(
    `insert into public.visits (id, mr_id, doctor_id, clinic_address_id, origin, unplanned_reason)
     values ($1, $2, $3, $4, 'unplanned', 'clock test')`,
    [id, world.users.puneMr.id, world.doctors.pune, world.clinicAddresses.pune],
  );
  return id;
};

const outcome = async (client: Client, sql: string, params: unknown[]) => {
  await client.query('savepoint probe');
  try {
    await client.query(sql, params);
    await client.query('release savepoint probe');
    return { code: null as string | null, message: '' };
  } catch (error) {
    await client.query('rollback to savepoint probe');
    const e = error as { code?: string; message?: string };
    return { code: e.code ?? 'unknown', message: e.message ?? '' };
  }
};

const CHECK_IN = `select public.record_check_in($1, $2, ${String(LAT)}, ${String(LON)}, $3::timestamptz)`;
const CHECK_IN_AT = `select public.record_check_in($1, $2, ${String(LAT)}, ${String(LON)}, now() + make_interval(secs => $3))`;
const CHECK_OUT_AT = `select public.record_check_out($1, $2, ${String(LAT)}, ${String(LON)}, now() + make_interval(secs => $3))`;

const asRep = async <T>(fn: (client: Client, visitId: string) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await allDayShift(client);
    await asUser(client, world.users.puneMr);
    return fn(client, await aVisit(client));
  });

describe.skipIf(!reachable)('BE-W173 — a check-in is judged against the server clock', () => {
  it.each([
    ['at the server time', 0, null],
    ['119 s ahead', 119, null],
    ['120 s ahead — the tolerance, inclusive', 120, null],
    ['121 s ahead', 121, '45013'],
    ['a device clock a day ahead', 86_400, '45013'],
  ])('%s', async (_label, seconds, expected) => {
    await asRep(async (client, visitId) => {
      const id = randomUUID();
      const result = await outcome(client, CHECK_IN_AT, [id, visitId, seconds]);
      expect(result.code).toBe(expected);
      const stored = await client.query('select 1 from public.check_ins where id = $1', [id]);
      expect(stored.rowCount, 'a refused check-in writes nothing').toBe(expected === null ? 1 : 0);
      if (expected !== null) expect(result.message).toContain('field_event_in_future');
    });
  });

  it('an OLD check-in, synced long after it happened offline, is accepted — no age limit is invented', async () => {
    await asRep(async (client, visitId) => {
      const result = await outcome(client, CHECK_IN, [
        randomUUID(),
        visitId,
        '2026-08-12T11:00:00+05:30',
      ]);
      expect(result.code).toBeNull();
    });
  });

  it('the same check-in sent twice is one check-in', async () => {
    await asRep(async (client, visitId) => {
      const id = randomUUID();
      await client.query(CHECK_IN_AT, [id, visitId, -60]);
      await client.query(CHECK_IN_AT, [id, visitId, -60]);
      const n = await client.query(
        'select count(*)::int as n from public.check_ins where visit_id = $1',
        [visitId],
      );
      expect(n.rows[0]).toEqual({ n: 1 });
    });
  });

  it('a duplicate of an ACCEPTED check-in is still accepted later, even once its time would now be judged', async () => {
    // Idempotency comes before the clock rule: a resend must return the first answer, never a
    // new verdict on the same event.
    await asRep(async (client, visitId) => {
      const id = randomUUID();
      await client.query(CHECK_IN_AT, [id, visitId, 120]);
      const again = await outcome(client, CHECK_IN_AT, [id, visitId, 5_000]);
      expect(again.code).toBeNull();
    });
  });
});

describe.skipIf(!reachable)(
  'BE-W173 — a check-out is judged against the server clock and its check-in',
  () => {
    it.each([
      ['120 s ahead — inclusive', 120, null],
      ['121 s ahead', 121, '45013'],
    ])('%s', async (_label, seconds, expected) => {
      await asRep(async (client, visitId) => {
        await client.query(CHECK_IN_AT, [randomUUID(), visitId, -3600]);
        const result = await outcome(client, CHECK_OUT_AT, [randomUUID(), visitId, seconds]);
        expect(result.code).toBe(expected);
      });
    });

    it('a check-out before the check-in is refused by name, not clamped to 0 seconds', async () => {
      await asRep(async (client, visitId) => {
        await client.query(CHECK_IN_AT, [randomUUID(), visitId, -3600]);
        const result = await outcome(client, CHECK_OUT_AT, [randomUUID(), visitId, -7200]);
        expect(result.code).toBe('45014');
        expect(result.message).toContain('check_out_before_check_in');
      });
    });

    it('a check-out sent twice is one check-out', async () => {
      await asRep(async (client, visitId) => {
        await client.query(CHECK_IN_AT, [randomUUID(), visitId, -3600]);
        const id = randomUUID();
        await client.query(CHECK_OUT_AT, [id, visitId, -60]);
        await client.query(CHECK_OUT_AT, [id, visitId, -60]);
        const n = await client.query(
          'select count(*)::int as n from public.check_outs where visit_id = $1',
          [visitId],
        );
        expect(n.rows[0]).toEqual({ n: 1 });
      });
    });
  },
);

describe.skipIf(!reachable)(
  'BE-W173 — through sync, a refusal is counted and named, never silent',
  () => {
    it('a check-in from a phone a day ahead is REJECTED with 45013, and an on-time one beside it is accepted', async () => {
      await asRep(async (client, visitId) => {
        const now = await client.query<{ t: string; ahead: string }>(
          `select (now() - interval '1 minute')::text as t, (now() + interval '1 day')::text as ahead`,
        );
        const item = (occurredAt: string) => {
          const id = randomUUID();
          return {
            id,
            entity: 'check_in',
            operation: 'create',
            entityId: visitId,
            clientCreatedAt: occurredAt,
            payload: { id, visitId, occurredAt, coordinates: { latitude: LAT, longitude: LON } },
          };
        };
        const ahead = item(String(now.rows[0]?.ahead));
        const onTime = item(String(now.rows[0]?.t));
        const response = await client.query<{
          r: { results: { id: string; status: string; sqlState: string | null }[] };
        }>('select public.sync_push($1, $2::jsonb) as r', [
          randomUUID(),
          JSON.stringify([ahead, onTime]),
        ]);
        const verdicts = response.rows[0]?.r.results ?? [];
        expect(verdicts.find((v) => v.id === ahead.id)).toMatchObject({
          status: 'rejected',
          sqlState: '45013',
        });
        expect(verdicts.find((v) => v.id === onTime.id)).toMatchObject({ status: 'accepted' });
      });
    });
  },
);
