import { refusalForSqlState } from '@fieldforce/core';
import type { RefusalCode, SyncRejectionCode } from '@fieldforce/core';
import type { RejectionRecord } from './reducer';
import type { PullFailure } from './pulled-store';
import { t } from '@fieldforce/ui/i18n';
import type { TextKey } from '@fieldforce/ui/i18n';

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

/**
 * What the MR should DO about this refusal — MR-17 B1.
 *
 * **Keyed by `RefusalCode`, which comes from the SQLSTATE, not from `SyncRejectionCode`.**
 * The queue code is a coarse category: `internal_error` covers 45001, 45004, 45007 and
 * 45008 alike, so keying remedies off it would give all four the same sentence — which is
 * the defect this table exists to end. `refusalForSqlState` is the derivation
 * `error-contract.spec.ts` guards in both directions.
 *
 * **This is the client's half and the server's sentence is untouched.** Backend writes what
 * WENT WRONG and it is displayed verbatim; this says what to do next, which is not in the
 * contract and never has been. Where the two would say the same thing, this stays quiet.
 *
 * **`unrecognised` is deliberately absent**, and so is every code with no useful next step.
 * `refusalForSqlState` returns `unrecognised` for a SQLSTATE this build does not know and
 * for `null`, and inventing a remedy for it would send the MR to do the wrong thing with no
 * way to tell. Absence here renders the honest fallback instead.
 */
const REMEDIES: Partial<Readonly<Record<RefusalCode, TextKey>>> = {
  consent_notice_superseded: 'remedy.consentNoticeSuperseded',
  consent_captured_in_future: 'remedy.consentCapturedInFuture',
  consent_too_old_to_accept: 'remedy.consentTooOld',
  recording_in_future: 'remedy.recordingInFuture',
  recording_too_old_to_accept: 'remedy.recordingTooOld',
  field_event_in_future: 'remedy.fieldEventInFuture',
  check_out_before_check_in: 'remedy.checkOutBeforeCheckIn',
  work_day_closed: 'remedy.workDayClosed',
  work_day_has_open_visit: 'remedy.workDayHasOpenVisit',
  ucpmp_sample_cap_exceeded: 'remedy.ucpmpSampleCapExceeded',
  outside_shift_window: 'remedy.outsideShiftWindow',
  shift_window_not_configured: 'remedy.shiftWindowNotConfigured',
};

/** `FE-W144`. A remedy in the app's language, read when it is shown rather than at import. */
const remedyText = (code: RefusalCode): string | null => {
  const key = REMEDIES[code];
  return key === undefined ? null : t(key);
};

export interface RejectionPresentation {
  /** The coarse category, or null when the server sent none — see `RejectionRecord.code`. */
  readonly code: SyncRejectionCode | null;
  /**
   * The precise refusal, derived from the SQLSTATE — MR-17 B1.
   *
   * `unrecognised` when the server sent no SQLSTATE, or one this build does not map.
   * Exposed so a surface (and a test) can tell a known refusal from an unknown one without
   * inferring it from whether `remedy` happens to be null.
   */
  readonly refusalCode: RefusalCode;
  /**
   * What to do next, or null when there is nothing honest to say.
   *
   * Null means exactly that — not "no problem". The server's sentence still explains what
   * went wrong, and `fallback` covers the case where there is not even one of those.
   */
  readonly remedy: string | null;
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
  /**
   * The SERVER's clock, carried straight through — MR-08 C5.
   *
   * Here so this type is the COMPLETE mapping from a stored record to what the queue
   * screen renders. Without it the route would pass some fields through this function and
   * read others off the record beside it, which is how half a mapping quietly stays
   * unexercised.
   */
  readonly receivedAt: string | null;
}

const fallbackText = (): string => t('remedy.fallback');

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

/**
 * The remedy for a SQLSTATE, or null when there is none to give — MR-27 C1.
 *
 * `presentRejection` exists for the QUEUE screen, which has a whole `RejectionRecord`. A
 * screen that has just been refused in the moment has only what `sendOrQueue` handed back,
 * and it needs the same sentence: an MR who has just been refused in front of a doctor is
 * the person who most needs to be told what to do next.
 *
 * Returns null rather than inventing one for an unmapped code, which is the same choice
 * `REMEDIES` makes by having no `unrecognised` entry.
 */
export const remedyForSqlState = (sqlState: string | null): string | null =>
  remedyText(refusalForSqlState(sqlState).code);

/** What `sendOrQueue` hands a screen that was refused in the moment. */
export interface InTheMomentRefusal {
  readonly sqlState: string | null;
  readonly message: string;
  readonly detail: string | null;
}

