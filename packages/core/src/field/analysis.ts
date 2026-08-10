import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema } from '../shared/primitives.js';

/**
 * The performance analysis layer.
 *
 * Three things are absent from this file on purpose and must stay absent:
 * - No composite score, no rating, no leaderboard field. A single number with no
 *   explanation is unappealable and useless as coaching.
 * - Nothing that describes, scores or characterises the doctor. Findings are about
 *   the MR's own observable behaviour only.
 * - No field that triggers an action. A manager decides every consequence.
 *
 * NOTE FOR AI/ML: the finding shape and citation format are contract I5, due end of
 * week 8, and they are yours. This is the compile target until then.
 */

export const FindingSeveritySchema = z.enum(['info', 'improvement', 'concern']);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export const FindingCategorySchema = z.enum([
  'opening',
  'message_accuracy',
  'objection_handling',
  'question_ratio',
  'call_to_action',
  'follow_through',
  'content_usage',
]);
export type FindingCategory = z.infer<typeof FindingCategorySchema>;

/**
 * Every finding points at a span of transcript. This is what makes it coachable
 * and contestable. A finding with an empty citation array is invalid — the array
 * is `.min(1)` and that is deliberate.
 */
export const FindingCitationSchema = z.object({
  transcriptId: UuidSchema,
  segmentId: UuidSchema,
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  quotedText: z.string().min(1),
});
export type FindingCitation = z.infer<typeof FindingCitationSchema>;

export const FindingSchema = z.object({
  id: UuidSchema,
  analysisId: UuidSchema,
  category: FindingCategorySchema,
  severity: FindingSeveritySchema,
  title: z.string().min(1),
  detail: z.string().min(1),
  citations: z.array(FindingCitationSchema).min(1),
  createdAt: IsoDateTimeSchema,
});
export type Finding = z.infer<typeof FindingSchema>;

/**
 * `refused` is a first-class outcome. When the model cannot produce a cited finding
 * without speculating, refusing is correct behaviour and the UI shows it as such.
 */
export const AnalysisStatusSchema = z.enum(['pending', 'completed', 'failed', 'refused']);
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>;

export const AnalysisSchema = z.object({
  id: UuidSchema,
  visitId: UuidSchema,
  /** The MR being coached. This is sensitive employment data. */
  mrId: UuidSchema,
  transcriptId: UuidSchema,
  status: AnalysisStatusSchema,
  refusalReason: z.string().nullable(),
  rubricVersion: z.string().min(1),
  modelProvider: z.string().min(1),
  modelVersion: z.string().min(1),
  findings: z.array(FindingSchema),
  /** The MR sees this before a manager acts on it, and can attach a response. */
  mrViewedAt: IsoDateTimeSchema.nullable(),
  mrResponse: z.string().nullable(),
  mrRespondedAt: IsoDateTimeSchema.nullable(),
  generatedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type Analysis = z.infer<typeof AnalysisSchema>;

/**
 * Recorded when a manager disagrees with a finding. This is the evidence of genuine
 * human oversight, and the training signal for improving the rubric.
 */
export const AnalysisOverrideSchema = z.object({
  id: UuidSchema,
  analysisId: UuidSchema,
  findingId: UuidSchema.nullable(),
  overriddenByUserId: UuidSchema,
  reason: z.string().min(1),
  createdAt: IsoDateTimeSchema,
});
export type AnalysisOverride = z.infer<typeof AnalysisOverrideSchema>;
