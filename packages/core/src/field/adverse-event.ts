import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema } from '../shared/primitives.js';

/**
 * Adverse-event ingest — week 7, mechanical half only.
 *
 * Plan §0.4: the recording archive creates a legal screening duty. IPC
 * Pharmacovigilance Guidance for MAHs v2.0 §2.8 gives fifteen calendar days from
 * receipt for a serious adverse event. You cannot record and then not look.
 *
 * WHAT IS NOT HERE, AND WHY.
 *
 * No severity. No priority. No triage state. No confidence score. No category.
 * Those are absent by design rather than by omission: a field a model could write a
 * judgement into is a field a model will write a judgement into, and every adverse
 * event this system sees would then arrive pre-sorted by software. Plan §1 is
 * explicit that the MR app hands these to the same human PV queue the patient diary
 * feeds and never handles one itself.
 *
 * Also not here, and blocked on the PV and privacy sign-off outstanding since week
 * 1: who the PV officer is, the notification channel, what happens at day thirteen,
 * and any escalation ladder. §2.6 requires an identifiable patient for a valid case
 * report and DPDP minimisation requires that this app never retain one. That
 * contradiction is resolved in writing by people, not guessed at here.
 */

export const AdverseEventSourceSchema = z.enum([
  /** An MR typed it. They witnessed something and said so. */
  'mr_reported',
  /** The pipeline flagged a passage of a REDACTED transcript. It flags; it never judges. */
  'transcript_detected',
]);
export type AdverseEventSource = z.infer<typeof AdverseEventSourceSchema>;

export const AdverseEventReportSchema = z.object({
  id: UuidSchema,
  visitId: UuidSchema,
  source: AdverseEventSourceSchema,
  /** Null for a pipeline detection: a detection carries nobody's name. */
  reportedByMrId: UuidSchema.nullable(),
  /**
   * A pointer into the redacted transcript, never the raw one, and never a copy of
   * the text. Deliberately not a foreign key — it dangles once the transcript is
   * destroyed by a withdrawal, which is the honest state of affairs.
   */
  redactedTranscriptId: UuidSchema.nullable(),
  transcriptSegmentId: UuidSchema.nullable(),
  /**
   * The MR's own words, for `mr_reported` only.
   *
   * This is the one field here that can carry patient information, which is exactly
   * the §2.6-versus-DPDP tension the sign-off has to rule on. It exists because a
   * report with no description discharges no duty; omitting it would have decided
   * the question silently by making the feature useless.
   */
  reportedText: z.string().nullable(),
  /** What the device claimed. Evidence about the MR's experience, and not the clock. */
  clientReportedAt: IsoDateTimeSchema.nullable(),
  /** The clock. Stamped by the server at receipt, never from the request. */
  receivedAt: IsoDateTimeSchema,
  /** Fifteen calendar days from `receivedAt`, computed in a pinned timezone. */
  statutoryDueAt: IsoDateTimeSchema,
  createdAt: IsoDateTimeSchema,
});
export type AdverseEventReport = z.infer<typeof AdverseEventReportSchema>;

/** Because the thing that gets missed is a deadline nobody was counting. */
export const AdverseEventClockSchema = z.object({
  id: UuidSchema,
  visitId: UuidSchema,
  source: AdverseEventSourceSchema,
  reportedByMrId: UuidSchema.nullable(),
  receivedAt: IsoDateTimeSchema,
  statutoryDueAt: IsoDateTimeSchema,
  hoursRemaining: z.number().int(),
  overdue: z.boolean(),
});
export type AdverseEventClock = z.infer<typeof AdverseEventClockSchema>;

export const AdverseEventClockSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  overdueCount: z.number().int().nonnegative(),
  dueWithin24Hours: z.number().int().nonnegative(),
  nextDueAt: IsoDateTimeSchema.nullable(),
  oldestOverdueAt: IsoDateTimeSchema.nullable(),
});
export type AdverseEventClockSummary = z.infer<typeof AdverseEventClockSummarySchema>;
