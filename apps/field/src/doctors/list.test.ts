import { describe, expect, it } from 'vitest';
import { DoctorSchema, VisitSchema } from '@fieldforce/core';
import type { Doctor, Visit } from '@fieldforce/core';
import { OVERDUE_AFTER_DAYS, buildDoctorRows, lastSeenLabel, rankDoctors } from './list';
import type { TerritoryZone } from '../today/territory-day';

const NOW = Date.parse('2026-08-10T12:00:00+05:30');
const ZONE: TerritoryZone = { timeZone: 'Asia/Kolkata', source: 'territory' };
const daysAgo = (days: number): string => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

const doctor = (id: string, fullName: string, over: Partial<Doctor> = {}): Doctor =>
  DoctorSchema.parse({
    id,
    fullName,
    registrationNumber: null,
    specialty: 'Urology',
    qualification: null,
    territoryId: '11111111-1111-4111-8111-111111111103',
    assignedMrId: '22222222-2222-4222-8222-222222222202',
    clinicAddresses: [
      {
        id: '44444444-4444-4444-8444-444444444401',
        doctorId: id,
        label: 'Clinic',
        line1: '1 Road',
        line2: null,
        city: 'Dadar West',
        state: 'Maharashtra',
        postalCode: '400028',
        coordinates: null,
        geofenceRadiusMetres: 120,
      },
    ],
    isActive: true,
    createdAt: '2026-01-01T08:00:00+05:30',
    updatedAt: '2026-01-01T08:00:00+05:30',
    ...over,
  });

const completedVisit = (id: string, doctorId: string, completedAt: string): Visit =>
  VisitSchema.parse({
    id,
    mrId: '22222222-2222-4222-8222-222222222202',
    doctorId,
    beatPlanId: null,
    clinicAddressId: null,
    status: 'completed',
    notMetReason: null,
    scheduledFor: null,
    startedAt: completedAt,
    completedAt,
    receivedAt: completedAt,
    createdAt: completedAt,
    updatedAt: completedAt,
  });

const A = '33333333-3333-4333-8333-33333333330a';
const B = '33333333-3333-4333-8333-33333333330b';
const C = '33333333-3333-4333-8333-33333333330c';

describe('who is overdue', () => {
  it('marks a doctor unseen past the threshold', () => {
    const [row] = buildDoctorRows(
      [doctor(A, 'Dr V. Kulkarni')],
      [completedVisit('66666666-6666-4666-8666-666666666601', A, daysAgo(42))],
      NOW,
      ZONE,
    );
    expect(row?.overdue).toBe(true);
    expect(row?.daysSince).toBe(42);
  });

  it('does not mark one seen inside it', () => {
    const [row] = buildDoctorRows(
      [doctor(A, 'Dr S. Iyer')],
      [completedVisit('66666666-6666-4666-8666-666666666601', A, daysAgo(3))],
      NOW,
      ZONE,
    );
    expect(row?.overdue).toBe(false);
  });

  it('counts a doctor never visited as overdue rather than as unknown', () => {
    // A doctor in the territory nobody has been to is the strongest case for going.
    // Leaving them unbadged would hide exactly the row the MR should act on.
    const [row] = buildDoctorRows([doctor(A, 'Dr New')], [], NOW, ZONE);
    expect(row?.overdue).toBe(true);
    expect(row?.daysSince).toBeNull();
  });

  it('uses the most recent completed visit, not the first one found', () => {
    const rows = buildDoctorRows(
      [doctor(A, 'Dr V. Kulkarni')],
      [
        completedVisit('66666666-6666-4666-8666-666666666601', A, daysAgo(60)),
        completedVisit('66666666-6666-4666-8666-666666666602', A, daysAgo(2)),
      ],
      NOW,
      ZONE,
    );
    expect(rows[0]?.daysSince).toBe(2);
    expect(rows[0]?.overdue).toBe(false);
  });

  it('ignores a visit that was never completed', () => {
    // A planned visit is not evidence the MR went. Counting it would silently clear
    // an overdue badge for a doctor nobody actually saw.
    const planned = VisitSchema.parse({
      ...completedVisit('66666666-6666-4666-8666-666666666601', A, daysAgo(1)),
      status: 'planned',
      completedAt: null,
    });
    const [row] = buildDoctorRows([doctor(A, 'Dr V. Kulkarni')], [planned], NOW, ZONE);
    expect(row?.daysSince).toBeNull();
  });

  it('draws the line at the threshold the badge and the filter share', () => {
    const [row] = buildDoctorRows(
      [doctor(A, 'Dr Edge')],
      [completedVisit('66666666-6666-4666-8666-666666666601', A, daysAgo(OVERDUE_AFTER_DAYS))],
      NOW,
      ZONE,
    );
    expect(row?.overdue).toBe(true);
  });
});

