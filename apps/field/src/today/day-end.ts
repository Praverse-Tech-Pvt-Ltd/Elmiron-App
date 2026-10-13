import type { Visit } from '@fieldforce/core';
import { clockIn } from './territory-day';
import type { TerritoryZone } from './territory-day';
import type { WorkDayStatus } from './work-day';

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

/**
 * `FE-W80` — what the working-day card says, for every state the server and this phone can be in.
 *
 * **Every time shown is the SERVER's** (`openedAt`, `closedAt`), rendered in the territory zone.
 * Where only the phone knows something -- an end pressed with no signal -- the sentence says it is
 * the phone's ("on this phone"), never presents it as the server's, and shows no time at all.
 */
export interface WorkDayCopy {
  readonly title: string;
  readonly detail: string | null;
  readonly tone: 'plain' | 'waiting' | 'done' | 'refused';
  /** "End my day" is offered. Whether it can be PRESSED is `endDayBlocker`'s. */
  readonly offerEnd: boolean;
}

/** What a check-in on an ended day meets -- said before the press, not discovered after it. */
const AFTER_END =
  'When you end it, the server keeps your day as it stands and refuses further check-ins for today unless your manager reopens it.';

export const workDayCopy = (
  status: WorkDayStatus,
  zone: TerritoryZone,
  /** The server's last "no" to ending this day, already in words, or null. */
  refusal: { readonly title: string; readonly detail: string } | null,
): WorkDayCopy | null => {
  switch (status.kind) {
    case 'unknown':
      return null;
    case 'closed': {
      const { day } = status;
      const totals = day.totals;
      const attended =
        totals === null
          ? null
          : `${String(totals.visitsCompleted + totals.visitsNotMet)} of ${String(totals.visitsTotal)} visits attended`;
      return {
        title: `Day ended at ${clockIn(day.closedAt ?? day.updatedAt, zone)}`,
        detail: [
          attended === null ? 'The server has your day.' : `The server has your day: ${attended}.`,
          'Further check-ins for today are refused unless your manager reopens the day.',
        ].join(' '),
        tone: 'done',
        offerEnd: false,
      };
    }
    case 'ending':
      return status.sent
        ? {
            title: 'Ending your day — the server has it',
            detail: 'Its confirmation arrives with your next sync.',
            tone: 'waiting',
            offerEnd: false,
          }
        : {
            title: 'Ended on this phone — waiting to send',
            detail:
              'It sends by itself when you have signal, after anything else still waiting. Nothing is lost.',
            tone: 'waiting',
            offerEnd: false,
          };
    case 'open': {
      if (refusal !== null) return { ...refusal, tone: 'refused', offerEnd: true };
      const { day } = status;
      const title =
        day === null
          ? 'Your day is started on this phone — waiting to send'
          : `Your day is open — started ${clockIn(day.openedAt, zone)}`;
      const reopened =
        day !== null && day.reopenCount > 0 ? 'Your manager reopened this day. ' : '';
      return { title, detail: `${reopened}${AFTER_END}`, tone: 'plain', offerEnd: true };
    }
    case 'not_started':
      if (refusal !== null) return { ...refusal, tone: 'refused', offerEnd: true };
      return {
        title: 'Your day has not started',
        detail: `It starts with your first check-in. ${AFTER_END}`,
        tone: 'plain',
        offerEnd: true,
      };
  }
};
