import { describe, expect, it } from 'vitest';
import { DoctorSchema, VisitSchema } from '@fieldforce/core';
import type { Doctor, Visit } from '@fieldforce/core';
import { OVERDUE_AFTER_DAYS, buildDoctorRows, lastSeenLabel, rankDoctors } from './list';

const NOW = Date.parse('2026-08-10T12:00:00+05:30');
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
    );
    expect(row?.overdue).toBe(true);
    expect(row?.daysSince).toBe(42);
  });

  it('does not mark one seen inside it', () => {
    const [row] = buildDoctorRows(
      [doctor(A, 'Dr S. Iyer')],
      [completedVisit('66666666-6666-4666-8666-666666666601', A, daysAgo(3))],
      NOW,
    );
    expect(row?.overdue).toBe(false);
  });

  it('counts a doctor never visited as overdue rather than as unknown', () => {
    // A doctor in the territory nobody has been to is the strongest case for going.
    // Leaving them unbadged would hide exactly the row the MR should act on.
    const [row] = buildDoctorRows([doctor(A, 'Dr New')], [], NOW);
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
    const [row] = buildDoctorRows([doctor(A, 'Dr V. Kulkarni')], [planned], NOW);
    expect(row?.daysSince).toBeNull();
  });

  it('draws the line at the threshold the badge and the filter share', () => {
    const [row] = buildDoctorRows(
      [doctor(A, 'Dr Edge')],
      [completedVisit('66666666-6666-4666-8666-666666666601', A, daysAgo(OVERDUE_AFTER_DAYS))],
      NOW,
    );
    expect(row?.overdue).toBe(true);
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
    );

  it('puts the longest unseen first, and never-visited ahead of all of them', () => {
    const ranked = rankDoctors(rows(), '');
    expect(ranked.map((row) => row.name)).toEqual(['Dr Ccc', 'Dr Bbb', 'Dr Aaa']);
  });

  it('breaks ties by name so the order does not depend on server order', () => {
    const ranked = rankDoctors(
      buildDoctorRows([doctor(B, 'Dr Bbb'), doctor(A, 'Dr Aaa')], [], NOW),
      '',
    );
    expect(ranked.map((row) => row.name)).toEqual(['Dr Aaa', 'Dr Bbb']);
  });
});

describe('search', () => {
  const rows = () =>
    buildDoctorRows([doctor(A, 'Dr V. Kulkarni'), doctor(B, 'Dr S. Iyer')], [], NOW);

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
