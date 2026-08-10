import { z } from 'zod';
import { IsoDateTimeSchema, LanguageTagSchema, UuidSchema } from '../shared/primitives.js';

/**
 * The consent ledger.
 *
 * Three rules encoded here, all of them load-bearing:
 *
 * 1. `ConsentOutcome` has exactly three values and all three are valid completions
 *    of a visit. `declined` is not an error, not a failure, and carries no penalty
 *    flag anywhere in this schema or in the database.
 * 2. A record always references the exact `consentTextVersionId` that was displayed,
 *    plus the language it was displayed in. Without that pair you cannot reconstruct
 *    what the doctor actually agreed to.
 * 3. Withdrawal is a new row with `supersedesConsentRecordId` set. It is never an
 *    edit of the original row. The database has no UPDATE policy for this table.
 */

export const ConsentOutcomeSchema = z.enum(['consented', 'declined', 'not_asked']);
export type ConsentOutcome = z.infer<typeof ConsentOutcomeSchema>;

export const CONSENT_OUTCOMES = ConsentOutcomeSchema.options;

export const ConsentTextVersionSchema = z.object({
  id: UuidSchema,
  /** Human-readable version label shown in audits, e.g. `v1.2`. */
  versionLabel: z.string().min(1),
  language: LanguageTagSchema,
  fullText: z.string().min(1),
  /** SHA-256 of `fullText`, hex encoded. Proves the text was not altered later. */
  hash: z.string().length(64),
  effectiveFrom: IsoDateTimeSchema,
  effectiveUntil: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type ConsentTextVersion = z.infer<typeof ConsentTextVersionSchema>;

export const ConsentRecordSchema = z.object({
  id: UuidSchema,
  visitId: UuidSchema,
  doctorId: UuidSchema,
  /** The MR whose device captured it. */
  capturedByMrId: UuidSchema,
  outcome: ConsentOutcomeSchema,
  /** Required only when the outcome is `not_asked`. Never a penalty field. */
  notAskedReason: z.string().nullable(),
  /** The exact text version displayed on screen. Not the current version. */
  consentTextVersionId: UuidSchema,
  displayedLanguage: LanguageTagSchema,
  /** Set when this row withdraws an earlier consent. The earlier row is untouched. */
  supersedesConsentRecordId: UuidSchema.nullable(),
  isWithdrawal: z.boolean(),
  capturedAt: IsoDateTimeSchema,
  /** When the server took delivery. Server-stamped. */
  receivedAt: IsoDateTimeSchema,
  createdAt: IsoDateTimeSchema,
});
export type ConsentRecord = z.infer<typeof ConsentRecordSchema>;
