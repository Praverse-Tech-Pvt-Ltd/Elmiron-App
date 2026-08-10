import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema } from '../primitives.js';

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

export const SyncItemStatusSchema = z.enum(['queued', 'in_flight', 'synced', 'conflict', 'failed']);
export type SyncItemStatus = z.infer<typeof SyncItemStatusSchema>;

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
