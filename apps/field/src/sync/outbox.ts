import {
  ApiRequestError,
  CreateConsentRecordRequestSchema,
  CreateSampleAndInputRequestSchema,
  SyncQueueItemSchema,
} from '@fieldforce/core';
import type {
  ApiClient,
  CreateCheckInRequest,
  CreateConsentRecordRequest,
  CreateSampleAndInputRequest,
  SyncQueueItem,
} from '@fieldforce/core';
import { asyncStorageQueueStore, loadQueueState } from './async-storage-store';
import { syncQueueReducer } from './reducer';
import type { SyncQueueState } from './reducer';

/**
 * Where the outbox keeps its state.
 *
 * A parameter rather than an import, for the reason `store.ts` gives for the
 * interface existing at all: the queue's rules are logic and belong under the
 * node-side runner, and AsyncStorage is a native module that cannot load there.
 * Welding the two together would have forced every rule below to be tested through
 * a renderer, which is where they would stop being tested carefully.
 */
export interface QueuePersistence {
  readonly read: () => Promise<SyncQueueState>;
  readonly write: (state: SyncQueueState) => Promise<void>;
}

export const devicePersistence: QueuePersistence = {
  read: loadQueueState,
  write: (state) => asyncStorageQueueStore.save(state),
};

/**
 * The outbox: work the MR has done that the server has not yet acknowledged.
 *
 * **The rule that shapes everything here: a refusal is not a failure.** If the
 * server answers — 403, 422, a rejection code — the work reached it and it said no.
 * That is a verdict, and queueing it for retry would push the same refused item
 * forever. Only a request that never got an answer is queued, because only then is
 * it true that the work still needs sending.
 *
 * **The device clock is used for `clientCreatedAt` and that is correct.** The
 * contract names it "client created at" and pairs it with a server `syncedAt`; the
 * queue's order is the order the MR did the work, which is a fact about their
 * device. This is not the same as the queue screen's rule against showing a device
 * time as though the server had confirmed something.
 */
export type SendOutcome =
  /** The server answered and accepted it. Nothing is queued. */
  | { readonly kind: 'sent' }
  /** The server answered and refused. Nothing is queued; the MR is told. */
  | { readonly kind: 'refused'; readonly message: string }
  /** No answer. The work is on disk and will go later. */
  | { readonly kind: 'queued' };

const nowIso = (): string => new Date().toISOString();

/**
 * A queue row for a check-in, built from the same request body that failed to send.
 *
 * `entityId` is the visit and `id` is the request's own id — the contract calls it
 * "device-generated, doubles as the server-side idempotency key", so the retry is
 * the same write rather than a second one.
 */
export const checkInQueueItem = (
  body: CreateCheckInRequest,
  operation: 'create' = 'create',
): SyncQueueItem =>
  SyncQueueItemSchema.parse({
    id: body.id,
    entity: 'check_in',
    operation,
    entityId: body.visitId,
    payload: { ...body },
    status: 'queued',
    attemptCount: 1,
    lastError: null,
    clientCreatedAt: nowIso(),
    syncedAt: null,
  });

/**
 * A queue row for a handover — C5.
 *
 * `entity` is what tells the flush which call to retry it with. Before samples
 * existed the flush sent every queued row as a check-in, which was correct only
 * because check-ins were the only thing that queued; a second entity makes that
 * assumption a silent corruption — a handover replayed through
 * `record_check_in` — rather than merely a simplification. `sendFor` below is
 * where that is now decided, per row.
 *
 * `entityId` is the visit, matching `checkInQueueItem`, so everything waiting for
 * one visit groups together on the queue screen.
 */
export const sampleQueueItem = (
  body: CreateSampleAndInputRequest,
  operation: 'create' = 'create',
): SyncQueueItem =>
  SyncQueueItemSchema.parse({
    id: body.id,
    entity: 'sample_and_input',
    operation,
    entityId: body.visitId,
    payload: { ...body },
    status: 'queued',
    attemptCount: 1,
    lastError: null,
    clientCreatedAt: nowIso(),
    syncedAt: null,
  });

/**
 * A queue row for a consent answer — Phase 3.
 *
 * **A declined consent queues exactly like a granted one.** All three outcomes post
 * to the same endpoint and all three succeed; there is no error path for declining
 * and there must be no faster path for agreeing either. An outbox that treated the
 * two differently would be the app putting its thumb on the scale after the doctor
 * had already answered.
 *
 * `entityId` is the visit, matching the other two, so everything waiting for one
 * visit groups together on the queue screen.
 */
export const consentQueueItem = (
  body: CreateConsentRecordRequest,
  operation: 'create' = 'create',
): SyncQueueItem =>
  SyncQueueItemSchema.parse({
    id: body.id,
    entity: 'consent_record',
    operation,
    entityId: body.visitId,
    payload: { ...body },
    status: 'queued',
    attemptCount: 1,
    lastError: null,
    clientCreatedAt: nowIso(),
    syncedAt: null,
  });

/**
 * Send something, and queue it only if the attempt never reached a verdict.
 *
 * The caller passes the work twice — once as the call to make, once as the row to
 * queue if it does not land. That is deliberate: building the row from the same
 * body that was sent is what keeps the retry byte-identical, and an outbox that
 * reconstructs the payload later is an outbox that can send something different
 * from what the MR did.
 */
