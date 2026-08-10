import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * GATE 1 — the server half.
 *
 * Gate 1 is "one territory runs a full simulated day offline and syncs clean: no
 * lost writes, no duplicates, location capture visibly stops at shift end". The
 * client half needs the field app, which does not exist yet.
 *
 * This is the server half, decoupled so that when Frontend arrives the gate is a
 * matter of RUNNING it rather than building it. Everything below simulates one MR's
 * day entirely through the sync path — the same path a real device uses — and
 * asserts the properties the gate is actually about.
 *
 * What this does NOT prove, and what the client half must: that the device queues
 * correctly while offline, that the queue survives a process kill, and that
 * location capture stops at shift end *on the device* rather than merely being
 * refused when it arrives.
 *
 * Doctors and beat-plan entries are seeded as the table owner before the role
 * switch: they are admin-managed master data that a real deployment already has,
 * and an MR cannot create them. Everything the MR actually does goes through sync
 * as that MR.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

// 2026-08-12 is a Wednesday. The National window is 09:00–19:00 IST, 15 min grace.
const DAY = '2026-08-12';
const at = (hour: number, minute = 0): string =>
  `${DAY}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`;

const AFTER_SHIFT_END = at(19, 30); // past 19:00 + 15 min grace
const BEFORE_SHIFT_START = at(6, 0);

/** Four clinics along a line, roughly a kilometre apart. */
const STOPS: Array<{ lat: number; lon: number }> = [
  { lat: 18.52, lon: 73.85 },
  { lat: 18.529, lon: 73.85 },
  { lat: 18.538, lon: 73.85 },
  { lat: 18.547, lon: 73.85 },
];

type Item = Record<string, unknown>;

interface SyncResult {
  id: string;
  status: string;
  rejectionCode: string | null;
  warnings: string[];
}

const push = async (
  client: Client,
  items: Item[],
  batchId = randomUUID(),
): Promise<SyncResult[]> => {
  const result = await client.query<{ response: { results: SyncResult[] } }>(
    'select public.sync_push($1, $2::jsonb) as response',
    [batchId, JSON.stringify(items)],
  );
  return result.rows[0]?.response.results ?? [];
};

interface Day {
  doctorIds: string[];
  visitIds: string[];
  checkInIds: string[];
  callReportIds: string[];
  checkOutId: string;
  items: Item[];
}

/**
 * One MR's working day, expressed as the queue a device would be holding at 6pm:
 * a beat plan of four doctors, four visits, four check-ins, four call reports and a
 * check-out. Nothing here touches a table directly — it all goes through sync.
 */
const buildDay = async (client: Client): Promise<Day> => {
  const doctorIds: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    const doctorId = randomUUID();
    await client.query(
      `insert into public.doctors (id, organisation_id, full_name, territory_id, assigned_mr_id)
       values ($1, $2, $3, $4, $5)`,
      [
        doctorId,
        world.organisationId,
        `Dr Gate1 Stop ${String(i)}`,
        world.territories.pune,
        world.users.puneMr.id,
      ],
    );
    await client.query(
      `insert into public.beat_plan_entries (beat_plan_id, doctor_id, planned_sequence)
       values ($1, $2, $3)`,
      [world.beatPlans.pune, doctorId, i],
    );
    doctorIds.push(doctorId);
  }

  const visitIds = doctorIds.map(() => randomUUID());
  const checkInIds = doctorIds.map(() => randomUUID());
  const callReportIds = doctorIds.map(() => randomUUID());
  const checkOutId = randomUUID();

  const items: Item[] = [];

  doctorIds.forEach((doctorId, i) => {
    const stop = STOPS[i];
    if (stop === undefined) return;
    const visitStart = at(10 + i, 0);

    items.push({
      id: randomUUID(),
      entity: 'visit',
      operation: 'create',
      entityId: visitIds[i],
      clientCreatedAt: visitStart,
      payload: {
        doctorId,
        status: 'completed',
        beatPlanId: world.beatPlans.pune,
        startedAt: visitStart,
        completedAt: at(10 + i, 30),
      },
    });

    items.push({
      id: randomUUID(),
      entity: 'check_in',
      operation: 'create',
      entityId: checkInIds[i],
      clientCreatedAt: visitStart,
      payload: {
        visitId: visitIds[i],
        latitude: stop.lat,
        longitude: stop.lon,
        occurredAt: visitStart,
      },
    });

    items.push({
      id: randomUUID(),
      entity: 'call_report',
      operation: 'create',
      entityId: callReportIds[i],
      clientCreatedAt: at(10 + i, 32),
      payload: {
        visitId: visitIds[i],
        summary: `Discussed the formulary position at stop ${String(i)}.`,
        status: 'submitted',
        draftSource: 'voice_note',
      },
    });
  });

  // End of day: check out of the last visit, still inside the window.
  items.push({
    id: randomUUID(),
    entity: 'check_out',
    operation: 'create',
    entityId: checkOutId,
    clientCreatedAt: at(14, 0),
    payload: {
      visitId: visitIds[3],
      latitude: STOPS[3]?.lat ?? 0,
      longitude: STOPS[3]?.lon ?? 0,
      occurredAt: at(14, 0),
    },
  });

  return { doctorIds, visitIds, checkInIds, callReportIds, checkOutId, items };
};

