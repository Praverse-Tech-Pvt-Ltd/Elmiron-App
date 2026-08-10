import { z } from 'zod';
import { IsoDateTimeSchema, LanguageTagSchema, UuidSchema } from '../primitives.js';

/**
 * Audio capture and transcription.
 *
 * NOTE FOR AI/ML: `Transcript` here is provisional. The authoritative transcript
 * and redacted-transcript schemas are contracts I3 (end of week 2) and I4 (end of
 * week 6) and they are yours. This shape exists so that the week-2 mock server and
 * the frontend have something to compile against. Replace it, do not extend it
 * silently — see `mr-work-split.md` §4, "no interface changes silently".
 */

export const UploadStatusSchema = z.enum(['pending', 'uploading', 'uploaded', 'failed', 'purged']);
export type UploadStatus = z.infer<typeof UploadStatusSchema>;

/**
 * The MR's own post-visit note. Captured on every visit regardless of the consent
 * outcome — it is the universal coaching signal and it involves no third party.
 */
export const VoiceNoteSchema = z.object({
  id: UuidSchema,
  visitId: UuidSchema,
  mrId: UuidSchema,
  /** Object key in audio storage. `null` until the upload completes. */
  storageKey: z.string().nullable(),
  durationSeconds: z.number().nonnegative(),
  uploadStatus: UploadStatusSchema,
  recordedAt: IsoDateTimeSchema,
  createdAt: IsoDateTimeSchema,
});
export type VoiceNote = z.infer<typeof VoiceNoteSchema>;

/**
 * An in-visit recording of the MR and the doctor.
 *
 * A recording cannot exist without a `consentRecordId` whose outcome is `consented`.
 * `purgeAfter` is set on insert, not on a later job — a retention date that is
 * computed lazily is a retention date that never fires.
 */
export const RecordingSchema = z.object({
  id: UuidSchema,
  visitId: UuidSchema,
  mrId: UuidSchema,
  consentRecordId: UuidSchema,
  storageKey: z.string().nullable(),
  durationSeconds: z.number().nonnegative(),
  codec: z.literal('opus'),
  bitrateKbps: z.number().int().positive(),
  uploadStatus: UploadStatusSchema,
  recordedAt: IsoDateTimeSchema,
  /** Set to `recordedAt + 90 days` at insert time. Enforced by a lifecycle rule. */
  purgeAfter: IsoDateTimeSchema,
  purgedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type Recording = z.infer<typeof RecordingSchema>;

export const TranscriptSourceTypeSchema = z.enum(['recording', 'voice_note']);
export type TranscriptSourceType = z.infer<typeof TranscriptSourceTypeSchema>;

/**
 * `pending` means redaction has not run. A transcript in that state must never
 * reach durable storage or an LLM. The gate is enforced in the storage layer in
 * week 9, not by anyone checking this field.
 */
export const RedactionStatusSchema = z.enum(['pending', 'redacted', 'failed']);
export type RedactionStatus = z.infer<typeof RedactionStatusSchema>;

export const TranscriptSegmentSchema = z.object({
  id: UuidSchema,
  /** Diarization label, e.g. `speaker_0`. Not a name. */
  speakerLabel: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  /** Redacted text only. Identifiers are replaced before this field is populated. */
  text: z.string(),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const TranscriptSchema = z.object({
  id: UuidSchema,
  sourceType: TranscriptSourceTypeSchema,
  sourceId: UuidSchema,
  visitId: UuidSchema,
  language: LanguageTagSchema,
  redactionStatus: RedactionStatusSchema,
  redactedAt: IsoDateTimeSchema.nullable(),
  segments: z.array(TranscriptSegmentSchema),
  /** STT vendor identifier. Decided by the week-2 bake-off (contract I3). */
  vendor: z.string().min(1),
  modelVersion: z.string().min(1),
  createdAt: IsoDateTimeSchema,
});
export type Transcript = z.infer<typeof TranscriptSchema>;
