import { describe, expect, it } from 'vitest';
import { dayLabel, indiaDate, indiaDateTime, indiaToday, isRealDay } from './india-date';

describe('indiaToday (FE-W125)', () => {
  it('is already the next day in India between midnight and 05:30 IST, when UTC is not', () => {
    // 20:01 UTC on the 13th is 01:31 IST on the 14th — the hour the UTC default showed yesterday.
    const now = new Date('2026-10-13T20:01:00Z');
    expect(now.toISOString().slice(0, 10)).toBe('2026-10-13');
    expect(indiaToday(now)).toBe('2026-10-14');
  });

  it('agrees with UTC once both have passed midnight', () => {
    expect(indiaToday(new Date('2026-10-14T06:00:00Z'))).toBe('2026-10-14');
  });

  it('turns over at exactly 18:30 UTC', () => {
    expect(indiaToday(new Date('2026-12-31T18:29:59Z'))).toBe('2026-12-31');
    expect(indiaToday(new Date('2026-12-31T18:30:00Z'))).toBe('2027-01-01');
  });
});

describe('FE-W166 — dates a person reads', () => {
  it('names a calendar day without converting it', () => {
    expect(dayLabel('2026-10-14')).toBe('14 Oct 2026');
    expect(dayLabel('2026-09-01')).toBe('1 Sep 2026');
    // Not a day: shown as it came, never hidden.
    expect(dayLabel('someday')).toBe('someday');
  });

  it('gives an instant its date in India, not in UTC', () => {
    // 20:01 UTC on the 13th is already the 14th in India.
    expect(indiaDate('2026-10-13T20:01:00Z')).toBe('14 Oct 2026');
    expect(indiaDate('2026-10-14T06:00:00+00:00')).toBe('14 Oct 2026');
  });

  it('gives an instant its India clock time, to the minute, on a 24-hour clock', () => {
    expect(indiaDateTime('2026-10-13T07:10:15.70199+00:00')).toBe('13 Oct 2026, 12:40');
    expect(indiaDateTime('2026-12-31T18:30:00Z')).toBe('1 Jan 2027, 00:00');
  });

  it('spells September as Sep whatever the runtime’s locale data says', () => {
    expect(indiaDate('2026-09-22T06:15:00+00:00')).toBe('22 Sep 2026');
  });

  it('returns an unreadable instant unchanged', () => {
    expect(indiaDate('not a date')).toBe('not a date');
    expect(indiaDateTime('')).toBe('');
  });
});

describe('FE-W215 — a day in the address bar is a day that exists', () => {
  it('accepts a real day, and refuses a shape that names no day', () => {
    expect(isRealDay('2026-10-14')).toBe(true);
    expect(isRealDay('2028-02-29')).toBe(true);
    expect(isRealDay('2026-02-31')).toBe(false);
    expect(isRealDay('2026-02-29')).toBe(false);
    expect(isRealDay('2026-13-01')).toBe(false);
    expect(isRealDay('14-10-2026')).toBe(false);
    expect(isRealDay(undefined)).toBe(false);
  });
});
