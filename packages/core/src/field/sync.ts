import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema } from '../shared/primitives.js';

/**
 * The offline queue. An MR can be offline for a full working day; the queue has to
 * survive that without losing a write or producing a duplicate.
 *
 * `id` is generated on the device and is the idempotency key. The server dedupes on
 * it. Retrying a queue item is always safe.
 */

export const SyncEntitySchema = z.enum([
  'visit',
  'check_in',
  'check_out',
  'call_report',
  'consent_record',
  'voice_note',
  'recording',
  'sample_and_input',
]);
export type SyncEntity = z.infer<typeof SyncEntitySchema>;

export const SyncOperationSchema = z.enum(['create', 'update']);
export type SyncOperation = z.infer<typeof SyncOperationSchema>;

/** The DEVICE's view of an item it is holding. Local to the client queue. */
export const SyncItemStatusSchema = z.enum(['queued', 'in_flight', 'synced', 'conflict', 'failed']);
export type SyncItemStatus = z.infer<typeof SyncItemStatusSchema>;

/** The SERVER's verdict on an item it has seen. Durable, and the source of truth. */
export const ServerSyncStatusSchema = z.enum([
  'accepted',
  'duplicate',
  'rejected',
  'dead_lettered',
]);
export type ServerSyncStatus = z.infer<typeof ServerSyncStatusSchema>;

/**
 * Why an item was refused, in a form the app can act on.
 *
 * `outside_shift_window` is somebody else's misconfiguration and the MR should be
 * told to raise it. `outside_geofence` is about where they stood. Showing the wrong
 * one to an MR who genuinely did the work is how trust in the app dies.
 */
export const SyncRejectionCodeSchema = z.enum([
  'outside_shift_window',
  'outside_geofence',
  'not_your_record',
  'missing_reference',
  'validation_failed',
  'unsupported_entity',
  'malformed_item',
  'internal_error',
]);
export type SyncRejectionCode = z.infer<typeof SyncRejectionCodeSchema>;

/**
 * Accepted, but with something the MR should know.
 *
 * W2-B A / `BE-W147`. The two `check_in_*` warnings are `BE-C5`'s: the clinic could not be
 * confirmed — the position was outside the geofence, or (`BE-C2`) too coarse to judge it.
 */
export const SyncWarningSchema = z.enum([
  'stale_beat_plan',
  'check_in_outside_geofence',
  'check_in_location_approximate',
]);
export type SyncWarning = z.infer<typeof SyncWarningSchema>;

/**
 * The warnings this build knows, out of the wire's `string[]`.
 *
 * **Filtered, never parsed strictly.** The wire type is deliberately open, so a server that learns a
 * new warning before this app does must not fail the whole push — that would turn a fact the rep
 * cannot be shown yet into a write that never lands. An unknown warning is dropped here, which is
 * exactly what this build would have done with it anyway.
 */
export const knownSyncWarnings = (raw: readonly string[]): SyncWarning[] =>
  raw.flatMap((warning) => {
    const parsed = SyncWarningSchema.safeParse(warning);
    return parsed.success ? [parsed.data] : [];
  });

/**
 * The server's durable record of a queued item. A rejection lives here until it is
 * resolved — it is never a discarded row and a toast the MR did not see.
 */
export const ServerSyncItemSchema = z.object({
  id: UuidSchema,
  batchId: UuidSchema.nullable(),
  mrId: UuidSchema,
  entity: SyncEntitySchema,
  operation: SyncOperationSchema,
  entityId: UuidSchema,
  payload: z.record(z.string(), z.unknown()),
  status: ServerSyncStatusSchema,
  rejectionCode: SyncRejectionCodeSchema.nullable(),
  rejectionDetail: z.string().nullable(),
  warnings: z.array(z.string()),
  attemptCount: z.number().int().positive(),
  clientCreatedAt: IsoDateTimeSchema,
  receivedAt: IsoDateTimeSchema,
  resolvedAt: IsoDateTimeSchema.nullable(),
});
export type ServerSyncItem = z.infer<typeof ServerSyncItemSchema>;

/** What support needs to answer "what is in this MR's queue and why is it stuck". */
export const SyncQueueStatusSchema = z.object({
  mrId: UuidSchema,
  acceptedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  deadLetteredCount: z.number().int().nonnegative(),
  lastSuccessfulSyncAt: IsoDateTimeSchema.nullable(),
  oldestUnresolvedAt: IsoDateTimeSchema.nullable(),
});
export type SyncQueueStatus = z.infer<typeof SyncQueueStatusSchema>;

export const SyncQueueItemSchema = z.object({
  /** Device-generated. Doubles as the server-side idempotency key. */
  id: UuidSchema,
  entity: SyncEntitySchema,
  operation: SyncOperationSchema,
  /** The entity id the operation applies to. Also device-generated for `create`. */
  entityId: UuidSchema,
  payload: z.record(z.string(), z.unknown()),
  status: SyncItemStatusSchema,
  attemptCount: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  clientCreatedAt: IsoDateTimeSchema,
  syncedAt: IsoDateTimeSchema.nullable(),
});
export type SyncQueueItem = z.infer<typeof SyncQueueItemSchema>;

/**
 * A queued item with its rejection explained.
 *
 * `rejectionCode` is for the app to branch on; `explanation` is the sentence a
 * human reads. Both live in the same row so support never has to translate one
 * into the other.
 */
export const SyncItemExplainedSchema = ServerSyncItemSchema.extend({
  explanation: z.string().nullable(),
  attemptsRemaining: z.number().int().nonnegative(),
  wasReinstated: z.boolean(),
});
export type SyncItemExplained = z.infer<typeof SyncItemExplainedSchema>;

/**
 * A dead letter reversed by an authorised person.
 *
 * There is deliberately no fault code here. Blame cannot be enumerated in advance —
 * at the point of rejection a wrong shift window and an MR error are
 * indistinguishable — so the control is attribution and a mandatory reason, not a
 * taxonomy.
 */
export const SyncItemReinstatementSchema = z.object({
  id: UuidSchema,
  syncItemId: UuidSchema,
  reinstatedByUserId: UuidSchema,
  reason: z.string().min(1),
  attemptsAtReinstatement: z.number().int().nonnegative(),
  createdAt: IsoDateTimeSchema,
  receivedAt: IsoDateTimeSchema,
});
export type SyncItemReinstatement = z.infer<typeof SyncItemReinstatementSchema>;
