import type { SyncRejectionCode } from '@elmiron/core';
import type { RejectionRecord } from './reducer';

/**
 * What the MR is shown about a refusal.
 *
 * **The sentence is Backend's and is displayed verbatim.** The rejection sentences
 * are tested server-side; rewording one here breaks a build deliberately, and more
 * to the point, `outside_shift_window` is somebody else's misconfiguration while
 * `outside_geofence` is about where the MR stood. Showing the wrong one to an MR who
 * genuinely did the work is how trust in the app dies.
 *
 * So this module does exactly two things and nothing else:
 *
 * - hands back the server's sentence when there is one,
 * - decides **what the MR can do next**, which is a client concern and is not in the
 *   contract.
 *
 * It never fabricates prose for a refusal. If the server sent no sentence, that is a
 * gap to report, not a gap to fill with a plausible one.
 */

/** What the MR can do about it. The one judgement that belongs on the client. */
export type RejectionAction =
  /** Retrying may work — the condition was transient or has since changed. */
  | 'retry'
  /** No retry will help. It needs a manager or support to act. */
  | 'escalate';

export interface RejectionPresentation {
  readonly code: SyncRejectionCode;
  /** Backend's sentence. `null` means none was sent — show the fallback, not prose. */
  readonly explanation: string | null;
  /**
   * Shown only when `explanation` is null. Deliberately not a sentence about the
   * refusal: it says the app does not have the reason, which is true, rather than
   * guessing at one that might be wrong.
   */
  readonly fallback: string | null;
  readonly action: RejectionAction;
  readonly deadLettered: boolean;
}

const FALLBACK =
  'The server refused this without a reason the app can show. Report the code below to support.';

/**
 * A dead letter always needs a person — attempts are exhausted, so retrying is not a
 * thing the MR can usefully do. Below that, only refusals whose cause can change on
 * its own are retryable: a shift window somebody fixes, a missing reference that
 * arrives when an earlier item syncs. The rest need someone to look.
 */
const RETRYABLE: ReadonlySet<SyncRejectionCode> = new Set<SyncRejectionCode>([
  'outside_shift_window',
  'missing_reference',
  'internal_error',
]);

export const presentRejection = (record: RejectionRecord): RejectionPresentation => ({
  code: record.code,
  explanation: record.explanation,
  fallback: record.explanation === null ? FALLBACK : null,
  action: record.deadLettered || !RETRYABLE.has(record.code) ? 'escalate' : 'retry',
  deadLettered: record.deadLettered,
});