/**
 * `FE-W199` — "last seen" counts calendar days in the territory, not elapsed 24-hour periods. It
 * was `Math.floor((now - completedAt) / 24h)`: a visit at 23:38 read at 02:20 said "today".
 */
describe('FE-W199 — last seen is a count of the territory’s calendar days', () => {
  const seenAt = (completedAt: string, now: string, zone: TerritoryZone = ZONE) =>
    buildDoctorRows(
      [doctor(A, 'Dr V. Kulkarni')],
      [completedVisit('66666666-6666-4666-8666-666666666611', A, completedAt)],
      Date.parse(now),
      zone,
    )[0]?.daysSince;

  it('23:38, read at 02:20 the next morning, is yesterday', () => {
    const days = seenAt('2026-10-13T23:38:00+05:30', '2026-10-14T02:20:00+05:30');
    expect(days).toBe(1);
    expect(lastSeenLabel(days ?? null)).toBe('yesterday');
  });

  it('09:00, read at 08:00 two days later, is two days ago -- not yesterday', () => {
    expect(seenAt('2026-10-12T09:00:00+05:30', '2026-10-14T08:00:00+05:30')).toBe(2);
  });

  it('earlier the same day is today', () => {
    const days = seenAt('2026-10-14T00:05:00+05:30', '2026-10-14T23:55:00+05:30');
    expect(days).toBe(0);
    expect(lastSeenLabel(days ?? null)).toBe('today');
  });

  it('across a month end', () => {
    expect(seenAt('2026-10-31T22:00:00+05:30', '2026-11-01T07:00:00+05:30')).toBe(1);
    expect(seenAt('2026-09-30T10:00:00+05:30', '2026-10-02T10:00:00+05:30')).toBe(2);
  });

  it('the territory’s day, where the UTC date differs from India’s', () => {
    // 00:30 IST on 15 Oct is still 14 Oct in UTC; read at 15:30 IST on the 15th.
    const completed = '2026-10-14T19:00:00Z';
    const now = '2026-10-15T10:00:00Z';
    expect(seenAt(completed, now)).toBe(0);
    // POSITIVE CONTROL: the same two instants in UTC are a day apart -- the zone decides.
    expect(seenAt(completed, now, { timeZone: 'UTC', source: 'fallback_utc' })).toBe(1);
  });

  it('seen the same day: the one seen longest ago still comes first', () => {
    const rows = buildDoctorRows(
      [doctor(A, 'Dr Aaa'), doctor(B, 'Dr Bbb')],
      [
        completedVisit('66666666-6666-4666-8666-666666666613', A, '2026-10-14T17:41:00+05:30'),
        completedVisit('66666666-6666-4666-8666-666666666614', B, '2026-10-14T09:00:00+05:30'),
      ],
      Date.parse('2026-10-14T18:00:00+05:30'),
      ZONE,
    );
    expect(rows.map((row) => row.daysSince)).toEqual([0, 0]);
    expect(rankDoctors(rows, '', 'all', new Set()).map((row) => row.name)).toEqual([
      'Dr Bbb',
      'Dr Aaa',
    ]);
  });

  it('no server clock is still no age', () => {
    const [row] = buildDoctorRows(
      [doctor(A, 'Dr V. Kulkarni')],
      [completedVisit('66666666-6666-4666-8666-666666666612', A, '2026-10-13T23:38:00+05:30')],
      null,
      ZONE,
    );
    expect(row?.daysSince).toBeNull();
  });
});

