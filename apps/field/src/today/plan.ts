import type { Doctor, Visit } from '@fieldforce/core';

/**
 * The day, reduced to what B1 puts on screen.
 *
 * Phase 2 calls Home "the screen everything is judged on", and everything it shows
 * is derived here rather than in the component, so the arithmetic can be tested
 * without a renderer and the component stays a presentation of a value.
 *
 * **Three things this deliberately does not do.**
 *
 * 1. **No distance, no ETA.** B1 draws "11 min by bike" and "2.4 km from here".
 *    Both need the device's position while the app is merely open, and
 *    `fe-w3-spec.md` §4a settled that as discrete fixes only: a position is taken
 *    on a check-in or check-out press and at no other time. These fields are not
 *    "not yet" — under that decision they are never, and the answer is recorded.
 * 2. **No money figure.** B1's ₹412 comes from `daily_mileage()`, which is
 *    server-side and has no endpoint in the contract client today. Inventing a
 *    number on the client for the screen whose whole argument is "this is the
 *    honest answer to what tracking earns you" would be the worst possible place
 *    to guess.
 * 3. **No clock arithmetic.** "Started 8:55" is the earliest `startedAt` the server
 *    stamped, not a duration computed from the device clock — the same rule the
 *    queue screen already follows, and for the same reason.
 */
export interface NextVisit {
  readonly visitId: string;
  readonly doctorName: string;
  /** "Sunrise Clinic, Prabhadevi" — label and city, when the address is known. */
  readonly clinic: string | null;
  /** Server-scheduled time, ISO. Null for an unplanned visit. */
  readonly scheduledFor: string | null;
}

export interface DaySummary {
  /** Visits on today's plan, however they end up. */
  readonly planned: number;
  /** Visits the server has marked completed. */
  readonly done: number;
  /** The next visit to walk to, or null when the day has none left. */
  readonly next: NextVisit | null;
  /** The earliest `startedAt` the server stamped today, ISO. Null before the first. */
  readonly startedAt: string | null;
}

/** `planned` and `cancelled` are both "not done"; only `cancelled` leaves the count. */
const countsTowardTheDay = (visit: Visit): boolean => visit.status !== 'cancelled';

/**
 * Ordered the way the MR walks the day: by the time the server scheduled, with
 * unscheduled visits last. `localeCompare` on the ISO strings rather than `Date`
 * parsing — these are contract-validated ISO-8601 with an offset, and comparing
 * them as text avoids introducing a timezone the server did not send.
 */
const bySchedule = (a: Visit, b: Visit): number => {
  if (a.scheduledFor === null && b.scheduledFor === null) return 0;
  if (a.scheduledFor === null) return 1;
  if (b.scheduledFor === null) return -1;
  return a.scheduledFor.localeCompare(b.scheduledFor);
};

const clinicFor = (doctor: Doctor | undefined, clinicAddressId: string | null): string | null => {
  if (doctor === undefined || clinicAddressId === null) return null;
  const address = doctor.clinicAddresses.find((candidate) => candidate.id === clinicAddressId);
  return address === undefined ? null : `${address.label}, ${address.city}`;
};

export const summariseDay = (visits: readonly Visit[], doctors: readonly Doctor[]): DaySummary => {
  const counted = visits.filter(countsTowardTheDay);
  const byId = new Map(doctors.map((doctor) => [doctor.id, doctor]));

  // `in_progress` comes before `planned`: a visit the MR is standing inside is the
  // next thing they act on, whatever the schedule says.
  const remaining = counted
    .filter((visit) => visit.status === 'planned' || visit.status === 'in_progress')
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'in_progress' ? -1 : 1;
      return bySchedule(a, b);
    });

  const head = remaining[0];
  const startedTimes = counted
    .map((visit) => visit.startedAt)
    .filter((at): at is string => at !== null)
    .sort();

  return {
    planned: counted.length,
    done: counted.filter((visit) => visit.status === 'completed').length,
    startedAt: startedTimes[0] ?? null,
    next:
      head === undefined
        ? null
        : {
            visitId: head.id,
            doctorName: byId.get(head.doctorId)?.fullName ?? 'Doctor not in your list',
            clinic: clinicFor(byId.get(head.doctorId), head.clinicAddressId),
            scheduledFor: head.scheduledFor,
          },
  };
};

/**
 * "10:04" from a contract ISO timestamp, by reading the characters rather than
 * parsing a `Date`.
 *
 * The contract sends an offset (`2026-08-10T10:04:00+05:30`), and that offset is
 * the territory's, not the handset's. `toLocaleTimeString` would re-express it in
 * whatever timezone the phone is set to, which for an MR whose phone is on the
 * wrong timezone silently moves every visit in the day. Slicing keeps the time the
 * server meant.
 */
export const clockFrom = (iso: string): string => iso.slice(11, 16);
