import { z } from 'zod';
import { IsoDateTimeSchema, LanguageTagSchema, UuidSchema } from '../shared/primitives.js';

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
  /**
   * MR-52 C1 / `BE-W111`. Was `literal('opus')` while the phone recorded AAC in an MP4 container.
   * Both are declared because both can now be STORED — objects written before `20260923000200`
   * carry `.opus` keys — and the server defaults new rows to what the recorder actually produces.
   */
  codec: z.enum(['opus', 'aac']),
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

/**
 * MR-53 B1 — the server's answer to "may this visit be recorded?".
 *
 * **The client asks; it does not decide.** `sync_pull` deliberately omits `consent_record` (MR-21
 * B6), so the phone has no consent ledger to reason over — and putting one there would mean a
 * second copy of the rule `begin_upload` already enforces. `recording_permission` answers from the
 * same predicate, and an API test asserts the two agree in both directions.
 *
 * **`featureEnabled` is the SERVER half of the flag** (`app_thresholds.recording_feature_enabled`,
 * shipped false). The client half is `AppConfig.recordingEnabled`, which refuses to be true against
 * a deployment at all. Both must be true before a control is drawn: `C3` stands until the named
 * PV/DPDP signatory exists.
 */
export const RecordingPermissionReasonSchema = z.enum([
  'allowed',
  /** The flag is off on the server. Not a fact about the doctor, and not shown as one. */
  'feature_off',
  /** Not this rep's visit — deliberately indistinguishable from a visit that does not exist. */
  'not_your_visit',
  /** The visit's consent state is not trusted after a database restore. */
  'quarantined',
  'never_asked',
  'declined',
  /** They agreed, then changed their mind. A different sentence from "they said no". */
  'withdrawn',
]);
export type RecordingPermissionReason = z.infer<typeof RecordingPermissionReasonSchema>;

export const RecordingPermissionSchema = z.object({
  allowed: z.boolean(),
  reason: RecordingPermissionReasonSchema,
  featureEnabled: z.boolean(),
  /** The consent row that authorises it, when one does. The recording cites this row. */
  consentRecordId: UuidSchema.nullable(),
  /**
   * When the doctor agreed — the CONSENT's time, not the device's.
   *
   * The screen shows it while recording, and a screen that showed the handset's clock there would
   * be asserting a compliance fact from a clock `capture_consent` itself refuses to trust.
   */
  consentCapturedAt: IsoDateTimeSchema.nullable(),
});
export type RecordingPermission = z.infer<typeof RecordingPermissionSchema>;
