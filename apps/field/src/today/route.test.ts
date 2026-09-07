import { describe, expect, it } from 'vitest';
import { BeatPlanSchema, DoctorSchema, VisitSchema } from '@fieldforce/core';
import type { BeatPlan, Doctor, Visit } from '@fieldforce/core';
import { buildDayRoute } from './route';

const PLAN = '55555555-5555-4555-8555-555555555501';
const D1 = '33333333-3333-4333-8333-333333333301';
const D2 = '33333333-3333-4333-8333-333333333302';
const D3 = '33333333-3333-4333-8333-333333333303';

const doctor = (id: string, name: string): Doctor =>
  DoctorSchema.parse({
    id,
    fullName: name,
    registrationNumber: null,
    specialty: 'Urology',
    qualification: null,
    territoryId: '11111111-1111-4111-8111-111111111103',
    assignedMrId: '22222222-2222-4222-8222-222222222202',
    clinicAddresses: [],
    isActive: true,
    createdAt: '2026-01-01T08:00:00+05:30',
    updatedAt: '2026-01-01T08:00:00+05:30',
  });

const entry = (id: string, doctorId: string, plannedSequence: number) => ({
  id,
  beatPlanId: PLAN,
  doctorId,
  clinicAddressId: null,
  plannedSequence,
});

const plan = (entries: readonly ReturnType<typeof entry>[]): BeatPlan =>
  BeatPlanSchema.parse({
    id: PLAN,
    mrId: '22222222-2222-4222-8222-222222222202',
    territoryId: '11111111-1111-4111-8111-111111111103',
    planDate: '2026-08-10',
    status: 'approved',
    approvedByUserId: '22222222-2222-4222-8222-222222222201',
    approvedAt: '2026-08-10T08:45:00+05:30',
    version: 1,
    supersedesBeatPlanId: null,
    entries,
    createdAt: '2026-08-10T08:00:00+05:30',
    updatedAt: '2026-08-10T08:45:00+05:30',
  });

const visit = (id: string, doctorId: string, over: Partial<Visit> = {}): Visit =>
  VisitSchema.parse({
    id,
    mrId: '22222222-2222-4222-8222-222222222202',
    doctorId,
    beatPlanId: PLAN,
    clinicAddressId: null,
    status: 'completed',
    scheduledFor: null,
    startedAt: '2026-08-10T09:20:00+05:30',
    completedAt: '2026-08-10T09:28:00+05:30',
    receivedAt: '2026-08-10T09:29:00+05:30',
    createdAt: '2026-08-10T08:00:00+05:30',
    updatedAt: '2026-08-10T09:29:00+05:30',
    ...over,
  });

const E1 = '55555555-5555-4555-8555-555555555511';
const E2 = '55555555-5555-4555-8555-555555555512';
const E3 = '55555555-5555-4555-8555-555555555513';
const V1 = '66666666-6666-4666-8666-666666666601';
const V2 = '66666666-6666-4666-8666-666666666602';

const doctors = [doctor(D1, 'Dr A. Menon'), doctor(D2, 'Dr R. Banerjee'), doctor(D3, 'Dr P. Nair')];

describe('the order is the server’s', () => {
  it('follows plannedSequence, not the order the entries arrived in', () => {
    // The client does not decide what an MR's day is. Re-sorting here — by name, by
    // distance, by anything — would be the app quietly rewriting an approved plan.
    const route = buildDayRoute(
      plan([entry(E3, D3, 2), entry(E1, D1, 0), entry(E2, D2, 1)]),
      [],
      doctors,
      [],
    );
    expect(route.stops.map((stop) => stop.doctorName)).toEqual([
      'Dr A. Menon',
      'Dr R. Banerjee',
      'Dr P. Nair',
    ]);
  });

  it('is empty, not broken, when no plan came through', () => {
    const route = buildDayRoute(null, [], doctors, []);
    expect(route.stops).toEqual([]);
    expect(route.planned).toBe(0);
  });
});

describe('exactly one stop is current', () => {
  it('promotes the first unvisited stop when nothing is in progress', () => {
    const route = buildDayRoute(
      plan([entry(E1, D1, 0), entry(E2, D2, 1), entry(E3, D3, 2)]),
      [visit(V1, D1)],
      doctors,
      [],
    );
    expect(route.stops.map((stop) => stop.state)).toEqual(['done', 'current', 'upcoming']);
  });

  it('prefers a visit actually in progress over the next planned one', () => {
    // The MR is standing inside it. A screen that made an earlier stop the card
    // would be pointing them at a clinic they have already left.
    const route = buildDayRoute(
      plan([entry(E1, D1, 0), entry(E2, D2, 1), entry(E3, D3, 2)]),
      [visit(V1, D3, { status: 'in_progress', completedAt: null })],
      doctors,
      [],
    );
    expect(route.stops.map((stop) => stop.state)).toEqual(['upcoming', 'upcoming', 'current']);
    expect(route.stops.filter((stop) => stop.state === 'current').length).toBe(1);
  });

  it('leaves no stop current once the day is finished', () => {
    const route = buildDayRoute(plan([entry(E1, D1, 0)]), [visit(V1, D1)], doctors, []);
    expect(route.stops.every((stop) => stop.state === 'done')).toBe(true);
  });
});

describe('what the header counts', () => {
  it('counts done against the stops still on the plan', () => {
    const route = buildDayRoute(
      plan([entry(E1, D1, 0), entry(E2, D2, 1)]),
      [visit(V1, D1)],
      doctors,
      [],
    );
    expect(route.done).toBe(1);
    expect(route.planned).toBe(2);
  });

  it('drops a cancelled stop from the denominator rather than counting it undone', () => {
    // "1 of 2" for a visit somebody called off tells the MR they are behind on work
    // that no longer exists.
    const route = buildDayRoute(
      plan([entry(E1, D1, 0), entry(E2, D2, 1)]),
      [visit(V1, D1), visit(V2, D2, { status: 'cancelled', completedAt: null })],
      doctors,
      [],
    );
    expect(route.done).toBe(1);
    expect(route.planned).toBe(1);
    // It still appears on the timeline — the MR should see it was called off.
    expect(route.stops.length).toBe(2);
  });
});

describe('each stop carries what happened there', () => {
  it('reports the duration from the server’s own start and finish', () => {
    const route = buildDayRoute(plan([entry(E1, D1, 0)]), [visit(V1, D1)], doctors, []);
    expect(route.stops[0]?.minutes).toBe(8);
    expect(route.stops[0]?.startedAt).toBe('2026-08-10T09:20:00+05:30');
  });

  it('names a doctor missing from the list rather than rendering a blank row', () => {
    const route = buildDayRoute(plan([entry(E1, D1, 0)]), [], [], []);
    expect(route.stops[0]?.doctorName).toBe('Doctor not in your list');
  });

  it('has no distance or travel estimate to render', () => {
    // §4's open question. Asserted on the shape so that adding a distance field
    // fails here rather than quietly shipping a position fix nobody approved.
    const route = buildDayRoute(plan([entry(E1, D1, 0)]), [visit(V1, D1)], doctors, []);
    expect(Object.keys(route.stops[0] ?? {}).sort()).toEqual([
      'clinic',
      'consent',
      'doctorId',
      'doctorName',
      'minutes',
      'startedAt',
      'state',
    ]);
  });
});
