import type { CreateCheckInRequest, Coordinates, Visit } from '@fieldforce/core';
import type { FixOutcome } from './location';

/**
 * The visit, from arriving to leaving. Phase 2 B4 → B5 → B6.
 *
 * **B4 is a button, not a geofence.** The design draws an arrival prompt that fires
 * when the MR crosses a clinic boundary. `fe-w3-spec.md` §4a settles that as
 * discrete fixes only: no background location, so nothing can fire while the app is
 * closed. The MR presses "I'm here" instead, and `source: 'manual'` records that it
 * was a person rather than a geofence — the contract distinguishes the two and both
 * are legitimate.
 *
 * **What this module will not do.** It never invents a position. If the fix comes
 * back denied or unavailable there is no fallback coordinate, because the server
 * computes `distance_from_clinic_metres` from whatever it is sent and a fabricated
 * position becomes a distance in somebody's expense claim. See `blockedReason`.
 */
export type VisitStage =
  /** Not started. The MR is on their way, or has not set off. */
  | 'before'
  /** Checked in. The MR is with the doctor. */
  | 'during'
  /** Checked out. Nothing further is captured for this visit. */
  | 'after';

/**
 * What the client WITNESSED about this visit, which the server may not have heard yet.
 *
 * **MR-26 B2, and the constraint it applies is MR-02's: re-derive facts the server owns,
 * record facts the client witnessed.**
 *
 * `stageOf` reads `visit.status`, which only `record_check_in` and `record_check_out` set,
 * SERVER-side. With no signal that round trip never happens, so an offline check-in left the
 * visit `planned`, `stageOf` stayed `'before'`, and `VisitScreen` offered nothing but
 * check-in for the rest of the visit. MR-25 D1 measured the result: three of the five writes
 * unreachable offline, and `FE-G2` -- 8h offline, 20+ queued writes -- unreachable with them,
 * because those writes could not be made.
 *
 * **This is not the client asserting a fact the server has not confirmed.** The client is not
 * guessing that a check-in happened; it WATCHED ITSELF QUEUE ONE, and that queue row is
 * durable, on disk, and will be sent. The honesty rule governs what the app TELLS an MR --
 * and the caller renders this as PENDING, never as confirmed. What it does not govern is
 * whether a screen may act on something it knows.
 *
 * Check-out wins over check-in when both are queued: a departure is the later fact, and an
 * MR who checked out must not be offered check-out again.
 *
 * `entityId` on a capture queue item is the VISIT id -- see `captureQueueItem` in
 * `outbox.ts` -- which is what makes this a lookup rather than a payload parse.
 */
export interface WitnessedStage {
  readonly stage: VisitStage;
  /**
   * True when the stage rests on a queued write rather than on the server's own status.
   *
   * The caller MUST NOT render a pending stage in the words it uses for a confirmed one.
   * Nothing may claim a state the server has given when it has not -- that is the rule this
   * whole change is careful not to break, and it is a rule about copy.
   */
  readonly pending: boolean;
}

export const witnessedStage = (
  visit: Visit | null,
  queued: readonly { readonly entity: string; readonly entityId: string }[],
): WitnessedStage => {
  const confirmed = stageOf(visit);
  if (visit === null) return { stage: confirmed, pending: false };

  // Only the server can end a visit, and it already has: once it says `completed` or
  // `not_met` there is nothing a queued row can add, and re-opening a closed visit from the
  // queue would be the client overruling the server rather than anticipating it.
  if (confirmed === 'after') return { stage: 'after', pending: false };

  const forThisVisit = queued.filter((item) => item.entityId === visit.id);
  if (forThisVisit.some((item) => item.entity === 'check_out')) {
    return { stage: 'after', pending: true };
  }
  if (confirmed === 'during') return { stage: 'during', pending: false };
  if (forThisVisit.some((item) => item.entity === 'check_in')) {
    return { stage: 'during', pending: true };
  }
  return { stage: confirmed, pending: false };
};

export const stageOf = (visit: Visit | null): VisitStage => {
  if (visit === null) return 'before';
  switch (visit.status) {
    case 'in_progress':
      return 'during';
    case 'completed':
      return 'after';
    // The visit is OVER. An MR who attended and found the doctor unavailable has finished
    // there, and putting them back at 'before' would invite a second check-in to a clinic
    // they have already left.
    case 'not_met':
      return 'after';
    case 'planned':
    case 'cancelled':
      return 'before';
    default: {
      const unhandled: never = visit.status;
      throw new Error(`unhandled visit status: ${String(unhandled)}`);
    }
  }
};

/**
 * Why a check-in cannot be sent, in the MR's words, or null when it can.
 *
 * **This is where S4's promise breaks against the contract, and it is not papered
 * over.** S4 says "the app fully works with location denied — check in by hand".
 * `CreateCheckInRequestSchema.coordinates` is required and non-nullable, so there
 * is no request shape for a check-in without a fix. Until the contract admits one,
 * a denied permission genuinely blocks check-in, and the MR is told that plainly
 * rather than being shown a button that fails when pressed.
 */
export const blockedReason = (outcome: FixOutcome): string | null => {
  switch (outcome.kind) {
    case 'fix':
      return null;
    case 'denied':
      return 'Location is off, so this check-in cannot be sent yet. Turn location on for this app and press again.';
    case 'unavailable':
      return `${outcome.reason} Move somewhere with a clearer view of the sky and press again.`;
  }
};

export interface CheckInDraft {
  readonly visitId: string;
  readonly coordinates: Coordinates;
  /** Device-generated so the request is idempotent if it is sent twice. */
  readonly id: string;
}

/**
 * The request body for a check-in.
 *
 * `occurredAt` is the moment the *fix* was taken, not the moment the request is
 * built. On a queued check-in sent hours later those differ, and the one that
 * describes when the MR was actually at the clinic is the fix.
 */
export const checkInRequest = (draft: CheckInDraft): CreateCheckInRequest => ({
  id: draft.id,
  visitId: draft.visitId,
  coordinates: draft.coordinates,
  source: 'manual',
  occurredAt: draft.coordinates.capturedAt,
});

/** Check-out is the same shape. The server distinguishes them by endpoint. */
export const checkOutRequest = checkInRequest;

/**
 * What the primary action says at each stage.
 *
 * Named for what it does next rather than for the state it is in — "Check in" tells
 * the MR what pressing it achieves; "Not checked in" would describe the screen back
 * at them.
 */
export const actionLabelFor = (stage: VisitStage): string | null => {
  switch (stage) {
    case 'before':
      return 'I am here — check in';
    case 'during':
      return 'Leaving — check out';
    case 'after':
      return null;
  }
};
