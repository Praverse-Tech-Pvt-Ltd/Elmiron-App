import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema } from '../shared/primitives.js';

/**
 * `BE-W195` / `BE-W196` — push notifications (`20261013000400_push_notifications`,
 * `20261013000410_push_notification_events`, the `push-sender` Edge Function).
 *
 * The phone registers its FCM token as the signed-in person and retires it on sign-out; the server
 * fills `notification_outbox` from four facts (a manager's plan, a reopened day, a course assigned,
 * a manager's note on an analysis) and the sender drains it. What a notification says is fixed
 * server-side text: counts and dates, never a doctor, clinic, product or anything clinical.
 */
export const PUSH_RPC = {
  /** Anyone signed in. This phone's token, for the caller; idempotent. */
  registerToken: 'register_push_token',
  /** Anyone signed in. Retire the caller's own row for this token (sign-out). */
  unregisterToken: 'unregister_push_token',
  /** Admin. Called by `push-sender` as the person asking, before a manual run. Audited. */
  authoriseSender: 'push_sender_authorise',
  /** service_role only, from `_shared/practice-writer.ts`. */
  claimBatch: 'push_claim_batch',
  /** service_role only, from `_shared/practice-writer.ts`. */
  recordResults: 'push_record_results',
} as const;

/** Why a notification exists. One trigger each. */
export const NotificationKindSchema = z.enum([
  'day_plan',
  'day_reopened',
  'course_assigned',
  'coaching_note',
]);
export type NotificationKind = z.infer<typeof NotificationKindSchema>;

/** What `register_push_token` answers. */
export const PushTokenRegistrationSchema = z.object({
  id: UuidSchema,
  registeredAt: IsoDateTimeSchema,
  replaced: z.boolean(),
});
export type PushTokenRegistration = z.infer<typeof PushTokenRegistrationSchema>;

/** What `unregister_push_token` answers: how many of the caller's rows were retired (0 or 1). */
export const PushTokenUnregistrationSchema = z.object({ retired: z.number().int().min(0) });

/** One notification the sender claimed, with the recipient's live tokens. */
export const ClaimedNotificationSchema = z.object({
  id: UuidSchema,
  kind: NotificationKindSchema,
  title: z.string().min(1),
  body: z.string().min(1),
  /** A path inside the app, never a URL. */
  link: z.string().regex(/^\/[A-Za-z0-9/_-]*$/u),
  attempts: z.number().int().min(1),
  tokens: z.array(z.object({ id: UuidSchema, token: z.string().min(1) })),
});
export type ClaimedNotification = z.infer<typeof ClaimedNotificationSchema>;

export const ClaimedBatchSchema = z.array(ClaimedNotificationSchema);

/** What the sender reports for one claimed notification. */
export const NotificationResultSchema = z.object({
  id: UuidSchema,
  outcome: z.enum(['sent', 'retry', 'failed']),
  error: z.string().nullable(),
  /** Tokens the push service said are no longer valid; retired whatever the outcome. */
  retireTokenIds: z.array(UuidSchema),
});
export type NotificationResult = z.infer<typeof NotificationResultSchema>;

export const RecordedResultsSchema = z.object({
  sent: z.number().int(),
  retry: z.number().int(),
  failed: z.number().int(),
  tokensRetired: z.number().int(),
});
export type RecordedResults = z.infer<typeof RecordedResultsSchema>;
