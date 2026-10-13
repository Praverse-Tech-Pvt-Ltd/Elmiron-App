import { describe, expect, it } from 'vitest';
import { indiaToday } from './india-date';

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