/**
 * The whole sentence an MR reads when a write is refused in front of a doctor — BE-W97.
 *
 * Three parts, in the order they are useful:
 *
 *   1. **The remedy**, because it is the only part that is an INSTRUCTION. Backend's own
 *      sentence is the fallback when there is no remedy — true, written for support, and
 *      not a next step.
 *   2. **The server's figures**, when it sent any. This is the half MR-27 C2 found
 *      missing: a real `45004` reached the screen as *"this would put MR27 UCPMP c over
 *      the UCPMP cap for 83aa5660-… this month"*, and "do not hand anything else over,
 *      speak to your manager" is not something an MR can act on without knowing WHAT the
 *      cap is, how much of it is already gone, and which month it resets.
 *
 * The figures are rendered exactly as the server wrote them and are never parsed. They are
 * prose from the raise site; `sqlState` is the contract.
 *
 * Attributed — *"Figures from the server"* — rather than blended into the app's own words.
 * The app did not count these and must not appear to have: MR-15's rule is that the client
 * re-derives nothing the server owns, and that applies to the voice a sentence is said in
 * as much as to the number in it.
 */
export const refusalTextFor = (refusal: InTheMomentRefusal): string => {
  const lead = remedyForSqlState(refusal.sqlState) ?? refusal.message;
  // Whitespace-only is treated as absent alongside null. `sync_push` already normalises
  // the empty string away, so this is the second line of defence rather than the first --
  // and MR-26 C is the reason there is a second: the three spellings of absent all
  // interpolated into the same empty parentheses on a screen.
  const figures = refusal.detail?.trim();
  if (figures === undefined || figures === '') return lead;
  return `${lead}\n\n${t('remedy.figures', { figures })}`;
};

export const presentRejection = (record: RejectionRecord): RejectionPresentation => {
  // The SQLSTATE first, because it is the precise answer. `refusalForSqlState` returns
  // `unrecognised` for null and for anything unmapped, so this needs no null branch of its
  // own -- and `unrecognised` has no entry in REMEDIES, which is how an unknown code ends
  // up honest rather than guessed at.
  const refusal = refusalForSqlState(record.sqlState);
  return {
    code: record.code,
    refusalCode: refusal.code,
    remedy: remedyText(refusal.code),
    explanation: record.explanation,
    fallback: record.explanation === null ? fallbackText() : null,
    /**
     * MR-31 B3. **Stated positively, and the null case is load-bearing rather than
     * decorative.**
     *
     * "Retry" is a claim that the cause can change on its own. An uncategorised refusal
     * supports no such claim, so it needs a person exactly as a dead letter does.
     *
     * The first version of this wrote `record.code === null || !RETRYABLE.has(...)`, and a
     * mutation that deleted the null clause **still passed** -- `RETRYABLE.has(null)` is
     * already false, so the clause was a guard no runtime reached, carrying a comment
     * saying it was needed. `territory-day.ts` names that exact shape as a defect this
     * repository has fourteen instances of. In this form the null check is required by the
     * TYPE as well as the logic, so removing it fails the build rather than passing quietly.
     */
    action:
      record.code !== null && !record.deadLettered && RETRYABLE.has(record.code)
        ? 'retry'
        : 'escalate',
    deadLettered: record.deadLettered,
    receivedAt: record.receivedAt,
  };
};

/**
 * MR-48 / `FE-W56`. **An expired sign-in is not a refusal and not a lost signal.**
 *
 * PostgREST answers an expired token with 401 `PGRST303` and a malformed one with `PGRST301`
 * (measured); `refusals.ts` maps both to `not_authenticated`. On the Pixel 10 the Doctors screen
 * rendered that as *"The server refused this sync (PGRST303)"*, and the visit and samples
 * screens would have said *"The app could not reach the server"* -- one invents a decision, the
 * other a network fault. The MR's remedy is neither waiting nor calling a manager: it is to sign
 * in again. Every screen that renders a pull failure checks this FIRST, so the wording is one.
 */
export const sessionExpired = (failure: PullFailure | null): boolean =>
  failure !== null && failure.kind === 'refused' && failure.refusal.code === 'not_authenticated';

export const SESSION_EXPIRED: { readonly title: string; readonly detail: string } = {
  // `FE-W144`. Getters, so every screen that hands this object to a banner reads it in the app's
  // current language at render time, not in whatever language it was at import.
  get title() {
    return t('errors.sessionExpiredTitle');
  },
  get detail() {
    return t('errors.sessionExpiredDetail');
  },
};
