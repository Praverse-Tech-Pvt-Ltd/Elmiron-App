import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema } from '../shared/primitives.js';
import { ServerSyncStatusSchema, SyncRejectionCodeSchema } from './sync.js';

/**
 * Resumable audio upload — week 7.
 *
 * An MR uploads a four-minute recording over a mobile network from a clinic
 * corridor. A failed upload that restarts from zero gets abandoned, and the
 * recording is then lost, so the whole shape of this is "the server remembers what
 * the device forgot".
 *
 * THE GRANT COVERS THE WHOLE OBJECT, AND IS RE-CHECKED ON EVERY CHUNK. It is not a
 * grant per chunk: a grant is permission to write one object at one key, and
 * re-issuing the same key repeatedly would make "single-use" meaningless rather than
 * stricter. Single-use means consumed at FINALISATION, not at first byte.
 *
 * Two clocks, and the client needs both:
 *
 *   * `expiresAt`     — slides forward on each chunk. A stalled upload dies in
 *                       fifteen minutes.
 *   * `hardExpiresAt` — fixed at issue, and the sliding clock never passes it. This
 *                       is the one to show an MR: after it, the recording is gone.
 */

export const UploadKindSchema = z.enum(['recording', 'voice_note']);
export type UploadKind = z.infer<typeof UploadKindSchema>;

export const UploadSessionStateSchema = z.enum([
  /** Bytes may be written. */
  'open',
  /** Finalised; a recording or voice note now exists. */
  'completed',
  /** The device gave up, or the sliding clock ran out. */
  'abandoned',
  /** Consent went away underneath it. */
  'revoked',
]);
export type UploadSessionState = z.infer<typeof UploadSessionStateSchema>;

/**
 * `UploadSession` itself already existed in `endpoints.ts` — contract I1 declared the
 * week-7 shape in week 2. It is EXTENDED there rather than redefined here, because
 * two schemas with the same name and different fields is the drift this package
 * exists to prevent. What lives in this file is the vocabulary that shape now needs,
 * plus the queue the server grew around it.
 */

/**
 * One row of the MR's upload queue.
 *
 * Queue state is the MR's only evidence that the day's work is safe, so every
 * failure carries `explanation` — a sentence, not a code. An upload is an ordinary
 * sync item underneath, so `syncStatus`, `attemptsRemaining` and `wasReinstated` are
 * the same dead-letter machinery as everything else in the queue, not a second one.
 */
export const UploadQueueItemSchema = z.object({
  uploadGrantId: UuidSchema,
  visitId: UuidSchema,
  mrId: UuidSchema,
  kind: UploadKindSchema,
  state: UploadSessionStateSchema,
  bytesReceived: z.number().int().nonnegative(),
  declaredBytes: z.number().int().positive(),
  percentComplete: z.number().int().min(0).max(100),
  expiresAt: IsoDateTimeSchema,
  hardExpiresAt: IsoDateTimeSchema,
  /** The recording or voice note id, once the item has been finalised. */
  objectId: UuidSchema.nullable(),
  syncStatus: ServerSyncStatusSchema.nullable(),
  rejectionCode: SyncRejectionCodeSchema.nullable(),
  /** Always populated for a failure. An error code alone makes the MR ring support. */
  explanation: z.string().nullable(),
  attemptsRemaining: z.number().int().nonnegative().nullable(),
  wasReinstated: z.boolean(),
});
export type UploadQueueItem = z.infer<typeof UploadQueueItemSchema>;

/**
 * A visit whose consent state stopped being trustworthy after a database restore.
 *
 * No upload grant is issued while this stands. The app should say so plainly rather
 * than showing a generic failure — an MR told only "upload failed", repeatedly,
 * concludes the app is broken and stops using it.
 */
export const VisitAudioQuarantineSchema = z.object({
  visitId: UuidSchema,
  reason: z.string().min(1),
  quarantinedAt: IsoDateTimeSchema,
});
export type VisitAudioQuarantine = z.infer<typeof VisitAudioQuarantineSchema>;
