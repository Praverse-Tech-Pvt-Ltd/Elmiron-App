import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { inRolledBackTransaction, requireDatabase } from './db.js';

/**
 * MR-24 B — the grace period must not wrap past midnight.
 *
 * **The defect this exists to hold closed.** `is_within_shift` compared `time` values:
 *
 * ```sql
 * v_local_time <= (v_window.shift_end + make_interval(mins => v_window.grace_minutes))
 * ```
 *
 * Postgres `time` wraps, so `time '23:59' + 30 minutes` is `00:29:00`, and the predicate
 * became `>= 03:30 AND <= 00:29` — a condition **no time of day can satisfy**. Every
 * check-in and check-out was refused, all day, for any territory whose
 * `shift_end + grace_minutes` crosses midnight.
 *
 * It was found on an emulator, on the first check-in ever to reach this server, and NOT by
 * this suite — because **`shift_end` had one kind of value in every fixture**. The seeds are
 * `19:00 / grace 15` and `10:00 / grace 0`; neither wraps, so the wrapping branch did not
 * exist as far as any test could tell. `seed-day.mjs`, meanwhile, seeds `23:59 / 30`, which
 * is squarely in the broken range — the demo data was in the failing configuration and the
 * test data was not.
 *
 * So these cases vary the one dimension that matters — whether `shift_end + grace` crosses
 * midnight — and assert both sides of it. A test that only checked the wrapping window would
 * pass against `return true`.
 */

const reachable = await requireDatabase();

/** A territory with a window of our choosing, inside a transaction that is rolled back. */
const territoryWithWindow = async (
  client: Parameters<Parameters<typeof inRolledBackTransaction>[0]>[0],
  shiftStart: string,
  shiftEnd: string,
  graceMinutes: number,
): Promise<string> => {
  const orgId = randomUUID();
  const territoryId = randomUUID();
  await client.query(
    `insert into public.organisations (id, name) values ($1, $2)`,
    [orgId, `MR24 grace ${shiftEnd}/${String(graceMinutes)}`],
  );
  await client.query(
    `insert into public.territories (id, organisation_id, name, code) values ($1, $2, $3, $4)`,
    [territoryId, orgId, `MR24 ${shiftEnd}`, `MR24-${randomUUID().slice(0, 8)}`],
  );
  await client.query(
    `insert into public.territory_shift_windows
       (territory_id, shift_start, shift_end, timezone, grace_minutes, active_weekdays)
     values ($1, $2, $3, 'Asia/Kolkata', $4, '{1,2,3,4,5,6,7}')`,
    [territoryId, shiftStart, shiftEnd, graceMinutes],
  );
  return territoryId;
};

const within = async (
  client: Parameters<Parameters<typeof inRolledBackTransaction>[0]>[0],
  territoryId: string,
  occurredAt: string,
): Promise<boolean> => {
  const result = await client.query<{ within: boolean }>(
    'select public.is_within_shift($1, $2::timestamptz) as within',
    [territoryId, occurredAt],
  );
  return result.rows[0]?.within ?? false;
};

// 05:25:13Z is 10:55:13 IST — the exact capture the emulator was refused on.
const MID_MORNING_UTC = '2026-09-11T05:25:13.186Z';
// 21:00Z on the 10th is 02:30 IST on the 11th — before 04:00 minus 30 minutes' grace.
const SMALL_HOURS_UTC = '2026-09-10T21:00:00.000Z';

describe.skipIf(!reachable)('grace that crosses midnight', () => {
  it('accepts a mid-morning capture when shift_end + grace passes 24:00', async () => {
    await inRolledBackTransaction(async (client) => {
      // 23:59 + 30 minutes = 24:29. As a `time` that was 00:29 and refused everything.
      const territoryId = await territoryWithWindow(client, '04:00', '23:59', 30);
      expect(
        await within(client, territoryId, MID_MORNING_UTC),
        '10:55 IST is inside 04:00-23:59 and must be accepted',
      ).toBe(true);
    });
  });

  it('STILL refuses a capture genuinely outside that same window — the positive control', async () => {
    await inRolledBackTransaction(async (client) => {
      // Without this, "return true" would satisfy the case above. 02:30 IST is before the
      // graced start of 03:30, and the window is the widest one the seeds ever use.
      const territoryId = await territoryWithWindow(client, '04:00', '23:59', 30);
      expect(
        await within(client, territoryId, SMALL_HOURS_UTC),
        '02:30 IST is before 04:00 minus 30 minutes and must be refused',
      ).toBe(false);
    });
  });

  it('is unchanged for a window whose grace does NOT cross midnight', async () => {
    await inRolledBackTransaction(async (client) => {
      // The shape every existing fixture already had. The fix must not move this.
      const territoryId = await territoryWithWindow(client, '09:00', '19:00', 15);
      expect(await within(client, territoryId, MID_MORNING_UTC), '10:55 is inside 09:00-19:00').toBe(
        true,
      );
      expect(
        await within(client, territoryId, SMALL_HOURS_UTC),
        '02:30 is outside 09:00-19:00',
      ).toBe(false);
    });
  });

  it('accepts a capture inside the graced tail that the wrap used to swallow', async () => {
    await inRolledBackTransaction(async (client) => {
      // 23:45 IST = 18:15Z. Inside 23:59 only by grace, and the single clearest case the
      // old arithmetic got wrong: the wrap made the graced tail unreachable.
      const territoryId = await territoryWithWindow(client, '04:00', '23:59', 30);
      expect(await within(client, territoryId, '2026-09-11T18:15:00.000Z')).toBe(true);
    });
  });
});
