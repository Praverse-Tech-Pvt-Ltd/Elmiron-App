import { describe, expect, it } from 'vitest';
import { DoctorSchema, VisitSchema } from '@fieldforce/core';
import type { Doctor, Visit } from '@fieldforce/core';
import { clockFrom, summariseDay } from './plan';

/**
 * Inputs are parsed through the contract's own schemas rather than written as
 * literals, the same rule the queue screen's tests follow: a hand-written fixture
 * that drifts from the contract still passes, while a parse that drifts throws.
 */
const visit = (over: Partial<Visit> = {}): Visit =>
  VisitSchema.parse({
    id: '66666666-6666-4666-8666-666666666601',
    mrId: '22222222-2222-4222-8222-222222222202',
    doctorId: '33333333-3333-4333-8333-333333333301',
    beatPlanId: '55555555-5555-4555-8555-555555555501',
    clinicAddressId: '44444444-4444-4444-8444-444444444401',
    status: 'planned',
    scheduledFor: '2026-08-10T10:00:00+05:30',
    startedAt: null,
    completedAt: null,
    receivedAt: '2026-08-10T08:00:00+05:30',
    createdAt: '2026-08-10T08:00:00+05:30',
    updatedAt: '2026-08-10T08:00:00+05:30',
    ...over,
  });

const doctor = (over: Partial<Doctor> = {}): Doctor =>
  DoctorSchema.parse({
    id: '33333333-3333-4333-8333-333333333301',
    fullName: 'Dr Rohini Kulkarni',
    registrationNumber: 'MMC-2011-48213',
    specialty: 'Urology',
    qualification: 'MBBS',
    territoryId: '11111111-1111-4111-8111-111111111103',
    assignedMrId: '22222222-2222-4222-8222-222222222202',
    clinicAddresses: [
      {
        id: '44444444-4444-4444-8444-444444444401',
        doctorId: '33333333-3333-4333-8333-333333333301',
        label: 'Sunrise Clinic',
        line1: '12 Veer Savarkar Marg',
        line2: null,
        city: 'Prabhadevi',
        state: 'Maharashtra',
        postalCode: '400025',
        coordinates: null,
        geofenceRadiusMetres: 120,
      },
    ],
    isActive: true,
    createdAt: '2026-08-01T08:00:00+05:30',
    updatedAt: '2026-08-01T08:00:00+05:30',
    ...over,
  });

describe('what the day counts', () => {
  it('counts completed against everything still on the plan', () => {
    const summary = summariseDay(
      [
        visit({ id: '66666666-6666-4666-8666-666666666601', status: 'completed' }),
        visit({ id: '66666666-6666-4666-8666-666666666602', status: 'completed' }),
        visit({ id: '66666666-6666-4666-8666-666666666603', status: 'planned' }),
      ],
      [doctor()],
    );
    expect(summary.done).toBe(2);
    expect(summary.planned).toBe(3);
  });

  it('drops a cancelled visit from both halves rather than counting it as undone', () => {
    // "2 of 3" when one was cancelled tells the MR they are behind on work that no
    // longer exists. It leaves the denominator entirely.
    const summary = summariseDay(
      [
        visit({ id: '66666666-6666-4666-8666-666666666601', status: 'completed' }),
        visit({ id: '66666666-6666-4666-8666-666666666602', status: 'cancelled' }),
      ],
      [doctor()],
    );
    expect(summary.done).toBe(1);
    expect(summary.planned).toBe(1);
  });
});

describe('which visit is next', () => {
  it('takes the earliest scheduled of those not yet done', () => {
    const summary = summariseDay(
      [
        visit({
          id: '66666666-6666-4666-8666-666666666601',
          scheduledFor: '2026-08-10T15:00:00+05:30',
        }),
        visit({
          id: '66666666-6666-4666-8666-666666666602',
          scheduledFor: '2026-08-10T09:30:00+05:30',
        }),
      ],
      [doctor()],
    );
    expect(summary.next?.visitId).toBe('66666666-6666-4666-8666-666666666602');
  });

  it('puts a visit already in progress ahead of an earlier scheduled one', () => {
    // The MR is standing inside it. Whatever the schedule says, that is the thing
    // they act on next, and sending them to a different clinic would be absurd.
    const summary = summariseDay(
      [
        visit({
          id: '66666666-6666-4666-8666-666666666601',
          scheduledFor: '2026-08-10T09:00:00+05:30',
          status: 'planned',
        }),
        visit({
          id: '66666666-6666-4666-8666-666666666602',
          scheduledFor: '2026-08-10T14:00:00+05:30',
          status: 'in_progress',
        }),
      ],
      [doctor()],
    );
    expect(summary.next?.visitId).toBe('66666666-6666-4666-8666-666666666602');
  });

  it('sorts an unscheduled visit last rather than first', () => {
    // `null` sorting to the front would send the MR to an unplanned visit ahead of
    // a doctor expecting them at 09:30.
    const summary = summariseDay(
      [
        visit({ id: '66666666-6666-4666-8666-666666666601', scheduledFor: null }),
        visit({
          id: '66666666-6666-4666-8666-666666666602',
          scheduledFor: '2026-08-10T09:30:00+05:30',
        }),
      ],
      [doctor()],
    );
    expect(summary.next?.visitId).toBe('66666666-6666-4666-8666-666666666602');
  });

  it('is null when the day is finished', () => {
    const summary = summariseDay([visit({ status: 'completed' })], [doctor()]);
    expect(summary.next).toBeNull();
    expect(summary.done).toBe(1);
  });

  it('names the doctor and the clinic from the address the visit points at', () => {
    const summary = summariseDay([visit()], [doctor()]);
    expect(summary.next?.doctorName).toBe('Dr Rohini Kulkarni');
    expect(summary.next?.clinic).toBe('Sunrise Clinic, Prabhadevi');
  });

  it('says so plainly when the doctor is not in the list it was given', () => {
    // Rendering a blank name would look like a loading state that never resolves.
    const summary = summariseDay([visit()], []);
    expect(summary.next?.doctorName).toBe('Doctor not in your list');
    expect(summary.next?.clinic).toBeNull();
  });
});

describe('the times shown are the server’s', () => {
  it('reports the earliest server-stamped start, not the device clock', () => {
    const summary = summariseDay(
      [
        visit({
          id: '66666666-6666-4666-8666-666666666601',
          status: 'completed',
          startedAt: '2026-08-10T10:04:00+05:30',
        }),
        visit({
          id: '66666666-6666-4666-8666-666666666602',
          status: 'completed',
          startedAt: '2026-08-10T08:55:00+05:30',
        }),
      ],
      [doctor()],
    );
    expect(summary.startedAt).toBe('2026-08-10T08:55:00+05:30');
  });

  it('has no start time before the first visit begins', () => {
    expect(summariseDay([visit({ startedAt: null })], [doctor()]).startedAt).toBeNull();
  });

  it('reads the clock off the timestamp instead of reinterpreting its offset', () => {
    // The offset belongs to the territory, not to the handset. Parsing this through
    // `Date` on a phone set to UTC would render 04:34 and move every visit in the
    // day by five and a half hours.
    expect(clockFrom('2026-08-10T10:04:00+05:30')).toBe('10:04');
  });
});
