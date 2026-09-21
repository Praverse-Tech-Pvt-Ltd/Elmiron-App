import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client, QueryResult } from 'pg';
import { inRolledBackTransaction, requireDatabase, withClient } from './db.js';
import { asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * MR-47 C — `BE-W107`. One rule for which day a visit belongs to, used by both surfaces.
 *
 * `visit_day()` decides it. `coverage()` — the manager's report — counts by it, and
 * `sync_pull()` sends it to the MR, whose route uses it instead of reckoning the day itself.
 *
 * **Every case is at 18:45Z**, which straddles the India day boundary: 00:15 IST on the NEXT
 * date. A rule that silently used UTC, or silently used India time, lands on the wrong side of
 * it in one of the three territories below, and the two surfaces are asserted to agree in all
 * three.
 *
 * | Territory setting | 18:45Z on 10 Jan is | Source |
 * | --- | --- | --- |
 * | India time (the fixture's inherited national window) | 11 Jan | `territory` |
 * | `Asia/Dubai` override (UTC+4) | 10 Jan | `territory` |
 * | no configured hours at all | 10 Jan (UTC) | `fallback_utc` — labelled on the report |
 */
const reachable = await requireDatabase();

let world: FixtureWorld;
let visitId: string;

const AT = '2026-01-10T18:45:00.000Z';
const UTC_DATE = '2026-01-10';
const IST_DATE = '2026-01-11';

/**
 * A completed visit by the Pune MR, finishing at `AT`. COMMITTED, once: `sync_pull` reads up to
 * the current snapshot, and a row inserted by the transaction doing the pulling is not in it.
 * The fixture world is this file's own, so nothing else counts it. Each case then changes the
 * territory's hours inside a rolled-back transaction, and both surfaces are read inside it.
 */
beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
  visitId = randomUUID();
  await withClient(async (client) => {
    await client.query(
      `insert into public.visits (id, mr_id, doctor_id, status, started_at, completed_at)
       values ($1, $2, $3, 'completed', $4::timestamptz - interval '20 minutes', $4)`,
      [visitId, world.users.puneMr.id, world.doctors.pune, AT],
    );
  });
});

interface PullPage {
  changes: { entityId: string; payload: Record<string, unknown> | null }[];
  hasMore: boolean;
  nextCursor: string;
}

/** The day the MR's device is told, read from sync_pull as the MR. */
const pulledDay = async (client: Client, visitId: string): Promise<string | null> => {
  await asUser(client, world.users.puneMr);
  let cursor: string | null = null;
  for (let page = 0; page < 50; page += 1) {
    const result: QueryResult<{ r: PullPage }> = await client.query(
      'select public.sync_pull($1, $2, $3) as r',
      [cursor, ['visit'], 200],
    );
    const r: PullPage | undefined = result.rows[0]?.r;
    if (r === undefined) throw new Error('sync_pull returned nothing');
    const hit = r.changes.find((c) => c.entityId === visitId);
    if (hit !== undefined) return (hit.payload?.['visit_day'] as string | null) ?? null;
    if (!r.hasMore) break;
    cursor = r.nextCursor;
  }
  throw new Error(`visit ${visitId} not found in the pull`);
};

interface ReportRow {
  coverage_date: string;
  actual_visit_count: number;
  day_zone: string;
  day_zone_source: string;
}

/** The Pune MR's rows from the manager's report, as their manager. */
const report = async (client: Client): Promise<ReportRow[]> => {
  await asUser(client, world.users.westManager);
  const { rows } = await client.query<ReportRow>(
    `select coverage_date::text, actual_visit_count, day_zone, day_zone_source
       from public.coverage($1, $2) where mr_id = $3 order by coverage_date`,
    [UTC_DATE, IST_DATE, world.users.puneMr.id],
  );
  return rows;
};

const agreeAt18_45 = async (
  client: Client,
  expected: { day: string; zone: string; source: string },
): Promise<void> => {
  const pulled = await pulledDay(client, visitId);
  const rows = await report(client);

  // The two surfaces agree, and on the expected side of the boundary: the report counts the
  // visit on exactly the day the pull sends, and on no other.
  expect(pulled).toBe(expected.day);
  expect(rows.map((r) => [r.coverage_date, r.actual_visit_count])).toEqual(
    [UTC_DATE, IST_DATE].map((d) => [d, d === expected.day ? 1 : 0]),
  );
  // And the report says which zone decided it, on every row.
  expect(new Set(rows.map((r) => `${r.day_zone}|${r.day_zone_source}`))).toEqual(
    new Set([`${expected.zone}|${expected.source}`]),
  );
};

describe.skipIf(!reachable)('BE-W107 — one day rule, at 18:45Z', () => {
  it('India-time territory: the screen and the report both put it on the NEXT date', async () => {
    await inRolledBackTransaction(async (client) => {
      await agreeAt18_45(client, { day: IST_DATE, zone: 'Asia/Kolkata', source: 'territory' });
    });
  });

  it('a territory in another zone is reckoned in THAT zone, not India time', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query('reset role');
      await client.query(
        `insert into public.territory_shift_windows
           (territory_id, shift_start, shift_end, timezone, grace_minutes, active_weekdays)
         values ($1, '09:00', '19:00', 'Asia/Dubai', 15, '{1,2,3,4,5,6}')`,
        [world.territories.pune],
      );
      await agreeAt18_45(client, { day: UTC_DATE, zone: 'Asia/Dubai', source: 'territory' });
    });
  });

  it('no configured hours: both fall back to UTC, and the REPORT labels it as the screen does', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query('reset role');
      await client.query(
        `delete from public.territory_shift_windows where territory_id = any($1)`,
        [[world.territories.national, world.territories.west, world.territories.pune]],
      );
      await agreeAt18_45(client, { day: UTC_DATE, zone: 'UTC', source: 'fallback_utc' });
    });
  });

  it('REFUSES another company’s MR asking for this MR’s zone — the BE-W106 shape', async () => {
    await expect(
      inRolledBackTransaction(async (client) => {
        await asUser(client, world.users.rivalMr);
        return client.query('select * from public.day_zone_for($1)', [world.users.puneMr.id]);
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('POSITIVE CONTROL: the MR asking about themselves is answered', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      const { rows } = await client.query<{ time_zone: string; source: string }>(
        'select * from public.day_zone_for($1)',
        [world.users.puneMr.id],
      );
      expect(rows).toEqual([{ time_zone: 'Asia/Kolkata', source: 'territory' }]);
    });
  });
});
