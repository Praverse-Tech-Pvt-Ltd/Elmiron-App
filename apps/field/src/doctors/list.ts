import type { Doctor, Visit } from '@fieldforce/core';

/**
 * B8 — the doctor list, ranked and searchable.
 *
 * **Distance is not the sort, and that is a departure from the design.** B8 sorts
 * by distance, on the argument that "the MR is standing somewhere". That needs the
 * device's position, which is the open policy question in `fe-w3-spec.md` §4. Until
 * it is answered this sorts by how long it has been since the last visit, which is
 * the other thing that changes what an MR does next and needs no position at all.
 *
 * **The list is not claimed to work offline either.** B8 says "All 214 doctors in
 * your territory are on this phone. Search works with no signal." There is no
 * on-device store yet — PowerSync is a native module needing a development build
 * that does not exist — so this filters whatever the server returned this session.
 * Printing the design's sentence today would be a promise the app cannot keep the
 * first time an MR walks into a basement clinic.
 */
export interface DoctorRow {
  readonly id: string;
  readonly name: string;
  /** "Urology · Prabhadevi" — specialty and the first clinic's city. */
  readonly detail: string;
  /** ISO of the most recent completed visit, or null if never visited. */
  readonly lastSeenAt: string | null;
  /** Days since that visit. Null when never visited. */
  readonly daysSince: number | null;
  /** §B8's only coloured badge, because it is the only one that changes the plan. */
  readonly overdue: boolean;
}

/** B8's badge threshold, and the "Not seen 30d" filter, from one constant. */
export const OVERDUE_AFTER_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Days between a server timestamp and a server instant.
 *
 * **MR-31 C1 — `now` is no longer the device's, and the old rationale is recorded rather
 * than deleted.** This comment used to read *"the one place the device clock is allowed into
 * a rendered value"*, and argued that "6 weeks ago" is elapsed time from a server-stamped
 * event rather than a device time presented as confirmed. That argument is sound and it is
 * not why this changed.
 *
 * It changed because `serverTime` is strictly better, is already on the pulled store, and
 * costs nothing to use — and because the age is not only read, it drives the **Overdue**
 * badge and the filter of the same name, which decide which doctors an MR goes to see. A
 * handset three days fast marks doctors overdue who are not.
 */
const daysBetween = (iso: string, now: number): number =>
  Math.floor((now - new Date(iso).getTime()) / MS_PER_DAY);

const cityOf = (doctor: Doctor): string | null => doctor.clinicAddresses[0]?.city ?? null;

const detailOf = (doctor: Doctor): string =>
  [doctor.specialty, cityOf(doctor)].filter((part): part is string => part !== null).join(' · ');

/**
 * Matched on name, specialty and city — the three things an MR actually remembers
 * about a doctor they are trying to find while standing in a corridor.
 */
const matches = (row: DoctorRow, query: string): boolean => {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return `${row.name} ${row.detail}`.toLowerCase().includes(needle);
};

export const buildDoctorRows = (
  doctors: readonly Doctor[],
  visits: readonly Visit[],
  /**
   * The SERVER's instant in epoch ms, or **null when this device has never been told one**.
   *
   * Nullable rather than defaulted, because there is no harmless number to put here: any
   * value produces an age, and an age is rendered as fact and filtered on.
   */
  now: number | null,
): readonly DoctorRow[] => {
  const lastByDoctor = new Map<string, string>();
  for (const visit of visits) {
    if (visit.status !== 'completed' || visit.completedAt === null) continue;
    const held = lastByDoctor.get(visit.doctorId);
    if (held === undefined || held.localeCompare(visit.completedAt) < 0) {
      lastByDoctor.set(visit.doctorId, visit.completedAt);
    }
  }

  return doctors.map((doctor) => {
    const lastSeenAt = lastByDoctor.get(doctor.id) ?? null;
    // Null for BOTH "never visited" and "no server clock", which loses nothing: in either
    // case there is no age to render, and `lastSeenAt === null` still distinguishes the two
    // for anything that needs to.
    const daysSince = lastSeenAt === null || now === null ? null : daysBetween(lastSeenAt, now);
    return {
      id: doctor.id,
      name: doctor.fullName,
      detail: detailOf(doctor),
      lastSeenAt,
      daysSince,
      // Never visited counts as overdue: a doctor in the territory nobody has been
      // to is the strongest case for going, not a blank the list can leave out — and that
      // is knowable without any clock at all, which is why it is keyed on `lastSeenAt`.
      //
      // MR-31 C1. It used to read `daysSince === null || ...`, and with a nullable `now`
      // that would have made an UNKNOWN age claim Overdue for every doctor on the list.
      overdue: lastSeenAt === null || (daysSince !== null && daysSince >= OVERDUE_AFTER_DAYS),
    };
  });
};

