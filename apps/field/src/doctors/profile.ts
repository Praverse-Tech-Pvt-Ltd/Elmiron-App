import type { ConsentOutcome, ConsentRecord, Doctor, Visit } from '@fieldforce/core';

/**
 * B9 — the doctor profile, from the MR's own visit history.
 *
 * **Read the design's closing line before changing anything here.** B9 ends with
 * "Nothing here about what he prescribes, and nothing about his patients. Neither is
 * recorded anywhere in this app," and the design's note says why it is written down
 * rather than assumed: *a profile screen is exactly where prescriber profiling would
 * creep in*. Every field below is about **the MR's own visits** — when they went,
 * how long they stayed, what the doctor answered about recording. None of it is
 * about the doctor's practice, and there is no field here to put it in.
 *
 * **Two things B9 draws that are not built.**
 *
 * 1. **"0.4 km from here"** needs the device's position — the open policy question
 *    in `fe-w3-spec.md` §4.
 * 2. **"Best time to catch him — Tuesdays and Thursdays, 11:30–13:00"**, derived
 *    from the last five visits. That is behavioural inference about a named third
 *    party who is not this app's user and has consented to nothing, and it was
 *    raised for a human decision rather than assumed. It is deliberately absent
 *    until that decision is made.
 */
export interface ProfileVisit {
  readonly visitId: string;
  /** ISO of completion, for the caller to format. */
  readonly completedAt: string;
  /**
   * ISO of the server-stamped start. Availability keys off when a visit BEGAN —
   * when the MR was let in — rather than when it ended, which also depends on how
   * long the doctor talked.
   */
  readonly startedAt: string | null;
  /** Whole minutes between start and completion, or null when either is missing. */
  readonly minutes: number | null;
  /** What the doctor answered about recording. Null when nothing was recorded. */
  readonly consent: ConsentOutcome | null;
}

export interface DoctorProfile {
  readonly id: string;
  readonly name: string;
  /** "Urology · Kulkarni Clinic, Dadar West" */
  readonly detail: string;
  readonly daysSince: number | null;
  /** Most recent first. B9 shows three; the caller decides how many to render. */
  readonly recentVisits: readonly ProfileVisit[];
}

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

const minutesBetween = (startedAt: string | null, completedAt: string | null): number | null => {
  if (startedAt === null || completedAt === null) return null;
  const span = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  // A negative span means the clocks disagreed. Rendering "-3 min" would be worse
  // than rendering nothing, and there is no honest way to correct it here.
  return span < 0 ? null : Math.round(span / MS_PER_MINUTE);
};

const addressOf = (doctor: Doctor): string | null => {
  const address = doctor.clinicAddresses[0];
  return address === undefined ? null : `${address.label}, ${address.city}`;
};

export const buildDoctorProfile = (
  doctor: Doctor,
  visits: readonly Visit[],
  consents: readonly ConsentRecord[],
  now: number,
): DoctorProfile => {
  // Consent is looked up per visit rather than per doctor: a withdrawal supersedes
  // an earlier row without touching it, so the *latest* row for a visit is the one
  // that describes where that visit stands.
  //
  // Ordered by `receivedAt` — "when the server took delivery", server-stamped —
  // rather than `capturedAt`, which is the device's clock. Two records from two
  // phones with drifting clocks would otherwise resolve in whichever order the
  // drift happened to imply, and getting this backwards means showing a consent
  // the doctor has since withdrawn.
  const consentByVisit = new Map<string, ConsentRecord>();
  for (const record of consents) {
    const held = consentByVisit.get(record.visitId);
    if (held === undefined || held.receivedAt.localeCompare(record.receivedAt) < 0) {
      consentByVisit.set(record.visitId, record);
    }
  }

  const completed = visits
    .filter(
      (visit): visit is Visit & { completedAt: string } =>
        visit.doctorId === doctor.id && visit.status === 'completed' && visit.completedAt !== null,
    )
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt));

  const latest = completed[0];

  return {
    id: doctor.id,
    name: doctor.fullName,
    detail: [doctor.specialty, addressOf(doctor)]
      .filter((part): part is string => part !== null)
      .join(' · '),
    daysSince:
      latest === undefined
        ? null
        : Math.floor((now - new Date(latest.completedAt).getTime()) / MS_PER_DAY),
    recentVisits: completed.map((visit) => ({
      visitId: visit.id,
      completedAt: visit.completedAt,
      startedAt: visit.startedAt,
      minutes: minutesBetween(visit.startedAt, visit.completedAt),
      consent: consentByVisit.get(visit.id)?.outcome ?? null,
    })),
  };
};

/**
 * The words for a consent outcome, from the doctor's side of it.
 *
 * `not_asked` is not a failure and is never rendered as one — the contract's own
 * comment on `notAskedReason` says it is "never a penalty field", and an MR who did
 * not ask has done nothing wrong.
 */
export const consentLabel = (outcome: ConsentOutcome | null): string | null => {
  switch (outcome) {
    case 'consented':
      return 'agreed to recording';
    case 'declined':
      return 'declined recording';
    case 'not_asked':
      return 'not asked';
    case null:
      return null;
  }
};

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * "3 Jul" from a contract ISO timestamp, read off the characters.
 *
 * Same rule as `clockFrom` in `src/today/plan.ts`: the offset in the timestamp is
 * the territory's, and letting `Date` re-express it in the handset's timezone moves
 * a late-evening visit onto the wrong day.
 */
export const dayMonthFrom = (iso: string): string => {
  const day = Number(iso.slice(8, 10));
  const month = MONTHS[Number(iso.slice(5, 7)) - 1];
  return month === undefined ? iso.slice(0, 10) : `${String(day)} ${month}`;
};