const countIn = async (client: Client, table: string, ids: string[]): Promise<number> => {
  const result = await client.query<{ count: string }>(
    `select count(*) as count from public.${table} where id = any($1::uuid[])`,
    [ids],
  );
  return Number(result.rows[0]?.count);
};

const shuffle = <T>(items: T[], seed: number): T[] => {
  // Deterministic shuffle. Arrival order must not matter, and neither must the
  // particular disorder this test happens to pick.
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    const a = out[i];
    const b = out[j];
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[j] = a;
    }
  }
  return out;
};

// =============================================================================

describe.skipIf(!reachable)('Gate 1 — a full offline day, server half', () => {
  it('syncs a whole day in one batch with no lost writes', async () => {
    await inRolledBackTransaction(async (client) => {
      const day = await buildDay(client);
      await asUser(client, world.users.puneMr);

      const results = await push(client, day.items);

      expect(results).toHaveLength(day.items.length);
      expect(results.every((r) => r.status === 'accepted')).toBe(true);

      // Every item the server said it accepted is actually there.
      expect(await countIn(client, 'visits', day.visitIds)).toBe(4);
      expect(await countIn(client, 'check_ins', day.checkInIds)).toBe(4);
      expect(await countIn(client, 'call_reports', day.callReportIds)).toBe(4);
      expect(await countIn(client, 'check_outs', [day.checkOutId])).toBe(1);
    });
  });

  it('produces no duplicates when the same batch is sent twice', async () => {
    await inRolledBackTransaction(async (client) => {
      const day = await buildDay(client);
      await asUser(client, world.users.puneMr);
      const batchId = randomUUID();

      await push(client, day.items, batchId);
      const replay = await push(client, day.items, batchId);

      expect(replay.every((r) => r.status === 'duplicate')).toBe(true);
      expect(await countIn(client, 'visits', day.visitIds)).toBe(4);
      expect(await countIn(client, 'check_ins', day.checkInIds)).toBe(4);
      expect(await countIn(client, 'call_reports', day.callReportIds)).toBe(4);
      expect(await countIn(client, 'check_outs', [day.checkOutId])).toBe(1);
    });
  });

  it('is deterministic under out-of-order arrival', async () => {
    // A day's queue can land in any sequence. The derived numbers an MR is paid on
    // must not depend on which order the network happened to deliver it in.
    const mileageFor = async (order: (items: Item[]) => Item[]): Promise<number> =>
      inRolledBackTransaction(async (client) => {
        const day = await buildDay(client);
        await asUser(client, world.users.puneMr);
        // Check-ins must follow their visits to have something to attach to, so the
        // shuffle is applied within a dependency-respecting split rather than blindly.
        const visits = day.items.filter((i) => i['entity'] === 'visit');
        const rest = day.items.filter((i) => i['entity'] !== 'visit');
        await push(client, [...order(visits), ...order(rest)]);

        const result = await client.query<{ distance_metres: string }>(
          `select distance_metres from public.daily_mileage($1, $1, $2)`,
          [DAY, world.users.puneMr.id],
        );
        return Number(result.rows[0]?.distance_metres);
      });

    const inOrder = await mileageFor((items) => items);
    const shuffledA = await mileageFor((items) => shuffle(items, 7));
    const shuffledB = await mileageFor((items) => shuffle(items, 991));

    expect(shuffledA).toBeCloseTo(inOrder, 6);
    expect(shuffledB).toBeCloseTo(inOrder, 6);
    expect(inOrder).toBeGreaterThan(2500);
  });

  it('handles partial success per item, and a poison item mid-batch', async () => {
    await inRolledBackTransaction(async (client) => {
      const day = await buildDay(client);
      await asUser(client, world.users.puneMr);

      const poison: Item = {
        id: randomUUID(),
        entity: 'check_in',
        operation: 'create',
        entityId: randomUUID(),
        clientCreatedAt: AFTER_SHIFT_END,
        payload: {
          visitId: day.visitIds[0],
          latitude: STOPS[0]?.lat ?? 0,
          longitude: STOPS[0]?.lon ?? 0,
          occurredAt: AFTER_SHIFT_END,
        },
      };

      // Dropped into the middle, where a naive implementation would abort the rest.
      const withPoison = [...day.items.slice(0, 6), poison, ...day.items.slice(6)];
      const results = await push(client, withPoison);

      const poisonResult = results.find((r) => r.id === poison['id']);
      expect(poisonResult?.status).toBe('rejected');
      expect(poisonResult?.rejectionCode).toBe('outside_shift_window');

      // Everything else committed.
      expect(results.filter((r) => r.status === 'accepted')).toHaveLength(day.items.length);
      expect(await countIn(client, 'visits', day.visitIds)).toBe(4);
      expect(await countIn(client, 'call_reports', day.callReportIds)).toBe(4);
    });
  });

  it('refuses location capture after shift end', async () => {
    await inRolledBackTransaction(async (client) => {
      const day = await buildDay(client);
      await asUser(client, world.users.puneMr);
      await push(client, day.items);

      const late: Item = {
        id: randomUUID(),
        entity: 'check_in',
        operation: 'create',
        entityId: randomUUID(),
        clientCreatedAt: AFTER_SHIFT_END,
        payload: {
          visitId: day.visitIds[0],
          latitude: 18.6,
          longitude: 73.9,
          occurredAt: AFTER_SHIFT_END,
        },
      };
      const results = await push(client, [late]);

      expect(results[0]?.status).toBe('rejected');
      expect(results[0]?.rejectionCode).toBe('outside_shift_window');

      // And nothing was written. "Refused" has to mean no row, not a row with a flag.
      const stored = await client.query<{ count: string }>(
        'select count(*) as count from public.check_ins where id = $1',
        [late['entityId']],
      );
      expect(Number(stored.rows[0]?.count)).toBe(0);
    });
  });

  it('refuses location capture before shift start', async () => {
    await inRolledBackTransaction(async (client) => {
      const day = await buildDay(client);
      await asUser(client, world.users.puneMr);
      await push(client, day.items);

      const early: Item = {
        id: randomUUID(),
        entity: 'check_in',
        operation: 'create',
        entityId: randomUUID(),
        clientCreatedAt: BEFORE_SHIFT_START,
        payload: {
          visitId: day.visitIds[0],
          latitude: 18.6,
          longitude: 73.9,
          occurredAt: BEFORE_SHIFT_START,
        },
      };
      const results = await push(client, [early]);
      expect(results[0]?.rejectionCode).toBe('outside_shift_window');
    });
  });

  it('leaves the day visible to the MR manager and to nobody else', async () => {
    await inRolledBackTransaction(async (client) => {
      const day = await buildDay(client);
      await asUser(client, world.users.puneMr);
      await push(client, day.items);

      await client.query('reset role');
      await asUser(client, world.users.westManager);
      const visible = await countIn(client, 'visits', day.visitIds);
      expect(visible).toBe(4);

      await client.query('reset role');
      await asUser(client, world.users.southManager);
      const invisible = await countIn(client, 'visits', day.visitIds);
      expect(invisible).toBe(0);
    });
  });

  it('reports the day accurately through the observability surface', async () => {
    await inRolledBackTransaction(async (client) => {
      const day = await buildDay(client);
      await asUser(client, world.users.puneMr);
      await push(client, day.items);

      const status = await client.query<{
        accepted_count: number;
        rejected_count: number;
        last_successful_sync_at: string | null;
      }>('select * from public.sync_queue_status($1)', [world.users.puneMr.id]);

      expect(status.rows[0]?.accepted_count).toBe(day.items.length);
      expect(status.rows[0]?.rejected_count).toBe(0);
      expect(status.rows[0]?.last_successful_sync_at).not.toBeNull();
    });
  });
});
