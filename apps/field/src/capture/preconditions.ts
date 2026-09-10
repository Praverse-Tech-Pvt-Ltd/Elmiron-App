/**
 * What to tell an MR when a screen cannot act — MR-20 B2.
 *
 * **The defect this exists to end: a tap that does nothing.**
 *
 * Every write screen opened with a guard of this shape on its primary action:
 *
 * ```ts
 * if (visit === null || busy) return;          // visit/[id].tsx:197
 * if (busy || visit === null || doctor === null) return;   // samples
 * ```
 *
 * MR-19 found it the expensive way. The check-in button was pressed against a real
 * Supabase visit id, `load()` searched the MOCK, found nothing, and `advance()` returned on
 * its first line — **no error, no message, no busy state, nothing on the wire.** The MR
 * would have pressed it again.
 *
 * A silent no-op is the inverse of this product's founding rule. The app does not present a
 * state the server has not confirmed; it must equally not present *nothing* while doing
 * nothing. "I pressed it and the app did not react" is the one report nobody can debug and
 * the MR cannot work around.
 *
 * **`busy` is deliberately NOT covered here.** A second tap while a request is in flight is
 * correctly ignored, because the screen is already showing a busy state — the feedback
 * exists, it is just not new. The guards that need a message are the ones whose condition
 * is SUSTAINED: a visit that is not in the store stays not in the store, and pressing again
 * will do nothing again.
 *
 * **Fixed BEFORE the reads were converted, on purpose.** Converting them makes
 * `visit === null` stop happening in the common case, and the pattern would have survived
 * unnoticed until the next unmet precondition — a permission revoked mid-session, a visit
 * reassigned to another territory while the screen is open, a store not yet hydrated on a
 * cold start. The test is what holds the behaviour once the defect is no longer reachable
 * by accident.
 */

export interface PreconditionMessage {
  readonly title: string;
  readonly detail: string;
}

/**
 * The screen was opened for a visit this phone does not hold.
 *
 * **Two real possibilities, and the app cannot tell them apart, so it names both and
 * asserts neither.** The visit may not have synced yet, or it may have left this MR's scope
 * — `sync_pull` sends `out_of_scope` removals and the store deletes the row, which is the
 * privacy half of ADR §6 Q2. Claiming either one specifically would be inventing a
 * server-sourced reason, which is the failure mode `explanation.ts` exists to avoid.
 *
 * It does NOT say "deleted". A record that moved territory has not been deleted, and for a
 * consent record saying so would be dangerously false.
 */
export const VISIT_NOT_AVAILABLE: PreconditionMessage = {
  title: 'This visit is not on your phone',
  detail:
    'It may still be syncing, or it may no longer be yours. Pull down on Today to sync, and if it does not appear, ask your manager.',
};

/**
 * The visit is here and the doctor is not.
 *
 * A separate message because it is a different fact and a different remedy. A doctor and
 * their visit are independent rows in one cursor-ordered stream, so a visit can legitimately
 * arrive first — the same window `doctorWithAddresses().addressesPending` exists for. This
 * is far more likely to resolve on its own than a missing visit.
 */
export const DOCTOR_NOT_AVAILABLE: PreconditionMessage = {
  title: 'This doctor has not synced yet',
  detail:
    'The visit is here but the doctor’s details are not. Give it a moment and try again — nothing is lost.',
};

/**
 * The message for whichever precondition is actually unmet, or null when both are met.
 *
 * Order matters: a missing visit is reported first, because with no visit the doctor is not
 * merely unsynced but unknown, and telling the MR to "give it a moment" would be advice that
 * cannot work.
 */
export const unavailableReason = (
  // `unknown`, not `unknown | null` -- `unknown` already admits null, and the narrower
  // spelling is what the lint rule asks for. Deliberately not typed to `Visit | null` and
  // `Doctor | null`: this asks one question about presence and has no business reading a
  // field off either, so the widest type that still answers it is the honest one.
  visit: unknown,
  doctor: unknown,
): PreconditionMessage | null => {
  if (visit === null) return VISIT_NOT_AVAILABLE;
  if (doctor === null) return DOCTOR_NOT_AVAILABLE;
  return null;
};
