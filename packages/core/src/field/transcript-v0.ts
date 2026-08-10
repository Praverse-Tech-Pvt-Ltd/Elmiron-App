import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema } from '../shared/primitives.js';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PLACEHOLDER — OWNED BY AI/ML, PUBLISHED BY BACKEND ON 15 AUGUST 2026
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This is contract **I3**, which was due at the end of week 2 and is three weeks
 * late. Backend published it so that the week-8 storage layer could be designed
 * against *something*; the shape is taken from the specification already written in
 * the AI/ML brief, not invented here.
 *
 * **It does not close I3.** The schema and the vendor decision are two different
 * deliverables and only one of them was blocking. AI/ML still owes:
 *
 *   - the measured word error rate on real Hinglish MR–doctor audio, and
 *   - the vendor decision that follows from it.
 *
 * When AI/ML publishes the real shape it arrives as `TranscriptV1` alongside this,
 * so consumers migrate deliberately rather than discovering a breaking change. That
 * is why the version is in the type name.
 *
 * **Provider-agnostic by construction.** No vendor field names, no vendor enums,
 * nothing that only Sarvam or only Deepgram returns. Where a provider offers
 * something the others do not — per-word confidence is the live example — the field
 * is optional rather than required, so a provider that omits it is still conformant.
 */

/** A single word, where the provider returns word-level output. */
export const TranscriptWordV0Schema = z.object({
  text: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  /**
   * 0–1. Optional: not every provider returns per-word confidence, and a
   * conformant transcript from one that does not must still validate.
   */
  confidence: z.number().min(0).max(1).optional(),
});
export type TranscriptWordV0 = z.infer<typeof TranscriptWordV0Schema>;

export const TranscriptSegmentV0Schema = z.object({
  id: UuidSchema,
  /**
   * Diarization label. Deliberately not a name and not a role — the mapping from
   * `speaker_0` to "the MR" is an inference, and inferences do not belong in a
   * transcript.
   */
  speakerLabel: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string(),
  /**
   * BCP-47, per segment rather than per transcript. A Hinglish consultation
   * code-switches mid-conversation, and a single transcript-level language tag
   * would be wrong for most of it.
   */
  language: z.string().min(2).max(35),
  confidence: z.number().min(0).max(1).optional(),
  words: z.array(TranscriptWordV0Schema).optional(),
});
export type TranscriptSegmentV0 = z.infer<typeof TranscriptSegmentV0Schema>;

export const TranscriptV0Schema = z.object({
  schemaVersion: z.literal('v0'),
  /** Free-form vendor identifier. Not an enum: enumerating vendors is the decision this schema is waiting on. */
  vendor: z.string().min(1),
  modelVersion: z.string().min(1),
  /** The dominant language, for display. Per-segment tags are authoritative. */
  primaryLanguage: z.string().min(2).max(35),
  durationMs: z.number().int().nonnegative(),
  segments: z.array(TranscriptSegmentV0Schema),
  transcribedAt: IsoDateTimeSchema,
});
export type TranscriptV0 = z.infer<typeof TranscriptV0Schema>;
