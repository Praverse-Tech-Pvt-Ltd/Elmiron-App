/**
 * B9's "Best time to catch him" and B3's "Best window".
 *
 * **Approved on 2 September 2026 and recorded in `fe-w3-spec.md` §4a.** The
 * question was whether this app may infer anything about a named doctor, who is
 * not its user and has consented to nothing. The answer turns on what the input
 * is: this reads **the MR's own visits** — when they went and when they were seen —
 * and nothing about the doctor's practice, patients or prescribing. C14's boundary
 * is unaffected and still printed on the profile.
 *
 * **Three restraints, because a pattern is easy to overstate.**
 *
 * 1. **It refuses to answer below `MINIMUM_VISITS`.** Two visits on a Tuesday is a
 *    coincidence, and an MR who plans a day around it has been misled by arithmetic
 *    dressed as advice.
 * 2. **It says what it is from.** "From your last 5 visits" travels with the
 *    answer, so the MR can weigh it.
 * 3. **It reports the hour band it actually saw**, rounded outward to the hour, not
 *    a tightened guess. A visit at 11:20 and one at 12:50 gives 11:00–13:00, which
 *    is true, rather than 11:20–12:50, which implies a precision two visits cannot
 *    support.
 */
const DAY_NAMES = [
  'Sundays',
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
] as const;

/** Below this, the answer is "not enough visits" rather than a weak pattern. */
export const MINIMUM_VISITS = 3;

export interface Availability {
  /** "Tuesdays and Thursdays" — the days the MR actually found them. */
  readonly days: string;
  /** "11:00–13:00", rounded outward to whole hours. */
  readonly window: string;
  /** How many visits the pattern is drawn from. Always shown with it. */
  readonly fromVisits: number;
}

/**
 * The weekday of a contract timestamp, in the territory's own calendar.
 *
 * The date portion is read as characters and rebuilt as a UTC date purely to ask
 * which weekday it is. Passing the whole ISO string to `Date` and calling
 * `getDay()` would answer in the handset's timezone, which moves an evening visit
 * onto the previous or next day and quietly corrupts the pattern.
 */
const weekdayOf = (iso: string): number => {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

const hourOf = (iso: string): number => Number(iso.slice(11, 13));

const listDays = (days: readonly string[]): string =>
  days.length <= 1
    ? (days[0] ?? '')
    : `${days.slice(0, -1).join(', ')} and ${days[days.length - 1] ?? ''}`;

const pad = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;

/**
 * @param startedAt the server-stamped start of each completed visit with this
 * doctor, most recent first. Only the last `sample` are considered.
 */
export const availabilityFrom = (startedAt: readonly string[], sample = 5): Availability | null => {
  const recent = startedAt.slice(0, sample);
  if (recent.length < MINIMUM_VISITS) return null;

  const counts = new Map<number, number>();
  for (const iso of recent) {
    const day = weekdayOf(iso);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  // Days seen more than once. A day visited a single time out of five is not a
  // pattern, it is the other four days' background noise.
  const repeated = [...counts.entries()]
    .filter(([, seen]) => seen > 1)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([day]) => DAY_NAMES[day] ?? '')
    .filter((name) => name !== '');

  if (repeated.length === 0) return null;

  const hours = recent.map(hourOf).filter((hour) => Number.isFinite(hour));
  const earliest = Math.min(...hours);
  // The band ends at the top of the hour the latest visit began, so a visit that
  // started at 12:50 is inside 11:00–13:00 rather than excluded by 12:00.
  const latest = Math.max(...hours) + 1;

  return {
    days: listDays(repeated),
    window: `${pad(earliest)}–${pad(latest)}`,
    fromVisits: recent.length,
  };
};

/** The sentence B9 and B3 render, or null when there is nothing worth saying. */
export const availabilitySentence = (availability: Availability | null): string | null =>
  availability === null
    ? null
    : `${availability.days}, ${availability.window} — from your last ${String(availability.fromVisits)} visits.`;