describe('the order of the list', () => {
  const rows = () =>
    buildDoctorRows(
      [doctor(A, 'Dr Aaa'), doctor(B, 'Dr Bbb'), doctor(C, 'Dr Ccc')],
      [
        completedVisit('66666666-6666-4666-8666-666666666601', A, daysAgo(2)),
        completedVisit('66666666-6666-4666-8666-666666666602', B, daysAgo(50)),
      ],
      NOW,
      ZONE,
    );

  it('puts the longest unseen first, and never-visited ahead of all of them', () => {
    const ranked = rankDoctors(rows(), '');
    expect(ranked.map((row) => row.name)).toEqual(['Dr Ccc', 'Dr Bbb', 'Dr Aaa']);
  });

  it('breaks ties by name so the order does not depend on server order', () => {
    const ranked = rankDoctors(
      buildDoctorRows([doctor(B, 'Dr Bbb'), doctor(A, 'Dr Aaa')], [], NOW, ZONE),
      '',
    );
    expect(ranked.map((row) => row.name)).toEqual(['Dr Aaa', 'Dr Bbb']);
  });
});

describe('search', () => {
  const rows = () =>
    buildDoctorRows([doctor(A, 'Dr V. Kulkarni'), doctor(B, 'Dr S. Iyer')], [], NOW, ZONE);

  it('matches on name', () => {
    expect(rankDoctors(rows(), 'kulkarni').map((row) => row.name)).toEqual(['Dr V. Kulkarni']);
  });

  it('matches on area, because that is how an MR standing in one thinks', () => {
    expect(rankDoctors(rows(), 'dadar').length).toBe(2);
  });

  it('matches on specialty', () => {
    expect(rankDoctors(rows(), 'urology').length).toBe(2);
  });

  it('ignores case and surrounding space', () => {
    expect(rankDoctors(rows(), '  IYER ').map((row) => row.name)).toEqual(['Dr S. Iyer']);
  });

  it('returns everything for an empty query rather than nothing', () => {
    expect(rankDoctors(rows(), '').length).toBe(2);
  });
});

describe('how long ago it reads', () => {
  it.each([
    [null, 'never visited'],
    [0, 'today'],
    [1, 'yesterday'],
    [6, '6 days ago'],
    [42, '6 weeks ago'],
    [200, '6 months ago'],
  ])('renders %s as %s', (days, expected) => {
    expect(lastSeenLabel(days)).toBe(expected);
  });
});

describe('the filter chips', () => {
  const rows = () =>
    buildDoctorRows(
      [doctor(A, 'Dr Overdue'), doctor(B, 'Dr Recent')],
      [completedVisit('66666666-6666-4666-8666-666666666602', B, daysAgo(2))],
      NOW,
      ZONE,
    );

  it('shows everything under "all"', () => {
    expect(rankDoctors(rows(), '', 'all').length).toBe(2);
  });

  it('narrows to the overdue under "not seen 30d"', () => {
    expect(rankDoctors(rows(), '', 'overdue').map((row) => row.name)).toEqual(['Dr Overdue']);
  });

  it('narrows to the plan the server approved under "on plan"', () => {
    // The set comes from the caller, which reads it off the beat plan. This module
    // holds no plan and must not guess at one.
    expect(rankDoctors(rows(), '', 'on-plan', new Set([B])).map((row) => row.name)).toEqual([
      'Dr Recent',
    ]);
  });

  it('shows nothing rather than everything when the plan is empty', () => {
    // Falling back to "all" would tell an MR that every doctor is on today's plan.
    expect(rankDoctors(rows(), '', 'on-plan', new Set()).length).toBe(0);
  });

  it('combines with the search rather than replacing it', () => {
    expect(rankDoctors(rows(), 'recent', 'overdue').length).toBe(0);
  });
});
