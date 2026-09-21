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
    notMetReason: null,
    scheduledFor: '2026-08-10T10:00:00+05:30',
    startedAt: null,
    completedAt: null,
    // MR-48. The server's day for this visit (`visit_day()`), which Today now reads.
    visitDay: '2026-08-10',
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

/**
 * The day these fixtures belong to.
 *
 * MR-14 B5 gave `summariseDay` a day to scope to, because nothing filtered by date before
 * it and the pull's store accumulates across days. Passed explicitly here so these cases
 * keep testing the arithmetic rather than silently becoming "is the fixture date today?"
 * — which would have started failing the morning after they were written.
 */
const DAY = '2026-08-10';

describe('MR-12 D3 — a not-met visit is attended, not undone', () => {
  it('counts not_met separately from completed, and neither as the other', () => {
    const summary = summariseDay(
      [
        visit({ id: '66666666-6666-4666-8666-666666666601', status: 'completed' }),
        visit({
          id: '66666666-6666-4666-8666-666666666602',
          status: 'not_met',
          notMetReason: 'Doctor called into theatre',
        }),
        visit({ id: '66666666-6666-4666-8666-666666666603', status: 'planned' }),
      ],
      [doctor()],
      DAY,
    );
    expect(summary.planned).toBe(3);
    expect(summary.done, 'a not-met visit was counted as completed').toBe(1);
    expect(summary.notMet).toBe(1);
  });

  it('leaves a not-met visit out of what is still to walk to', () => {
    // The MR has BEEN there. Offering it as the next stop would send them back to a
    // clinic they have already left.
    const summary = summariseDay(
      [
        visit({
          id: '66666666-6666-4666-8666-666666666601',
          status: 'not_met',
          notMetReason: 'Doctor called into theatre',
        }),
      ],
      [doctor()],
      DAY,
    );
    expect(summary.next).toBeNull();
  });
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
      DAY,
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
      DAY,
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
          notMetReason: null,
          scheduledFor: '2026-08-10T15:00:00+05:30',
        }),
        visit({
          id: '66666666-6666-4666-8666-666666666602',
          notMetReason: null,
          scheduledFor: '2026-08-10T09:30:00+05:30',
        }),
      ],
      [doctor()],
      DAY,
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
          notMetReason: null,
          scheduledFor: '2026-08-10T09:00:00+05:30',
          status: 'planned',
        }),
        visit({
          id: '66666666-6666-4666-8666-666666666602',
          notMetReason: null,
          scheduledFor: '2026-08-10T14:00:00+05:30',
          status: 'in_progress',
        }),
      ],
      [doctor()],
      DAY,
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
          notMetReason: null,
          scheduledFor: '2026-08-10T09:30:00+05:30',
        }),
      ],
      [doctor()],
      DAY,
    );
    expect(summary.next?.visitId).toBe('66666666-6666-4666-8666-666666666602');
  });

  it('is null when the day is finished', () => {
    const summary = summariseDay([visit({ status: 'completed' })], [doctor()], DAY);
    expect(summary.next).toBeNull();
    expect(summary.done).toBe(1);
  });

  it('names the doctor and the clinic from the address the visit points at', () => {
    const summary = summariseDay([visit()], [doctor()], DAY);
    expect(summary.next?.doctorName).toBe('Dr Rohini Kulkarni');
    expect(summary.next?.clinic).toBe('Sunrise Clinic, Prabhadevi');
  });

  it('says so plainly when the doctor is not in the list it was given', () => {
    // Rendering a blank name would look like a loading state that never resolves.
    const summary = summariseDay([visit()], [], DAY);
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
      DAY,
    );
    expect(summary.startedAt).toBe('2026-08-10T08:55:00+05:30');
  });

  it('has no start time before the first visit begins', () => {
    expect(summariseDay([visit({ startedAt: null })], [doctor()], DAY).startedAt).toBeNull();
  });

  it('reads the clock off the timestamp instead of reinterpreting its offset', () => {
    // The offset belongs to the territory, not to the handset. Parsing this through
    // `Date` on a phone set to UTC would render 04:34 and move every visit in the
    // day by five and a half hours.
    expect(clockFrom('2026-08-10T10:04:00+05:30')).toBe('10:04');
  });
});

/**
 * MR-14 B5 — "Today" means today.
 *
 * Nothing filtered by date before the read conversion, and with the mock nothing had to:
 * the fixture was one day, so every visit the client held was today's by construction.
 * `sync_pull` carries no date filter and the local store accumulates, so on the second day
 * of use the screen counted every visit the MR had ever been sent.
 *
 * Measured on the emulator on 10 September against a store seeded on the 9th: **"Today ·
 * 2 of 3 visits attended"**, and a primary action offering **"Start the visit to Dr Meera
 * Iyer · Scheduled 07:30"** — a visit scheduled the previous day. The MR had nothing that
 * day at all.
 */
