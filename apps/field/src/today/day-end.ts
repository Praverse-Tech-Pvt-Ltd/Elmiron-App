import type { Visit } from '@fieldforce/core';

/**
 * B7's day, reduced to what the screen puts on it.
 *
 * The same split `plan.ts` makes, and the same three refusals: no distance the
 * server did not compute, no money figure, no clock arithmetic. What is added here
 * is the pair of stamps the day-end confirmation rests on.
 */
export interface DayEnd {
  /** Visits that counted toward the day, however they ended. */
  readonly planned: number;
  readonly done: number;
  /** Visits the MR ATTENDED where the doctor was not available. See `plan.ts`. */
  readonly notMet: number;
  /** The earliest `startedAt` the server stamped today, ISO. Null before the first. */
  readonly firstCaptureAt: string | null;
  /**
   * The latest `completedAt` the server stamped today, ISO. Null when no visit has
   * been checked out of — which is also the only honest answer to "when did the
   * last position get read", because a check-in is the only other moment one is.
   */
  readonly lastCaptureAt: string | null;
  /** True once every counted visit is complete. B7 is offered from here. */
  readonly finished: boolean;
}

const countsTowardTheDay = (visit: Visit): boolean => visit.status !== 'cancelled';

/**
 * The stamps are the server's and are compared as text.
 *
 * `localeCompare` on contract ISO-8601 rather than `Date` parsing, for the reason
 * `plan.ts` gives: these carry the territory's offset, and parsing them into a
 * `Date` re-expresses them in whatever timezone the handset is set to. On a phone
 * with the wrong timezone that silently moves the whole day.
 */
const earliest = (values: readonly string[]): string | null => [...values].sort()[0] ?? null;
const latest = (values: readonly string[]): string | null =>
  [...values].sort()[values.length - 1] ?? null;

export const summariseDayEnd = (visits: readonly Visit[]): DayEnd => {
  const counted = visits.filter(countsTowardTheDay);
  const done = counted.filter((visit) => visit.status === 'completed').length;
  const notMet = counted.filter((visit) => visit.status === 'not_met').length;

  return {
    planned: counted.length,
    done,
    notMet,
    firstCaptureAt: earliest(
      counted.map((visit) => visit.startedAt).filter((at): at is string => at !== null),
    ),
    lastCaptureAt: latest(
      counted.map((visit) => visit.completedAt).filter((at): at is string => at !== null),
    ),
    // A day with nothing on it is not a finished day. An MR whose plan never
    // arrived has not worked through it, and telling them they have is the same
    // lie in the other direction that `plan.ts` guards against for B1's empty card.
    // **Attendance, not achievement.** A day where the MR walked every stop and found
    // three doctors in theatre IS finished -- there is nothing left for them to do. Judging
    // it by `done` alone would leave the day permanently unfinished for a reason the MR
    // does not control, which is the same harm as scoring `not_met` against them.
    finished: counted.length > 0 && done + notMet === counted.length,
  };
};

/**
 * The standing truth about when this app reads a position.
 *
 * Present tense and unconditional, because under `fe-w3-spec.md` §4a it is
 * unconditional: there is no background location in this app, so between one press
 * and the next nothing is read. B7 draws this as a thing that happened at 18:22.
 * Writing it that way would imply the rest of the day was different, which would
 * teach the MR the app tracks them continuously — the exact belief the
 * transparency screen exists to correct.
 */
export const CAPTURE_NOTE =
  'This app only ever reads your position at the moment you press check in or check out. It has not been reading it between visits, it is not reading it now, and it will not until you press again.';
