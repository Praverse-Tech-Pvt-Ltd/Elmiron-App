import type { CreateVisitRequest, Doctor } from '@fieldforce/core';

/**
 * `BE-W176` / `BE-C78` — a visit the rep makes without a plan.
 *
 * No approval is asked for: the server accepts an unplanned visit from the rep and the manager
 * reviews it afterwards. What it must carry is the REASON (3-500 characters, the database's own
 * check), and it is always sent as `origin: 'unplanned'` -- never inferred from a missing plan.
 *
 * The doctor list is the rep's own (`doctorsFromStore`): the server refuses a doctor outside the
 * rep's territory anyway (`validate_visit` rule 2), so offering one would only produce a refusal.
 */

export const REASON_MIN = 3;
export const REASON_MAX = 500;

export interface UnplannedVisitDraft {
  readonly doctorId: string;
  readonly clinicAddressId: string | null;
  readonly reason: string;
}

export type DraftProblem =
  'no_doctor' | 'reason_too_short' | 'reason_too_long' | 'clinic_not_doctors';

/** What stops this draft being sent, in order, or null when it can go. */
export const draftProblem = (
  draft: UnplannedVisitDraft,
  doctors: readonly Doctor[],
): DraftProblem | null => {
  const doctor = doctors.find((d) => d.id === draft.doctorId);
  if (doctor === undefined) return 'no_doctor';
  if (
    draft.clinicAddressId !== null &&
    !doctor.clinicAddresses.some((clinic) => clinic.id === draft.clinicAddressId)
  ) {
    return 'clinic_not_doctors';
  }
  const reason = draft.reason.trim();
  if (reason.length < REASON_MIN) return 'reason_too_short';
  if (reason.length > REASON_MAX) return 'reason_too_long';
  return null;
};

export const PROBLEM_WORDS: Readonly<Record<DraftProblem, string>> = {
  no_doctor: 'Choose the doctor you are visiting.',
  clinic_not_doctors: 'Choose one of this doctor’s clinics.',
  reason_too_short: 'Say why you are making this visit — a few words is enough.',
  reason_too_long: `Keep the reason under ${String(REASON_MAX)} characters.`,
};

/**
 * The request. `id` is minted once per visit by the caller and is the idempotency key all the way
 * through: the queue item, the sync item and the visit row share it. `scheduledFor` is the moment
 * the rep made it -- a RECORD of the phone's action, which the server stores and does not decide on.
 */
export const unplannedVisitRequest = (
  draft: UnplannedVisitDraft,
  id: string,
  madeAt: string,
): CreateVisitRequest => ({
  id,
  doctorId: draft.doctorId,
  clinicAddressId: draft.clinicAddressId,
  scheduledFor: madeAt,
  unplannedReason: draft.reason.trim(),
});
