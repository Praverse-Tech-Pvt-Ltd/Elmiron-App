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
  /**
   * MR-14 B4. The address is expected and has not arrived yet.
   *
   * **`clinic: null` used to mean two different things** — this visit has no clinic
   * address, and this visit's clinic address has not synced — and the screen rendered
   * both as a missing line. The second is a temporary state of the client, not a fact
   * about the day, and telling an MR nothing when the answer is "wait a moment" is the
   * same class of error as showing them a wrong address.
   *
   * A doctor and their addresses are independent rows in one cursor-ordered stream, so
   * this window is real rather than theoretical. `clinic` is always null when this is
   * true: the rule is never a wrong address, and never an empty one presented as fact.
   */
  readonly clinicPending: boolean;
  /** Server-scheduled time, ISO. Null for an unplanned visit. */
  readonly scheduledFor: string | null;
}

export interface DaySummary {
  /** Visits on today's plan, however they end up. */
  readonly planned: number;
  /** Visits the server has marked completed. */
  readonly done: number;
  /**
   * Visits the MR ATTENDED where the doctor was not available.
   *
   * Kept separate from `done` rather than added to it, so the screen can count attendance
   * (`done + notMet`) while still being able to say how many doctors were not there. A
   * single merged number could not tell an MR why their day looks the way it does.
   */
  readonly notMet: number;
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

/**
 * The clinic line, and whether its absence is a fact or a wait — B4.
 *
 * Three outcomes, and they are genuinely different things to an MR standing in the street:
 *
 *   * a label            — the address is known;
 *   * nothing, settled   — the visit carries no clinic address at all, so there is nothing
 *                          to show and nothing to wait for;
 *   * nothing, pending   — the visit names an address that has not arrived, or names a
 *                          doctor who has not arrived. It is coming.
 *
 * The pending case is decided by `clinicAddressId` being set and unresolvable, which needs
 * no extra parameter: the visit itself says whether an address is expected.
 */
const clinicFor = (
  doctor: Doctor | undefined,
  clinicAddressId: string | null,
): { readonly label: string | null; readonly pending: boolean } => {
  // The visit names no clinic address. Nothing is missing and nothing is coming.
  if (clinicAddressId === null) return { label: null, pending: false };
  // An address is expected. Until the doctor and the address are both here, it is pending
  // rather than absent -- including when the doctor row itself has not arrived, because
  // the addresses travel with neither of them guaranteed to be first.
  if (doctor === undefined) return { label: null, pending: true };
  const address = doctor.clinicAddresses.find((candidate) => candidate.id === clinicAddressId);
  return address === undefined
    ? { label: null, pending: true }
    : { label: `${address.label}, ${address.city}`, pending: false };
};

const nextVisitFrom = (visit: Visit, doctor: Doctor | undefined): NextVisit => {
  const clinic = clinicFor(doctor, visit.clinicAddressId);
  return {
    visitId: visit.id,
    doctorName: doctor?.fullName ?? 'Doctor not in your list',
    clinic: clinic.label,
    clinicPending: clinic.pending,
    scheduledFor: visit.scheduledFor,
  };
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
    notMet: counted.filter((visit) => visit.status === 'not_met').length,
    startedAt: startedTimes[0] ?? null,
    next: head === undefined ? null : nextVisitFrom(head, byId.get(head.doctorId)),
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
