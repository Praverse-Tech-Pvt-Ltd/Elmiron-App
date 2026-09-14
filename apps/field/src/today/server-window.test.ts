import { describe, expect, it } from 'vitest';
import { monthIn, monthWindowIn, recentMonthsIn } from './server-window';
import type { TerritoryZone } from './territory-day';

/**
 * `FE-W42` C2 — the values are chosen to EXPOSE the defect, not to sit comfortably past it.
 *
 * IST is UTC+05:30, so the territory's midnight is `18:30Z`. The pair below straddles the
 * **last** midnight of September, which is the one instant where the day boundary and the
 * MONTH boundary move together:
 *
 * | instant | IST | territory day | territory month | UTC month |
 * | --- | --- | --- | --- | --- |
 * | `2026-09-30T18:25:00Z` | 23:55 on the 30th | `2026-09-30` | `2026-09` | `2026-09` |
 * | `2026-09-30T18:35:00Z` | 00:05 on the 1st | `2026-10-01` | `2026-10` | **`2026-09`** |
 *
 * Ten minutes apart, five minutes either side. The second row is the one that matters: a
 * build reading the instant in UTC — which is what `new Date().getMonth()` did on a device
 * whose clock is right — answers September for an MR whose month has already turned over.
 * A sample taken mid-month is right whichever way the code is wrong.
 */

const IST: TerritoryZone = { timeZone: 'Asia/Kolkata', source: 'territory' };
const UTC: TerritoryZone = { timeZone: 'UTC', source: 'fallback_utc' };

const BEFORE = '2026-09-30T18:25:00.000Z';
const AFTER = '2026-09-30T18:35:00.000Z';

describe('FE-W42 — territory windows, straddling the last midnight of a month', () => {
  it('THE PRECONDITION: the pair really does straddle, and UTC cannot separate it', () => {
    // Asserting the fixture before the behaviour. Without this both samples could sit on one
    // side and agree with the implementation by coincidence.
    expect(monthIn(BEFORE, IST)).toBe('2026-09');
    expect(monthIn(AFTER, IST)).toBe('2026-10');
    // The control for the control: in UTC both are September, so an implementation that
    // ignored the zone would pass the first case and fail the second.
    expect(monthIn(BEFORE, UTC)).toBe('2026-09');
    expect(monthIn(AFTER, UTC)).toBe('2026-09');
  });

  describe('monthWindowIn — which month of mileage is REQUESTED from the server', () => {
    it('five minutes before IST midnight, September', () => {
      expect(monthWindowIn(BEFORE, IST)).toEqual({
        fromDate: '2026-09-01',
        toDate: '2026-09-30',
      });
    });

    it('five minutes after, OCTOBER — a new month with one day in it', () => {
      // The MR's claim total for "this month" is now October's, which is correct and is what
      // the device clock got wrong. September had 30 days; October has 31, and the window
      // must not carry the previous month's length across.
      expect(monthWindowIn(AFTER, IST)).toEqual({
        fromDate: '2026-10-01',
        toDate: '2026-10-31',
      });
    });

    it('February in a leap year, because month LENGTH is the other half of this', () => {
      // 2028 is a leap year. A window built by adding 30 or 31 days would be wrong here, and
      // no amount of timezone care would catch it.
      expect(monthWindowIn('2028-02-15T09:00:00.000Z', IST).toDate).toBe('2028-02-29');
      expect(monthWindowIn('2027-02-15T09:00:00.000Z', IST).toDate).toBe('2027-02-28');
    });
  });

  describe('recentMonthsIn — which months the coaching trend covers', () => {
    it('five minutes before IST midnight: Jul, Aug, Sep', () => {
      expect(recentMonthsIn(BEFORE, IST, 3)).toEqual(['2026-07', '2026-08', '2026-09']);
    });

    it('five minutes after: Aug, Sep, OCT — the window moves with the territory', () => {
      expect(recentMonthsIn(AFTER, IST, 3)).toEqual(['2026-08', '2026-09', '2026-10']);
    });

    it('crosses a YEAR boundary without arithmetic on a month number', () => {
      // 00:05 IST on 1 January 2027. Counting back three months from month 1 is where a
      // naive `monthNumber - n` produces month 0 and month -1.
      expect(recentMonthsIn('2026-12-31T18:35:00.000Z', IST, 3)).toEqual([
        '2026-11',
        '2026-12',
        '2027-01',
      ]);
    });

    it('oldest first, and the LAST entry is the current territory month', () => {
      const months = recentMonthsIn(AFTER, IST, 3);
      expect(months[months.length - 1]).toBe(monthIn(AFTER, IST));
      expect([...months]).toEqual([...months].sort());
    });
  });
});
