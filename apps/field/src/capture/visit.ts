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
