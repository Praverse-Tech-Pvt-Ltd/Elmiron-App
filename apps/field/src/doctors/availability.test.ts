import { describe, expect, it } from 'vitest';
import { MINIMUM_VISITS, availabilityFrom as from, availabilitySentence } from './availability';
import { UTC_FALLBACK } from '../today/territory-day';

const IST = { timeZone: 'Asia/Kolkata', source: 'territory' } as const;
/** The suite's default: the territory is India, as every fixture below assumes. */
const availabilityFrom = (startedAt: readonly string[], sample?: number) =>
  from(startedAt, IST, sample);

// 2026-08-04 is a Tuesday; 2026-08-06 a Thursday; 2026-08-07 a Friday.
const TUE_1120 = '2026-08-04T11:20:00+05:30';
const TUE_1145 = '2026-08-11T11:45:00+05:30';
const THU_1250 = '2026-08-06T12:50:00+05:30';
const THU_1210 = '2026-08-13T12:10:00+05:30';
const FRI_0930 = '2026-08-07T09:30:00+05:30';

describe('it refuses to answer from too little', () => {
  it('says nothing below the minimum', () => {
    // Two visits on a Tuesday is a coincidence. An MR who plans a day around it has
    // been misled by arithmetic dressed as advice.
    expect(availabilityFrom([TUE_1120, TUE_1145])).toBeNull();
    expect(MINIMUM_VISITS).toBe(3);
  });

  it('says nothing when no day repeats', () => {
    // Three visits on three different days is a diary, not a pattern.
    expect(availabilityFrom([TUE_1120, THU_1250, FRI_0930])).toBeNull();
  });

  it('renders no sentence when there is no answer', () => {
    expect(availabilitySentence(null)).toBeNull();
  });
});

describe('what it reports', () => {
  const found = () => availabilityFrom([TUE_1120, TUE_1145, THU_1250, THU_1210, FRI_0930]);

  it('names the days the MR actually found them', () => {
    expect(found()?.days).toBe('Tuesdays and Thursdays');
  });

  it('rounds the window outward, never tighter than the visits support', () => {
    // 09:30 and 12:50 give 09:00–13:00. Reporting 09:30–12:50 would imply a
    // precision five visits cannot carry.
    expect(found()?.window).toBe('09:00–13:00');
  });

  it('always says how many visits it is from', () => {
    expect(found()?.fromVisits).toBe(5);
    expect(availabilitySentence(found())).toBe(
      'Tuesdays and Thursdays, 09:00–13:00 — from your last 5 visits.',
    );
  });

  it('only reads the most recent sample it was given', () => {
    const many = [TUE_1120, TUE_1145, THU_1250, THU_1210, FRI_0930, FRI_0930, FRI_0930];
    expect(availabilityFrom(many, 5)?.days).toBe('Tuesdays and Thursdays');
  });
});

describe('the territory’s calendar, not the handset’s', () => {
  it('reads the weekday off the date the server sent', () => {
    // A 23:30 visit in +05:30 is Tuesday there. Parsing the instant on a handset set
    // to UTC would call it Tuesday 18:00 — same day here, but the general case moves
    // late visits onto the wrong weekday and corrupts the whole pattern.
    const lateTuesdays = [
      '2026-08-04T23:30:00+05:30',
      '2026-08-11T23:30:00+05:30',
      '2026-08-18T23:30:00+05:30',
    ];
    expect(availabilityFrom(lateTuesdays)?.days).toBe('Tuesdays');
  });
});

/**
 * W2-C A1 — the shape the SERVER sends. Every case above uses `+05:30`, the mock's shape, and the old
 * character slices passed them all; the doctor profile feeds Supabase `startedAt`, which is `Z`.
 */
describe('W2-C A1 — Supabase Z timestamps read in the territory', () => {
  it('the window is the IST hours, not the UTC ones', () => {
    // 05:50Z = 11:20 IST; 06:15Z = 11:45; 07:20Z = 12:50 (Thu); 06:40Z = 12:10 (Thu); 04:00Z = 09:30.
    const z = [
      '2026-08-04T05:50:00Z',
      '2026-08-11T06:15:00Z',
      '2026-08-06T07:20:00Z',
      '2026-08-13T06:40:00Z',
      '2026-08-07T04:00:00Z',
    ];
    expect(availabilityFrom(z)).toEqual({
      days: 'Tuesdays and Thursdays',
      window: '09:00–13:00',
      fromVisits: 5,
    });
  });

  it('an early-morning IST visit counts on ITS weekday, not the UTC date before it', () => {
    // 22:45Z on Tuesday is 04:15 on WEDNESDAY in India.
    const earlyWednesdays = [
      '2026-08-04T22:45:00Z',
      '2026-08-11T22:45:00Z',
      '2026-08-18T22:45:00Z',
    ];
    expect(availabilityFrom(earlyWednesdays)?.days).toBe('Wednesdays');
  });

  it('the zone decides it: the same stamps in a UTC territory are Tuesdays', () => {
    const stamps = ['2026-08-04T22:45:00Z', '2026-08-11T22:45:00Z', '2026-08-18T22:45:00Z'];
    expect(from(stamps, UTC_FALLBACK)?.days).toBe('Tuesdays');
  });
});
