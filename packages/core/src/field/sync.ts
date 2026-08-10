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

/** Accepted, but with something the MR should know. */
export const SyncWarningSchema = z.enum(['stale_beat_plan']);
export type SyncWarning = z.infer<typeof SyncWarningSchema>;

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
