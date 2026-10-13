import type { LiveTrackingStatus, PingRefusal, PingVerdict } from '@fieldforce/core';
import { TRACKING_WORDS, trackingState } from '../integrations/tracking';
import type { TrackingInputs, TrackingState } from '../integrations/tracking';

/**
 * `FE-W71` — the tracker's decisions, pure, so they are tested without a phone.
 *
 * **Who supplies which input to `trackingState`.** Three are the SERVER's and arrive in
 * `my_live_tracking`: the company switch, whether the rep accepted the CURRENT notice, and whether now
 * is inside working hours by the server's window and clock — the app re-derives none of them (FIX-02:
 * the server's facts are re-derived by the server). Two are facts only the phone witnesses: whether
 * the app is on screen, and whether the rep has opened their day for live location.
 *
 * **"The day is open"** means the rep pressed "Start sharing for today" on the server's TODAY — their
 * territory date, from `my_live_tracking`, never the handset's calendar. A new day starts closed, so
 * live location never resumes by itself the next morning: the notice says it starts only when the rep
 * starts it, and this is what makes that true.
 */
export interface Witnessed {
  /** The app is on screen (`AppState` is `active`). */
  readonly foreground: boolean;
  /** The territory date on which the rep last opened their day, or null. */
  readonly openedDay: string | null;
}

export const dayIsOpen = (status: LiveTrackingStatus | null, openedDay: string | null): boolean =>
  status !== null && openedDay !== null && openedDay === status.today;

export const trackingInputs = (
  status: LiveTrackingStatus | null,
  witnessed: Witnessed,
): TrackingInputs => ({
  // No answer from the server is "off", never "on": the safe reading of missing data.
  companyEnabled: status?.companyEnabled ?? false,
  noticeAccepted: status?.accepted ?? false,
  withinWorkingHours: status?.withinWorkingHours ?? false,
  dayOpen: dayIsOpen(status, witnessed.openedDay),
  foreground: witnessed.foreground,
});

export const stateOf = (status: LiveTrackingStatus | null, witnessed: Witnessed): TrackingState =>
  trackingState(trackingInputs(status, witnessed));

/**
 * Whether a fix is due. The interval is the COMPANY's (`intervalSeconds` from the server); the
 * server refuses anything faster than half of it, so a little slack here — a watcher's fix landing a
 * few seconds early — is still a kept position. This is spacing, not a compliance clock: the server
 * stamps the time that counts.
 */
export const SEND_SLACK_MS = 10_000;

export const dueToSend = (
  lastSentAtMs: number | null,
  nowMs: number,
  intervalSeconds: number,
): boolean =>
  lastSentAtMs === null || nowMs - lastSentAtMs >= intervalSeconds * 1000 - SEND_SLACK_MS;

/**
 * A refusal that means the phone's picture is out of date — the company switched off, the
 * acceptance is gone or stale, or the working hours ended — so the status must be asked for again,
 * which stops the watcher through `trackingState`. The others (`too_frequent`, `too_old`, …) are
 * about one position and change nothing.
 */
const STALE_PICTURE: ReadonlySet<PingRefusal> = new Set([
  'company_off',
  'no_acceptance',
  'outside_working_hours',
  'day_ended',
]);

export const refreshAfter = (verdict: PingVerdict): boolean =>
  verdict.reason !== null && STALE_PICTURE.has(verdict.reason);

/** What became of the last position this phone tried to send. */
export type LastSend =
  | { readonly kind: 'kept' }
  | { readonly kind: 'refused'; readonly reason: PingRefusal }
  | { readonly kind: 'failed' };

export interface TrackingLine {
  readonly title: string;
  readonly detail: string | null;
  readonly tone: 'attention' | 'info';
}

const REFUSED_WORDS: Readonly<Record<PingRefusal, string>> = {
  company_off: 'Your company has switched live location off.',
  no_acceptance: 'Your company needs you to accept the live location notice first.',
  outside_working_hours: 'Your working hours have ended, so your company did not keep it.',
  recorded_in_future: 'This phone’s clock is ahead of your company’s, so it was not kept.',
  too_old: 'It was too old to count as live by the time it arrived, so it was not kept.',
  implausible_accuracy:
    'The phone could not tell where you were precisely enough, so it was not kept.',
  too_frequent: 'It came too soon after the one before, so it was not kept.',
  day_ended: 'You have ended your working day, so your company did not keep it.',
};

/**
 * The one line the rep always sees — tracking is never silent. The state's own words from
 * `TRACKING_WORDS`, then whatever the rep can act on: a changed notice, a missing permission, a
 * position that did not reach the company.
 */
export const trackingLine = (input: {
  readonly state: TrackingState;
  readonly status: LiveTrackingStatus | null;
  readonly loadFailed: boolean;
  readonly permissionDenied: boolean;
  readonly lastSend: LastSend | null;
}): TrackingLine => {
  if (input.status === null) {
    return input.loadFailed
      ? {
          title: 'Live location is off: this app could not ask your company’s server about it.',
          detail: 'It will ask again when you come back to the app.',
          tone: 'info',
        }
      : { title: 'Checking live location…', detail: null, tone: 'info' };
  }

  const noticeChanged =
    !input.status.accepted &&
    input.status.acceptedNoticeVersionId !== null &&
    input.status.notice !== null;
  if (input.state === 'off_no_notice' && noticeChanged) {
    return {
      title: TRACKING_WORDS.off_no_notice,
      detail: 'The notice has changed since you accepted it. Read the new version to share again.',
      tone: 'info',
    };
  }

  if (input.state !== 'active') {
    return { title: TRACKING_WORDS[input.state], detail: null, tone: 'info' };
  }

  if (input.permissionDenied) {
    return {
      title: 'Live location cannot run: location is not allowed for this app.',
      detail: 'Allow location for this app in your phone’s settings, or stop sharing for today.',
      tone: 'attention',
    };
  }

  const until =
    input.status.shiftEnd === null ? '' : ` Until ${input.status.shiftEnd.slice(0, 5)}.`;
  const last = input.lastSend;
  return {
    title: `${TRACKING_WORDS.active}${until}`,
    detail:
      last === null || last.kind === 'kept'
        ? null
        : last.kind === 'failed'
          ? 'Your last position did not reach your company. It is not kept to send later.'
          : `Your last position: ${REFUSED_WORDS[last.reason]}`,
    tone: 'attention',
  };
};
