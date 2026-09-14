import { describe, expect, it } from 'vitest';
import { dayIn } from './territory-day';
import { resolveAnchoredDay } from './day-anchor';
import type { DayAnchor } from './day-anchor';

/**
 * `FE-W40` option D — bounded at the territory day boundary.
 *
 * **The pair below STRADDLES 18:30Z and does not sit comfortably either side of it.** IST is
 * UTC+05:30, so the territory's midnight is `18:30Z`. Both cases share ONE anchor, taken at
 * `17:45Z` — 45 minutes before the boundary — and differ only in how much device time has
 * elapsed since:
 *
 * | elapsed | projected | IST | territory day | verdict |
 * | --- | --- | --- | --- | --- |
 * | 30 min | `18:15Z` | 23:45 on the 14th | `2026-09-14` | **current** |
 * | 60 min | `18:45Z` | 00:15 on the 15th | `2026-09-15` | **expired** |
 *
 * 15 minutes short of the boundary and 15 minutes past it. A pair at, say, 09:00Z and 22:00Z
 * would pass against an implementation that compared raw UTC dates and never looked at the
 * zone at all — which is the defect this is written to catch, so the samples are placed where
 * only a zone-aware comparison can separate them.
 */

const IST: Pick<DayAnchor, 'timeZone' | 'zoneSource'> = {
  timeZone: 'Asia/Kolkata',
  zoneSource: 'territory',
};

/** An arbitrary device epoch. Only differences from it are ever used. */
const RECEIVED_AT = 1_757_000_000_000;
const MINUTE = 60_000;

const anchorAt = (serverTime: string): DayAnchor => ({
  serverTime,
  receivedAt: RECEIVED_AT,
  ...IST,
});

/** 45 minutes before IST midnight. */
const BEFORE_BOUNDARY = '2026-09-14T17:45:00.000Z';

describe('FE-W40 — an anchored day is bounded at the TERRITORY day boundary', () => {
  it('THE PRECONDITION: the pair really does straddle 18:30Z in IST', () => {
    // Asserting the fixture before asserting the behaviour. Without this, both cases could
    // sit on the same side of the boundary and agree with the implementation by coincidence.
    expect(
      dayIn('2026-09-14T18:15:00.000Z', { timeZone: 'Asia/Kolkata', source: 'territory' }),
    ).toBe('2026-09-14');
    expect(
      dayIn('2026-09-14T18:45:00.000Z', { timeZone: 'Asia/Kolkata', source: 'territory' }),
    ).toBe('2026-09-15');
    // And the control for the control: in UTC the same two instants are the SAME day, so an
    // implementation that ignored the zone would call both `current` and pass the first case
    // below while failing this one. The zone is doing the work, not the raw instants.
    expect(dayIn('2026-09-14T18:15:00.000Z', { timeZone: 'UTC', source: 'fallback_utc' })).toBe(
      '2026-09-14',
    );
    expect(dayIn('2026-09-14T18:45:00.000Z', { timeZone: 'UTC', source: 'fallback_utc' })).toBe(
      '2026-09-14',
    );
  });

  it('an anchor from EARLIER THE SAME territory day is current, and carries its age', () => {
    const resolved = resolveAnchoredDay(anchorAt(BEFORE_BOUNDARY), RECEIVED_AT + 30 * MINUTE);

    expect(resolved).not.toBeNull();
    expect(resolved?.kind).toBe('current');
    expect(resolved?.day).toBe('2026-09-14');
    // The age is the honesty: the screen says "as of" this instant, and it is the SERVER's.
    expect(resolved?.asOf).toBe(BEFORE_BOUNDARY);
  });

  it('an anchor from the PREVIOUS territory day is expired — thirty minutes later', () => {
    const resolved = resolveAnchoredDay(anchorAt(BEFORE_BOUNDARY), RECEIVED_AT + 60 * MINUTE);

    expect(resolved?.kind).toBe('expired');
    // It still carries both, so the screen can say WHY it shows nothing rather than repeating
    // the generic "could not load your day".
    expect(resolved?.day).toBe('2026-09-14');
    expect(resolved?.asOf).toBe(BEFORE_BOUNDARY);
  });

  it('the overnight case option C gets wrong: synced 18:20 IST, opened 07:40 next morning', () => {
    // 18:20 IST on the 14th is 12:50Z. Opening at 07:40 IST on the 15th is 13h20m later.
    const resolved = resolveAnchoredDay(
      anchorAt('2026-09-14T12:50:00.000Z'),
      RECEIVED_AT + (13 * 60 + 20) * MINUTE,
    );
    // Option C would render the 14th's list, correctly labelled and still the wrong list.
    expect(resolved?.kind).toBe('expired');
    expect(resolved?.day).toBe('2026-09-14');
  });

  it('a device clock that moved BACKWARDS cannot resurrect an expired anchor', () => {
    // Elapsed is clamped at zero, so a backwards clock looks like no time passing. That can
    // hold a current anchor current; it can never drag an expired one back across midnight.
    const resolved = resolveAnchoredDay(anchorAt(BEFORE_BOUNDARY), RECEIVED_AT - 48 * 60 * MINUTE);
    expect(resolved?.kind).toBe('current');
    expect(resolved?.day).toBe('2026-09-14');
  });

  it('a device clock that jumped FORWARD expires rather than guessing', () => {
    const resolved = resolveAnchoredDay(anchorAt(BEFORE_BOUNDARY), RECEIVED_AT + 48 * 60 * MINUTE);
    expect(resolved?.kind).toBe('expired');
  });

  it('an anchor whose serverTime does not parse is refused, not rendered', () => {
    // It crossed a process boundary and a build that may not be this one. `new Date(NaN)`
    // renders "Invalid Date" as a date, which is the parse-do-not-cast rule the records
    // already follow.
    expect(resolveAnchoredDay(anchorAt('not-a-timestamp'), RECEIVED_AT)).toBeNull();
    expect(resolveAnchoredDay(anchorAt(''), RECEIVED_AT)).toBeNull();
  });

  it('the boundary is read in the ANCHOR’s zone, not the ambient one', () => {
    // The same instants, anchored in UTC, stay on one day — so a build that dropped the
    // persisted zone and fell back to UTC would call the expired case current.
    const utcAnchor: DayAnchor = {
      serverTime: BEFORE_BOUNDARY,
      receivedAt: RECEIVED_AT,
      timeZone: 'UTC',
      zoneSource: 'fallback_utc',
    };
    expect(resolveAnchoredDay(utcAnchor, RECEIVED_AT + 60 * MINUTE)?.kind).toBe('current');
    // ...while the IST anchor over the identical elapsed time is expired. Same instants, same
    // elapsed, different zone, different answer. That is the zone earning its place on disk.
    expect(resolveAnchoredDay(anchorAt(BEFORE_BOUNDARY), RECEIVED_AT + 60 * MINUTE)?.kind).toBe(
      'expired',
    );
  });
});