export const sendOrQueue = async (
  send: () => Promise<unknown>,
  item: SyncQueueItem,
  store: QueuePersistence = devicePersistence,
): Promise<SendOutcome> => {
  try {
    await send();
    return { kind: 'sent' };
  } catch (error: unknown) {
    if (error instanceof ApiRequestError) {
      // The server answered. Whatever it said, it has the work — queueing it would
      // mean re-sending something already refused, on every flush, forever.
      return { kind: 'refused', message: error.message };
    }

    const state = await store.read();
    await store.write(syncQueueReducer(state, { type: 'enqueued', item }));
    return { kind: 'queued' };
  }
};

export interface FlushResult {
  readonly attempted: number;
  readonly sent: number;
  readonly stillQueued: number;
}

/**
 * Try everything on disk, oldest first.
 *
 * Items are attempted **in order and independently**: one failing does not stop the
 * rest, because the reducer already treats each item's verdict as isolated, and an
 * MR whose second check-in is refused should still have their third one sent.
 */
export const flushOutbox = async (
  client: ApiClient,
  store: QueuePersistence = devicePersistence,
): Promise<FlushResult> => {
  let state = await store.read();
  const queued = state.items.filter((item) => item.status === 'queued');
  if (queued.length === 0) return { attempted: 0, sent: 0, stillQueued: 0 };

  state = syncQueueReducer(state, {
    type: 'batch_started',
    ids: queued.map((item) => item.id),
  });

  let sent = 0;
  for (const item of queued) {
    try {
      const send = sendFor(client, item);
      // An unreadable or unknown row is left where it is rather than dropped: it
      // is work the MR did, and the queue screen already shows it waiting.
      if (send === null) continue;
      await send();
      state = syncQueueReducer(state, {
        type: 'verdict_received',
        verdict: {
          id: item.id,
          status: 'accepted',
          rejectionCode: null,
          explanation: null,
          warnings: [],
          attemptsRemaining: 0,
          // The server answered, so this is the server's clock by definition — the
          // response is what tells us it landed.
          receivedAt: nowIso(),
        },
      });
      sent += 1;
    } catch (error: unknown) {
      state = syncQueueReducer(state, {
        type: 'attempt_failed',
        ids: [item.id],
        error: error instanceof Error ? error.message : 'No answer from the server.',
      });
    }
  }

  await store.write(state);
  return {
    attempted: queued.length,
    sent,
    stillQueued: state.items.filter((item) => item.status === 'queued').length,
  };
};

/**
 * The call that retries one queued row, chosen by its entity.
 *
 * Returns null when the row cannot be replayed — an unreadable payload, or an
 * entity nothing here knows how to send. Null rather than a throw, and rather than
 * a default branch that guesses: a row of an entity this build does not handle
 * belongs to a newer build, and sending it down the wrong endpoint would be worse
 * than leaving it queued.
 */
const sendFor = (client: ApiClient, item: SyncQueueItem): (() => Promise<unknown>) | null => {
  if (item.entity === 'check_in') {
    const body = CreateCheckInRequestFrom(item);
    return body === null ? null : () => client.createCheckIn(body);
  }
  if (item.entity === 'sample_and_input') {
    const body = CreateSampleAndInputRequestFrom(item);
    return body === null ? null : () => client.createSampleAndInput(body);
  }
  if (item.entity === 'consent_record') {
    const body = CreateConsentRecordRequestFrom(item);
    return body === null ? null : () => client.createConsentRecord(body);
  }
  return null;
};

/**
 * The stored payload, back as a request.
 *
 * Returns null rather than throwing when the payload does not fit the contract: a
 * single unreadable row must not stop the rest of the day's work from going.
 */
const CreateCheckInRequestFrom = (item: SyncQueueItem): CreateCheckInRequest | null => {
  const payload = item.payload as Partial<CreateCheckInRequest>;
  if (
    typeof payload.id !== 'string' ||
    typeof payload.visitId !== 'string' ||
    payload.coordinates === undefined ||
    typeof payload.occurredAt !== 'string'
  ) {
    return null;
  }
  return {
    id: payload.id,
    visitId: payload.visitId,
    coordinates: payload.coordinates,
    source: payload.source ?? 'manual',
    occurredAt: payload.occurredAt,
  };
};

/**
 * The same, for a handover.
 *
 * Parsed by the contract schema rather than shape-checked by hand: a row written
 * by an older build whose fields have since changed fails here and stays queued,
 * instead of being posted as a half-valid declaration into an append-only table.
 */
const CreateSampleAndInputRequestFrom = (
  item: SyncQueueItem,
): CreateSampleAndInputRequest | null => {
  const parsed = CreateSampleAndInputRequestSchema.safeParse(item.payload);
  return parsed.success ? parsed.data : null;
};

/**
 * The same, for a consent answer.
 *
 * Parsed by the contract schema, which is what keeps `consentTextVersionId` and
 * `displayedLanguage` intact through a queue that may sit on disk for hours. A row
 * that lost either of those would push a consent record nobody can reconstruct, and
 * an unprovable consent is worse than a missing one — so it stays queued instead.
 */
const CreateConsentRecordRequestFrom = (item: SyncQueueItem): CreateConsentRecordRequest | null => {
  const parsed = CreateConsentRecordRequestSchema.safeParse(item.payload);
  return parsed.success ? parsed.data : null;
};