describe('the day is scoped to the day', () => {
  const YESTERDAY = '2026-08-09';

  it('leaves out a visit scheduled on another day, however it ended', () => {
    const summary = summariseDay(
      [
        visit({ id: '66666666-6666-4666-8666-666666666601', status: 'completed' }),
        visit({
          id: '66666666-6666-4666-8666-666666666602',
          status: 'planned',
          scheduledFor: `${YESTERDAY}T09:00:00+05:30`,
          visitDay: YESTERDAY,
        }),
      ],
      [doctor()],
      DAY,
    );
    expect(summary.planned).toBe(1);
    expect(summary.done).toBe(1);
  });

  it("does not offer yesterday's visit as the next one to walk to", () => {
    // The damaging half. A count that is too high is a wrong number; a primary action
    // that sends an MR to a clinic for a visit that was yesterday is a wasted journey.
    const summary = summariseDay(
      [
        visit({
          id: '66666666-6666-4666-8666-666666666602',
          status: 'planned',
          scheduledFor: `${YESTERDAY}T07:30:00+05:30`,
          visitDay: YESTERDAY,
        }),
      ],
      [doctor()],
      DAY,
    );
    expect(summary.next).toBeNull();
    expect(summary.planned).toBe(0);
  });

  it('KEEPS the visits that are on the day — the positive control', () => {
    // Without this, a filter that dropped everything would pass both cases above while
    // making the screen permanently empty.
    const summary = summariseDay(
      [
        visit({ id: '66666666-6666-4666-8666-666666666601', status: 'planned' }),
        visit({ id: '66666666-6666-4666-8666-666666666602', status: 'completed' }),
      ],
      [doctor()],
      DAY,
    );
    expect(summary.planned).toBe(2);
    expect(summary.done).toBe(1);
    expect(summary.next?.visitId).toBe('66666666-6666-4666-8666-666666666601');
  });

  it("dates an unscheduled visit by the server's start stamp", () => {
    // An unplanned visit has no `scheduledFor`. It is still work the MR did today, and
    // `startedAt` is the server's own stamp for when.
    const summary = summariseDay(
      [
        visit({
          id: '66666666-6666-4666-8666-666666666603',
          status: 'completed',
          scheduledFor: null,
          startedAt: `${DAY}T11:00:00+05:30`,
          visitDay: DAY,
        }),
      ],
      [doctor()],
      DAY,
    );
    expect(summary.done).toBe(1);
  });

  it('does not claim an undated visit for today', () => {
    // Neither scheduled nor started. Nothing says it belongs to this day, and asserting
    // that it does would be presenting an absence as a fact — the same rule B4 applies to
    // a clinic address.
    const summary = summariseDay(
      [
        visit({
          id: '66666666-6666-4666-8666-666666666604',
          status: 'planned',
          scheduledFor: null,
          startedAt: null,
          visitDay: null,
        }),
      ],
      [doctor()],
      DAY,
    );
    expect(summary.planned).toBe(0);
    expect(summary.next).toBeNull();
  });

  it('follows the SERVER’s day at 18:45Z, where UTC and IST disagree — either way', () => {
    // MR-48. 18:45Z on the 9th is 00:15 IST on the 10th. Which date that is belongs to
    // `visit_day()`, in the MR's territory zone. Today must follow the server's answer and
    // never re-decide it from the instant: the same visit is today's when the server says the
    // 10th, and not when it says the 9th (the UTC fallback).
    const at = '2026-08-09T18:45:00+00:00';
    const onThe = (visitDay: string): number =>
      summariseDay(
        [visit({ id: '66666666-6666-4666-8666-666666666605', scheduledFor: at, visitDay })],
        [doctor()],
        DAY,
      ).planned;
    expect(onThe('2026-08-10')).toBe(1);
    expect(onThe('2026-08-09')).toBe(0);
  });
});

/**
 * MR-48 — `FE-W57`, the case the Pixel 10 found. An MR checked in on the 21st to a visit
 * scheduled for the 16th saw "Nothing planned for today · 0 of 0", and since Today's
 * next-visit card is the only way into a visit, check-out was unreachable.
 */
describe('a visit in progress is always on Today, whatever its date', () => {
  const EARLIER = '2026-08-05';

  it('SHOWS an in-progress visit whose day is an earlier one, and offers it as next', () => {
    const summary = summariseDay(
      [
        visit({
          id: '66666666-6666-4666-8666-666666666606',
          status: 'in_progress',
          scheduledFor: `${EARLIER}T10:00:00+05:30`,
          startedAt: `${EARLIER}T10:05:00+05:30`,
          visitDay: EARLIER,
        }),
      ],
      [doctor()],
      DAY,
    );
    expect(summary.next?.visitId).toBe('66666666-6666-4666-8666-666666666606');
    expect(summary.planned).toBe(1);
  });

  it('shows it even when the server has not sent its day', () => {
    const summary = summariseDay(
      [
        visit({
          id: '66666666-6666-4666-8666-666666666607',
          status: 'in_progress',
          visitDay: null,
        }),
      ],
      [doctor()],
      DAY,
    );
    expect(summary.next?.visitId).toBe('66666666-6666-4666-8666-666666666607');
  });

  it('a COMPLETED visit from an earlier day stays off Today — only in-progress is exempt', () => {
    const summary = summariseDay(
      [
        visit({
          id: '66666666-6666-4666-8666-666666666609',
          status: 'completed',
          scheduledFor: `${EARLIER}T10:00:00+05:30`,
          completedAt: `${EARLIER}T10:40:00+05:30`,
          visitDay: EARLIER,
        }),
      ],
      [doctor()],
      DAY,
    );
    expect(summary.done).toBe(0);
    expect(summary.planned).toBe(0);
  });

  it('NEGATIVE CONTROL: a PLANNED visit from an earlier day stays off Today', () => {
    // Without this, "show everything" would pass the two cases above — and send the MR to a
    // clinic for yesterday's visit, MR-14's defect.
    const summary = summariseDay(
      [
        visit({
          id: '66666666-6666-4666-8666-666666666608',
          status: 'planned',
          scheduledFor: `${EARLIER}T10:00:00+05:30`,
          visitDay: EARLIER,
        }),
      ],
      [doctor()],
      DAY,
    );
    expect(summary.next).toBeNull();
    expect(summary.planned).toBe(0);
  });
});