/**
 * Longest-unseen first, never-visited before that, and the rest by name so the
 * order is stable rather than dependent on what the server happened to send.
 */
/**
 * B8's chips.
 *
 * **"Near me" is not here.** It sorts by distance from the MR's current position,
 * which needs a fix while they are merely browsing — `fe-w3-spec.md` §4a rules that
 * out. A chip that silently did something else under the same name would be worse
 * than its absence.
 *
 * "On plan" means on the plan the Beat plan screen shows for today, whatever its status --
 * nothing is approved in v1 (MR-46 D1). The caller supplies it: this
 * module holds no plan and must not guess at one.
 */
export type DoctorFilter = 'all' | 'overdue' | 'on-plan';

export const FILTER_LABELS: Readonly<Record<DoctorFilter, string>> = {
  all: 'All',
  overdue: 'Not seen 30d',
  'on-plan': 'On plan',
};

const passesFilter = (
  row: DoctorRow,
  filter: DoctorFilter,
  onPlanIds: ReadonlySet<string>,
): boolean => {
  switch (filter) {
    case 'all':
      return true;
    case 'overdue':
      return row.overdue;
    case 'on-plan':
      return onPlanIds.has(row.id);
  }
};

export const rankDoctors = (
  rows: readonly DoctorRow[],
  query: string,
  filter: DoctorFilter = 'all',
  onPlanIds: ReadonlySet<string> = new Set(),
): readonly DoctorRow[] =>
  rows
    .filter((row) => matches(row, query) && passesFilter(row, filter, onPlanIds))
    .slice()
    .sort((a, b) => {
      if (a.daysSince === null && b.daysSince === null) return a.name.localeCompare(b.name);
      if (a.daysSince === null) return -1;
      if (b.daysSince === null) return 1;
      if (a.daysSince !== b.daysSince) return b.daysSince - a.daysSince;
      return a.name.localeCompare(b.name);
    });

/** "6 weeks ago", "today", "never visited" — the words B8 puts under each name. */
/**
 * The age of the last visit, as a sentence.
 *
 * **`daysSince === null` here means NEVER VISITED and nothing else.** After MR-31 C1 a null
 * `daysSince` also arises when there is no server clock to measure against, and the two are
 * NOT the same statement -- "never visited" about a doctor seen last week is false, and it
 * is false in the direction that sends an MR to a doctor they have just seen.
 *
 * Callers must separate the two before they get here; `app/(tabs)/doctors.tsx` shows the
 * shape. This was a live defect for the length of one commit, caught by reading what the
 * label returns rather than by trusting that a null was still a null.
 */
export const lastSeenLabel = (daysSince: number | null): string => {
  if (daysSince === null) return 'never visited';
  if (daysSince <= 0) return 'today';
  if (daysSince === 1) return 'yesterday';
  if (daysSince < 14) return `${String(daysSince)} days ago`;
  const weeks = Math.floor(daysSince / 7);
  if (weeks < 9) return `${String(weeks)} weeks ago`;
  return `${String(Math.floor(daysSince / 30))} months ago`;
};
