import type { CreateCheckInRequest, Coordinates, SyncWarning, Visit } from '@fieldforce/core';
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
  queued: readonly {
    readonly entity: string;
    readonly entityId: string;
    readonly status: string;
  }[],
): WitnessedStage => {
  const confirmed = stageOf(visit);
  if (visit === null) return { stage: confirmed, pending: false };

  // Only the server can end a visit, and it already has: once it says `completed` or
  // `not_met` there is nothing a queued row can add, and re-opening a closed visit from the
  // queue would be the client overruling the server rather than anticipating it.
  if (confirmed === 'after') return { stage: 'after', pending: false };

  // W2-C A2 / `BE-W149`. **The item's STATUS decides what it may claim.** This read every item
  // as "waiting to send", so a visit the server had fully accepted said "Visit finished —
  // waiting to send" until the next pull landed (seen on the emulator), and a check-in the server
  // REFUSED still moved the stage and said it was waiting.
  //   `queued` / `in_flight` — this phone recorded it and has not been answered: pending.
  //   `synced`               — the server ACCEPTED it: the stage is confirmed, not pending.
  //   `failed` / `conflict`  — the server did not take it: it moves nothing.
  const forThisVisit = queued.filter((item) => item.entityId === visit.id);
  const has = (entity: string, statuses: readonly string[]): boolean =>
    forThisVisit.some((item) => item.entity === entity && statuses.includes(item.status));
  const ACCEPTED = ['synced'];
  const WAITING = ['queued', 'in_flight'];

  if (has('check_out', ACCEPTED)) return { stage: 'after', pending: false };
  if (has('check_out', WAITING)) return { stage: 'after', pending: true };
  if (confirmed === 'during') return { stage: 'during', pending: false };
  if (has('check_in', ACCEPTED)) return { stage: 'during', pending: false };
  if (has('check_in', WAITING)) return { stage: 'during', pending: true };
  return { stage: confirmed, pending: false };
};

/**
 * W2-C A2 / `BE-W154` — the day's visits, with what this phone WITNESSED laid over them.
 *
 * Today's "Next visit" and the route read `visit.status`, which only a pull moves. Offline on the
 * emulator, a visit the rep had checked into and out of was still Today's "next visit", and the route
 * said "0 done" after four. The visit screen already knew better through `witnessedStage`; this is
 * the same rule for the screens that list visits, so the three cannot disagree.
 *
 * The status moves (`during` → `in_progress`, `after` → `completed`); the TIMES do not — a queued
 * check-in has no server stamp, and inventing one from the device would be the clock defect again.
 * "Not sent yet" is said where it is already said: the sync line beside these screens.
 */
export const visitsAsWitnessed = (
  visits: readonly Visit[],
  items: readonly { readonly entity: string; readonly entityId: string; readonly status: string }[],
): Visit[] =>
  visits.map((visit) => {
    const { stage } = witnessedStage(visit, items);
    if (stage === stageOf(visit)) return visit;
    return { ...visit, status: stage === 'after' ? 'completed' : 'in_progress' };
  });

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
 * W2-B A / `BE-W147` — `BE-C5`'s one plain line: the clinic could not be confirmed.
 *
 * **What the ruling fixes and what it leaves to the copy.** `BE-C5` gives the MEANING — the rep is
 * told "that the clinic could not be confirmed — and told nothing about consequences, because none
 * are decided" — and no sentence. So both lines say exactly that and stop: no "your manager will
 * see", no "this may affect", no warning colour.
 *
 * **One line, and the coarse fix wins.** `BE-C2`: when the fix is wider than the geofence the
 * verdict "was decided by a coin", so an `outside` beside an approximate fix is not a fact about
 * where the rep stood, and saying "your phone placed you away from it" would be the overstatement.
 */
export const CHECK_IN_APPROXIMATE =
  "The clinic could not be confirmed: your phone's position was too rough to tell.";
export const CHECK_IN_OUTSIDE =
  'The clinic could not be confirmed: your phone placed you away from it.';

export const checkInCaveat = (warnings: readonly SyncWarning[]): string | null => {
  if (warnings.includes('check_in_location_approximate')) return CHECK_IN_APPROXIMATE;
  if (warnings.includes('check_in_outside_geofence')) return CHECK_IN_OUTSIDE;
  return null;
};

/**
 * The warnings the server gave this visit's check-ins, from the queue state.
 *
 * A check-in that was QUEUED is answered later, during a flush, maybe on another screen; the reducer
 * keeps the item (as `synced`) and its warnings by item id, so this screen can still say it when the
 * rep comes back. `entityId` is the visit — see `witnessedStage` above.
 */
export const checkInWarningsFor = (
  visitId: string,
  queue: {
    readonly items: readonly {
      readonly id: string;
      readonly entity: string;
      readonly entityId: string;
    }[];
    readonly warnings: Readonly<Record<string, readonly SyncWarning[]>>;
  },
): readonly SyncWarning[] =>
  queue.items
    .filter((item) => item.entity === 'check_in' && item.entityId === visitId)
    .flatMap((item) => queue.warnings[item.id] ?? []);

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
