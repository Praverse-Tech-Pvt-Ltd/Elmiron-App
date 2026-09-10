import { describe, expect, it } from 'vitest';
import { UTC_FALLBACK, clockIn, dayIn, territoryToday } from './territory-day';

/**
 * MR-15 A2 — the day boundary, at the edges that actually matter.
 *
 * IST is UTC+5:30 with no DST, so a UTC day boundary cuts the MR's day at 05:30 local.
 * Every case below is a time a field rep genuinely works: an early beat, a day-end run
 * after midnight, a late clinic. Each is a visit that lands on the wrong day if the
 * boundary is UTC or the handset's.
 */

const IST = { timeZone: 'Asia/Kolkata', source: 'territory' } as const;

describe('the clock reads in the territory, not in the string', () => {
  it('renders a UTC-stamped instant as the territory wall clock', () => {
    // THE MEASURED DEFECT. `sync_pull` returns `2026-09-10T07:30:00+00:00` for a visit the
    // seed created; the old `clockFrom` sliced characters and displayed "07:30", and the
    // visit is at 13:00. Five and a half hours early, on every screen, from real data.
    expect(clockIn('2026-09-10T07:30:00+00:00', IST)).toBe('13:00');
  });

  it('agrees with the old slicing when the server DOES send +05:30', () => {
    // The positive control for the change: `services/mock` sends `+05:30`, which is why
    // slicing looked correct for the whole of the frontend's life. Both readings agree
    // here, so this is a fix to a wrong frame rather than a change of convention.
    expect(clockIn('2026-08-10T10:04:00+05:30', IST)).toBe('10:04');
    expect('2026-08-10T10:04:00+05:30'.slice(11, 16)).toBe('10:04');
  });

  it('renders midnight as 00:00 and never as 24:00', () => {
    // `hour12: false` renders midnight as hour 24 under some ICU versions, and "24:00" is
    // not a time anybody reads. The first draft carried a 24 -> 00 normalisation for it;
    // measured on BOTH runtimes that matter -- Node's ICU and Hermes on the device -- and
    // both return "00:00", so the branch was removed rather than shipped unexercised. This
    // case stays as the guard: if a future runtime does render 24, this fails and says so.
    expect(clockIn('2026-09-09T18:30:00+00:00', IST)).toBe('00:00');
  });
});

describe('which day — the edges the reviewer named', () => {
  it('00:30 IST belongs to that IST day, not to the UTC day before it', () => {
    // 00:30 IST on the 10th is 19:00 UTC on the NINTH. A UTC boundary files this visit
    // under the previous day and it vanishes from Today.
    const instant = '2026-09-09T19:00:00+00:00';
    expect(dayIn(instant, IST)).toBe('2026-09-10');
    expect(dayIn(instant, UTC_FALLBACK)).toBe('2026-09-09');
  });

  it('05:00 IST is still the same day, though UTC has not rolled over', () => {
    // The reviewer's case: a UTC day cuts at 05:30 IST, so an early beat at 05:00 lands on
    // the wrong side. 05:00 IST on the 10th is 23:30 UTC on the 9th.
    const instant = '2026-09-09T23:30:00+00:00';
    expect(dayIn(instant, IST)).toBe('2026-09-10');
    expect(dayIn(instant, UTC_FALLBACK)).toBe('2026-09-09');
  });

  it('23:59 IST is still that day and has not spilled into the next', () => {
    const instant = '2026-09-10T18:29:00+00:00';
    expect(dayIn(instant, IST)).toBe('2026-09-10');
  });

  it('a day-end flow run after midnight reports the day it is actually in', () => {
    // 00:30 IST on the 11th. An MR finishing paperwork after midnight is in a new day and
    // the screen must say so rather than showing the day they just finished.
    expect(territoryToday('2026-09-10T19:00:00+00:00', IST)).toBe('2026-09-11');
  });

  it('and 05:29 vs 05:31 IST are the SAME day — the boundary is not at 05:30', () => {
    // The assertion that the UTC boundary is gone rather than moved. These two straddle
    // 00:00 UTC and must not straddle anything here.
    expect(dayIn('2026-09-09T23:59:00+00:00', IST)).toBe('2026-09-10');
    expect(dayIn('2026-09-10T00:01:00+00:00', IST)).toBe('2026-09-10');
  });
});

describe('the fallback is visible, not silent', () => {
  it('says when it is using UTC rather than a territory answer', () => {
    // `my_shift_window()` returns null for an MR with no territory, or a territory with no
    // configured hours -- and shift hours are NOT configured in production. There is no
    // honest way to invent a timezone, so this falls back to UTC and labels itself, rather
    // than quietly answering with the wrong boundary.
    expect(UTC_FALLBACK.source).toBe('fallback_utc');
    expect(UTC_FALLBACK.timeZone).toBe('UTC');
  });

  it('and the fallback really does differ, so the label is not decorative', () => {
    // If UTC and IST agreed, `source` would be a field nobody needs. They do not agree at
    // exactly the times a field rep works, which is why the caller has to be able to tell.
    const earlyMorning = '2026-09-09T23:30:00+00:00';
    expect(dayIn(earlyMorning, IST)).not.toBe(dayIn(earlyMorning, UTC_FALLBACK));
  });
});

describe('the device is not consulted', () => {
  it('gives the same answer whatever the handset is set to', () => {
    // The property that matters. `TZ` is set per-process by the runner; what this asserts
    // is that the FUNCTION takes its zone from its argument, so a phone in the wrong
    // timezone cannot move a visit. A device-reading implementation would have to read
    // something that is not passed in, and there is nothing here that does.
    const instant = '2026-09-09T23:30:00+00:00';
    expect(dayIn(instant, IST)).toBe('2026-09-10');
    expect(dayIn(instant, { timeZone: 'America/Denver', source: 'territory' })).toBe('2026-09-09');
    // Same instant, three zones, three answers -- all decided by the argument.
    expect(dayIn(instant, UTC_FALLBACK)).toBe('2026-09-09');
  });
});
