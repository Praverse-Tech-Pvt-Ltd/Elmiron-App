import type { BeatPlan, ConsentOutcome, ConsentRecord, Doctor, Visit } from '@fieldforce/core';

/**
 * B3 — the beat plan as a timeline.
 *
 * **A timeline, not a map, and the design says why:** maps are slow on a mid-range
 * phone, costly on data, and a breadcrumb trail of where an MR has been is the
 * surveillance read of this product. There is no map here and no route geometry to
 * draw one from.
 *
 * **What B3 draws that this cannot supply.**
 *
 * - **"31.7 km"** in the header, and the per-leg distances ("2.4 km", "5.1 km on
 *   from Iyer"). Distance needs positions — `fe-w3-spec.md` §4's open question —
 *   and the day's total is `daily_mileage()`, server-side, with no endpoint.
 * - **"Best window 12:00–13:00"** is the same behavioural inference as B9's "best
 *   time to catch him", raised for a human decision and deliberately absent.
 * - **"Closes at 14:00"** would need clinic opening hours. `ClinicAddress` has no
 *   such field, so there is nothing to read.
 *
 * The order comes from `plannedSequence` on the server's approved plan, never from
 * anything computed here. A `BeatPlan` carries `version` and `supersedesBeatPlanId`
 * — a changed plan is a new row, not an edit — so the client's job is to render the
 * one the server approved, in the order it gave.
 */
/**
 * MR-12 D3. `not_met` is its own state on the route, never folded into `done`.
 *
 * Folding it in is the copy defect in map form: a stop the MR walked to and found empty
 * would render identically to one where the doctor was seen, and the route would agree
 * with a screen that congratulated them.
 */
export type StopState = 'done' | 'current' | 'upcoming' | 'cancelled' | 'not_met';

export interface RouteStop {
  readonly doctorId: string;
  readonly doctorName: string;
  readonly clinic: string | null;
  readonly state: StopState;
  /** Server-stamped start, ISO. Present once the visit began. */
  readonly startedAt: string | null;
  /** Whole minutes, once the visit finished. */
  readonly minutes: number | null;
  readonly consent: ConsentOutcome | null;
}

export interface DayRoute {
  readonly planned: number;
  readonly done: number;
  readonly stops: readonly RouteStop[];
}

const MS_PER_MINUTE = 60 * 1000;

const minutesBetween = (startedAt: string | null, completedAt: string | null): number | null => {
  if (startedAt === null || completedAt === null) return null;
  const span = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  return span < 0 ? null : Math.round(span / MS_PER_MINUTE);
};

const clinicOf = (doctor: Doctor | undefined, clinicAddressId: string | null): string | null => {
  if (doctor === undefined) return null;
  const address =
    clinicAddressId === null
      ? doctor.clinicAddresses[0]
      : doctor.clinicAddresses.find((candidate) => candidate.id === clinicAddressId);
  return address === undefined ? null : `${address.label}, ${address.city}`;
};

const stateOf = (visit: Visit | undefined): StopState => {
  if (visit === undefined) return 'upcoming';
  switch (visit.status) {
    case 'completed':
      return 'done';
    case 'in_progress':
      return 'current';
    case 'cancelled':
      return 'cancelled';
    case 'planned':
      return 'upcoming';
    case 'not_met':
      return 'not_met';
    default: {
      // MR-12 Part B. This switch already failed the build on a new member -- as TS2366,
      // "Function lacks ending return statement", which names the wrong problem and whose
      // obvious fix removes the guard. Now it names the member.
      const unhandled: never = visit.status;
      throw new Error(`unhandled visit status: ${String(unhandled)}`);
    }
  }
};

export const buildDayRoute = (
  plan: BeatPlan | null,
  visits: readonly Visit[],
  doctors: readonly Doctor[],
  consents: readonly ConsentRecord[],
): DayRoute => {
  const doctorById = new Map(doctors.map((doctor) => [doctor.id, doctor]));

  const visitByDoctor = new Map<string, Visit>();
  for (const visit of visits) {
    const held = visitByDoctor.get(visit.doctorId);
    // Latest wins, so a doctor visited twice in a day shows the current attempt
    // rather than whichever the server happened to send first.
    if (held === undefined || held.createdAt.localeCompare(visit.createdAt) < 0) {
      visitByDoctor.set(visit.doctorId, visit);
    }
  }

  const consentByVisit = new Map<string, ConsentRecord>();
  for (const record of consents) {
    const held = consentByVisit.get(record.visitId);
    if (held === undefined || held.receivedAt.localeCompare(record.receivedAt) < 0) {
      consentByVisit.set(record.visitId, record);
    }
  }

  const entries = (plan?.entries ?? [])
    .slice()
    .sort((a, b) => a.plannedSequence - b.plannedSequence);

  const stops: RouteStop[] = entries.map((entry) => {
    const visit = visitByDoctor.get(entry.doctorId);
    const doctor = doctorById.get(entry.doctorId);
    return {
      doctorId: entry.doctorId,
      doctorName: doctor?.fullName ?? 'Doctor not in your list',
      clinic: clinicOf(doctor, entry.clinicAddressId),
      state: stateOf(visit),
      startedAt: visit?.startedAt ?? null,
      minutes: minutesBetween(visit?.startedAt ?? null, visit?.completedAt ?? null),
      consent: visit === undefined ? null : (consentByVisit.get(visit.id)?.outcome ?? null),
    };
  });

  // Only one stop is ever "current". With nothing in progress, the first upcoming
  // stop becomes the current one — B3 makes exactly one stop a card, because a
  // screen with three cards has told the MR nothing about what to do next.
  const hasInProgress = stops.some((stop) => stop.state === 'current');
  const promoted = hasInProgress
    ? stops
    : stops.map((stop, index) =>
        stop.state === 'upcoming' &&
        stops.findIndex((candidate) => candidate.state === 'upcoming') === index
          ? { ...stop, state: 'current' as const }
          : stop,
      );

  const counted = promoted.filter((stop) => stop.state !== 'cancelled');

  return {
    planned: counted.length,
    done: counted.filter((stop) => stop.state === 'done').length,
    stops: promoted,
  };
};
