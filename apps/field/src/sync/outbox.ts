import {
  ApiRequestError,
  CreateAdverseEventFlagRequestSchema,
  CreateCallReportRequestSchema,
  CreateVisitRequestSchema,
  CreateConsentRecordRequestSchema,
  CreateSampleAndInputRequestSchema,
  SyncQueueItemSchema,
  WorkDayRequestSchema,
  knownSyncWarnings,
} from '@fieldforce/core';
import type {
  ApiErrorCode,
  CreateAdverseEventFlagRequest,
  SyncWarning,
  CreateCallReportRequest,
  CreateVisitRequest,
  SyncRejectionCode,
  CreateCheckInRequest,
  CreateCheckOutRequest,
  CreateConsentRecordRequest,
  CreateSampleAndInputRequest,
  SyncQueueItem,
  WorkDayRequest,
} from '@fieldforce/core';
import { asyncStorageQueueStore, loadQueueState, queueOwner } from './async-storage-store';
import type { QueueLoad } from './async-storage-store';
import { SyncPushRefusal } from './push-client';
import type { OutboxWriteClient } from './push-client';
import { recordingUploadFrom, voiceNoteUploadFrom } from './voice-note-upload';
import type { RecordingUpload, VoiceNoteUpload } from './voice-note-upload';
import { syncQueueReducer } from './reducer';
import type { SyncQueueState } from './reducer';
import { countsAsMobileData, deviceUploadConditions, heldForWifi } from './upload-conditions';
import type { UploadConditions, UploadSnapshot } from './upload-conditions';
import { t } from '@fieldforce/ui/i18n';

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
  /**
   * **`FE-W44`. `read` can fail, and until MR-33 it said `emptyQueue` when it did.**
   *
   * That was not a reporting bug. Both writers here are read-then-write: `enqueue` reads,
   * reduces and writes; `flushOutbox` reads at the top and writes at the bottom. A read
   * that answered "empty" on a corrupt store meant the very next write **replaced the MR's
   * unsent work with an empty queue** — permanently, on a device that may have been offline
   * all morning, and queued consent captures are among what is lost.
   *
   * So the result is discriminated and both writers refuse to write when it is unreadable.
   * Losing the ability to report is survivable; overwriting the only copy is not.
   */
  readonly read: () => Promise<QueueLoad>;
  readonly write: (state: SyncQueueState) => Promise<void>;
}

export const devicePersistence: QueuePersistence = {
  read: loadQueueState,
  write: (state) => asyncStorageQueueStore.save(state),
};

/**
 * `FE-W209`. **One read-then-write on a queue at a time.**
 *
 * Every writer here reads the whole queue, changes it and writes the whole queue back. Two of them
 * interleaved lose a row: a flush read the queue, spent seconds sending, and wrote its copy back --
 * over a voice note the rep had saved in between. The audio file stayed on the phone with no queue
 * row, so nothing would ever send it. `FE-W135` made that easy to hit: every recording saved off
 * WiFi is now queued at once, and a flush also starts whenever the phone joins WiFi.
 *
 * Keyed by the store, so a test's in-memory queue and the device's never wait on each other. A
 * failure inside one section does not poison the next.
 */
const queueLocks = new WeakMap<QueuePersistence, Promise<unknown>>();
const withQueueLock = <T>(store: QueuePersistence, run: () => Promise<T>): Promise<T> => {
  const next = (queueLocks.get(store) ?? Promise.resolve()).then(run, run);
  queueLocks.set(
    store,
    next.catch(() => undefined),
  );
  return next;
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
  | {
      readonly kind: 'sent';
      /** W2-B A / `BE-W147`. What the server said beside "accepted" — `BE-C5`'s line lives here. */
      readonly warnings: readonly SyncWarning[];
    }
  /** The server answered and refused. Nothing is queued; the MR is told. */
  | {
      readonly kind: 'refused';
      readonly message: string;
      /**
       * The server's SQLSTATE, when it gave one — MR-27 C1.
       *
       * The message alone is backend's sentence for support. The REMEDY an MR can act on is
       * keyed by this, through `refusalForSqlState` and `explanation.ts`'s table. Without it
       * a screen can only repeat what the server said, which for `45001` is "re-read the
       * current notice" rather than "open consent again, read the current notice ALOUD, and
       * ask once more" — the difference between a fact and an instruction.
       *
       * Null for an `ApiRequestError`, which carries an `ApiErrorCode` rather than a
       * SQLSTATE. `refusalForSqlState(null)` answers `unrecognised`, which has no remedy, and
       * that is the honest outcome rather than a guessed one.
       */
      readonly sqlState: string | null;
      /**
       * The server's FIGURES for this refusal, verbatim — BE-W97.
       *
       * `sqlState` picks the remedy; this says what the numbers behind it are. For `45004`
       * that is *"cap 1, already given 0, this entry 2, period starting 2026-09-01"*. MR-27
       * C2 drove a real one and the MR saw a sentence containing a doctor UUID and no
       * figures at all, because `sync_push` read `MESSAGE_TEXT` out of
       * `get stacked diagnostics` and discarded `PG_EXCEPTION_DETAIL`.
       *
       * **Rendered, never parsed.** It is prose from the raise site, not a contract.
       *
       * Null for an `ApiRequestError`, which is a transport category with no raise site,
       * and null on a dead-letter replay, where the server has only the stored message.
       */
      readonly detail: string | null;
    }
  /**
   * No answer. The work is on disk and will go later.
   *
   * `FE-W135`. `waitingForWifi` when it was not even TRIED: it is audio, "Send audio on WiFi only"
   * is on, and the phone is not on WiFi. Then "when you have signal" is the wrong promise -- it goes
   * when the phone is on WiFi, or when the MR sends it from the queue screen.
   */
  | { readonly kind: 'queued'; readonly waitingForWifi?: true }
  /**
   * `FE-W44`. The server did not answer AND the queue could not be read, so the work is
   * **not** on disk and will **not** go later. Separate from `queued` because they are
   * opposite facts and only one of them is safe to tell an MR.
   */
  | { readonly kind: 'queue_unreadable' };

// **MR-29 A3 - ALLOWLIST: a RECORD of when this device acted, and the prior art.**
// This feeds `clientCreatedAt` on queue rows: "when THIS DEVICE created this row",
// which nothing else can answer - a queued row has no server clock by definition.
// The line is already drawn in this file. `receivedAt` below USED to read `nowIso()`
// under the comment "the server answered, so this is the server's clock by
// definition"; it was removed, because `QueueScreen` rendered it as "Server recorded
// this at ..." - a device clock asserting a SERVER fact. That is the difference
// between the two, and it is why this one stays.
// eslint-disable-next-line no-restricted-syntax -- allowlisted above
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
): SyncQueueItem => captureQueueItem(body, 'check_in', operation);

/**
 * The same, for a DEPARTURE — and the reason this function exists is a defect.
 *
 * **`visit/[id].tsx` queued both stages with `checkInQueueItem`.** A check-out taken with
 * no signal was written to disk as `entity: 'check_in'`, and `sendFor` below then replayed
 * it through `client.createCheckIn`. So an MR who lost signal at the clinic door had
 * their DEPARTURE recorded as an ARRIVAL — a real geo-and-time record, against the right
 * visit, describing the wrong event, with nothing anywhere reporting a problem.
 *
 * It is exactly the corruption `sampleQueueItem`'s comment warns about two functions
 * below: *"a second entity makes that assumption a silent corruption — a handover
 * replayed through `record_check_in` — rather than merely a simplification."* The warning
 * was written, and check-out was already the second entity when it was written.
 *
 * `check_out` has been in `SyncEntitySchema` since the enum was created. Nothing used it.
 *
 * Two functions rather than one with a flag, so a call site has to say which event it is
 * recording and cannot pick the wrong default.
 */
export const checkOutQueueItem = (
  body: CreateCheckOutRequest,
  operation: 'create' = 'create',
): SyncQueueItem => captureQueueItem(body, 'check_out', operation);

const captureQueueItem = (
  body: CreateCheckInRequest | CreateCheckOutRequest,
  entity: 'check_in' | 'check_out',
  operation: 'create' | 'update',
): SyncQueueItem =>
  SyncQueueItemSchema.parse({
    id: body.id,
    entity,
    operation,
    entityId: body.visitId,
    payload: { ...body, __queueEntity: entity },
    status: 'queued',
    attemptCount: 1,
    lastError: null,
    clientCreatedAt: nowIso(),
    syncedAt: null,
  });

/**
 * MR-53 C1 — a queue row for a kept consultation recording.
 *
 * `entityId` is the visit, like every other row, so a recording waits beside the visit it belongs
 * to on the queue screen. The recording's own id travels in the payload and is what
 * `complete_upload` takes as the object id.
 */
export const recordingQueueItem = (body: RecordingUpload): SyncQueueItem =>
  SyncQueueItemSchema.parse({
    id: body.id,
    entity: 'recording',
    operation: 'create',
    entityId: body.visitId,
    payload: { ...body, __queueEntity: 'recording' },
    status: 'queued',
    attemptCount: 1,
    lastError: null,
    clientCreatedAt: nowIso(),
    syncedAt: null,
  });

/**
 * MR-51 D1 — a queue row for a kept voice note.
 *
 * `entityId` is the visit, like every other row, so a note waits beside the visit it belongs to
 * on the queue screen. The note's own id travels in the payload; `uploadVoiceNote` sends it as the
 * `sync_push` entity, because that is what `complete_upload` takes as the object id.
 */
export const voiceNoteQueueItem = (body: VoiceNoteUpload): SyncQueueItem =>
  SyncQueueItemSchema.parse({
    id: body.id,
    entity: 'voice_note',
    operation: 'create',
    entityId: body.visitId,
    payload: { ...body, __queueEntity: 'voice_note' },
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
    payload: { ...body, __queueEntity: 'sample_and_input' },
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
    payload: { ...body, __queueEntity: 'consent_record' },
    status: 'queued',
    attemptCount: 1,
    lastError: null,
    clientCreatedAt: nowIso(),
    syncedAt: null,
  });

/**
 * A queue row for a call report — MR-18 B2.
 *
 * **The last of the five to get one, and the only write that never queued at all.** The
 * screen called `createClientForScenario().createCallReport()` directly, so an MR who lost
 * signal after typing a visit summary was shown *"Your words are still on this screen — try
 * again when you have signal"* — the app asking them to retype work it had chosen not to
 * keep.
 *
 * `entityId` is the visit, matching the other four, so everything waiting on one visit
 * groups together on the queue screen.
 */
/**
 * `BE-W176`. An unplanned visit, queued. Its id is the visit's own: the check-in, call report and
 * check-out that follow it are queued against the same id, and `flushOutbox` holds them back until
 * this one is accepted -- a check-in for a visit the server does not have yet would be refused.
 */
export const unplannedVisitQueueItem = (body: CreateVisitRequest): SyncQueueItem =>
  SyncQueueItemSchema.parse({
    id: body.id,
    entity: 'visit',
    operation: 'create',
    entityId: body.id,
    payload: { ...body, __queueEntity: 'visit' },
    status: 'queued',
    attemptCount: 1,
    lastError: null,
    clientCreatedAt: nowIso(),
    syncedAt: null,
  });

export const callReportQueueItem = (
  body: CreateCallReportRequest,
  operation: 'create' = 'create',
): SyncQueueItem =>
  SyncQueueItemSchema.parse({
    id: body.id,
    entity: 'call_report',
    operation,
    entityId: body.visitId,
    payload: { ...body, __queueEntity: 'call_report' },
    status: 'queued',
    attemptCount: 1,
    lastError: null,
    clientCreatedAt: nowIso(),
    syncedAt: null,
  });

/**
 * W2-C B / `BE-W159` — a possible adverse event the rep FLAGGED, as a queue row (`BE-C36`).
 *
 * Queued like every other write, because the place a rep hears about a side effect is a clinic,
 * and a flag typed with no signal and then lost is the worst write this app could lose. The id is
 * the server's idempotency key: a replay is the same report and the same statutory clock.
 */
export const adverseEventQueueItem = (body: CreateAdverseEventFlagRequest): SyncQueueItem =>
  SyncQueueItemSchema.parse({
    id: body.id,
    entity: 'adverse_event',
    operation: 'create',
    entityId: body.visitId,
    payload: { ...body, __queueEntity: 'adverse_event' },
    status: 'queued',
    attemptCount: 1,
    lastError: null,
    clientCreatedAt: nowIso(),
    syncedAt: null,
  });

/**
 * `BE-W190` — the rep opening or ENDING their working day, as a queue row.
 *
 * `entityId` is the request's own id, as an unplanned visit's is: the act belongs to no visit, so it
 * must not group under one -- and it must never collide with a visit id, or `flushOutbox` would
 * hold it behind a visit it has nothing to do with. Queued BEHIND everything already on the phone
 * (`enqueueFirst`, then a flush, which sends oldest first): a check-out still waiting to go must
 * reach the server before the close, or the close is refused for a visit the server still thinks
 * is checked in (45016).
 */
export const workDayQueueItem = (body: WorkDayRequest): SyncQueueItem =>
  SyncQueueItemSchema.parse({
    id: body.id,
    entity: 'work_day',
    operation: 'create',
    entityId: body.id,
    payload: { ...body, __queueEntity: 'work_day' },
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
  conditions: UploadConditions = deviceUploadConditions,
): Promise<SendOutcome> => {
  const snapshot = await conditions.read();
  if (heldForWifi(item.entity, snapshot)) {
    // `FE-W135`. Not attempted, so not a failure and not a retry: on disk, where the flush will
    // send it once the phone is on WiFi.
    const queued = await enqueueFirst(item, store);
    return queued.kind === 'queued' ? { kind: 'queued', waitingForWifi: true } : queued;
  }
  try {
    const response = await send();
    await countUse(conditions, snapshot, response);
    return { kind: 'sent', warnings: serverWarnings(response) };
  } catch (error: unknown) {
    // **Both refusal classes, and MR-24 found out the expensive way what happens with
    // only one.** This branch read `ApiRequestError` alone, which is what the REST client
    // throws. Since MR-18 the five writes go through `sync_push`, and `push-client.ts`
    // throws `SyncPushRefusal` — a different class, extending `Error`. So every server
    // refusal on this path missed the branch, fell into the queue below, and did exactly
    // what the comment forbids.
    //
    // On the emulator that meant a check-in the server had REJECTED
    // (`outside_shift_window`) told the MR "Saved on this phone. It will send by itself
    // when you have signal — nothing is lost", listed itself as "Waiting to send", and
    // left Today claiming "Everything sent". Three statements, none of them true, from
    // one missing class.
    //
    // `flushOutbox` below already handled `SyncPushRefusal` correctly (see its catch).
    // Only the immediate-send path was left reading the old client's error type — which
    // is why no test caught it: the refusal cases here all construct `ApiRequestError`.
    if (error instanceof ApiRequestError || error instanceof SyncPushRefusal) {
      // The server answered. Whatever it said, it has the work — queueing it would
      // mean re-sending something already refused, on every flush, forever.
      return {
        kind: 'refused',
        message: error.message,
        sqlState: error instanceof SyncPushRefusal ? error.sqlState : null,
        // BE-W97. Null for an `ApiRequestError`, which is a transport category and carries
        // no raise site at all — the same reason `sqlState` is null there.
        detail: error instanceof SyncPushRefusal ? error.detail : null,
      };
    }

    // `FE-W44`. An unreadable queue is never written over: that would replace whatever is on
    // disk with a queue holding only this item. The work is not queued, and saying so is the only
    // honest answer — a `queued` verdict would tell the MR their write is safe on a device that
    // just lost the rest of them.
    return enqueueFirst(item, store);
  }
};

/**
 * `BE-W176`. Put an item on the phone's queue FIRST, before any send.
 *
 * For a write the phone must be able to read back at once: an unplanned visit has to be openable
 * the moment it is made -- online, before the next pull brings the server's copy, and offline. The
 * caller then flushes (`flushOutbox`), which sends it if there is signal. Same guard as
 * `sendOrQueue`: a queue that cannot be read is never overwritten.
 */
export const enqueueFirst = async (
  item: SyncQueueItem,
  store: QueuePersistence = devicePersistence,
): Promise<{ readonly kind: 'queued' } | { readonly kind: 'queue_unreadable' }> => {
  return withQueueLock(store, async () => {
    const load = await store.read();
    if (load.kind === 'unreadable') return { kind: 'queue_unreadable' } as const;
    await store.write(syncQueueReducer(load.state, { type: 'enqueued', item }));
    return { kind: 'queued' } as const;
  });
};

/**
 * The server's `receivedAt` out of a create response, or null.
 *
 * Null rather than a fallback, and rather than a throw. A response shape this build does
 * not recognise is not a reason to invent a timestamp, and it is not a reason to lose a
 * verdict that otherwise landed — the item is still accepted, it simply has no server
 * clock to show, and `QueueScreen` renders nothing rather than something untrue.
 */
const serverReceivedAt = (response: unknown): string | null => {
  if (typeof response !== 'object' || response === null) return null;
  const value = (response as { receivedAt?: unknown }).receivedAt;
  return typeof value === 'string' ? value : null;
};

/**
 * `FE-W137`. Count an accepted send toward the month's mobile-data uploads, when the phone was not
 * on WiFi as it went. The bytes are the sender's own figure (`PushAccepted.bytesSent`) and the month
 * is the SERVER's (`receivedAt`); a response carrying neither counts nothing. Never throws -- a
 * count is a note, and it must not cost the verdict.
 */
const countUse = async (
  conditions: UploadConditions,
  snapshot: UploadSnapshot,
  response: unknown,
): Promise<void> => {
  if (!countsAsMobileData(snapshot.connection)) return;
  if (typeof response !== 'object' || response === null) return;
  const bytes = (response as { bytesSent?: unknown }).bytesSent;
  const serverTime = serverReceivedAt(response);
  if (typeof bytes !== 'number' || bytes <= 0 || serverTime === null) return;
  await conditions.recordUse({ bytes, serverTime }).catch(() => undefined);
};

/**
 * W2-B A / `BE-W147` — the server's warnings out of a send's response, or none.
 *
 * The same rule as `serverReceivedAt` above: a response this build does not recognise yields
 * nothing rather than a guess, and never costs the verdict. Before this, both the immediate send and
 * the flush wrote `warnings: []` whatever the server had said.
 */
const serverWarnings = (response: unknown): readonly SyncWarning[] => {
  if (typeof response !== 'object' || response === null) return [];
  const value = (response as { warnings?: unknown }).warnings;
  if (!Array.isArray(value)) return [];
  return knownSyncWarnings(value.filter((entry): entry is string => typeof entry === 'string'));
};

/**
 * A server refusal, as a rejection code.
 *
 * **MR-10 C1/C3. The whole rejection path was unreachable from a flush.**
 *
 * `sendOrQueue` has always told a refusal from a silence: an `ApiRequestError` means the
 * server answered, so the item is NOT queued, because *"queueing it would mean re-sending
 * something already refused, on every flush, forever."* `flushOutbox` did not make that
 * distinction. Its `catch` recorded `attempt_failed` for everything, which returns the row
 * to `queued` — so a refusal arriving during a flush was treated as no answer at all.
 *
 * Nothing produced `rejected` or `dead_lettered`, so `RejectionRecord`, the queue screen's
 * whole rejection block, `deadLettered`, `attemptsRemaining` and the server-clock line were
 * all unreachable. **What an MR would see once Part D schedules it:** a consent refused
 * `45001` sitting in the queue as "waiting to send", retried on every flush forever, never
 * explained and never surfaced to anybody — while they believe it is on its way.
 *
 * `dead_lettered` rather than `rejected`, and the reason is the payload: a queued row is
 * replayed byte-identical, so a refusal of it is permanent by construction. The same
 * `occurredAt` is outside the same shift window on every attempt. That is the definition
 * of *needs a person, not another retry*, and it is the rule `sendOrQueue` already applies
 * one function up.
 *
 * The mapping is coarse on purpose. `ApiErrorCode` is a transport category and
 * `SyncRejectionCode` is a queue category; neither is the SQLSTATE contract, which is what
 * actually carries the remedy (BE-W75 put `sqlState` on the verdict for exactly this
 * reason). `internal_error` is the honest default rather than a guess that reads as
 * precision.
 */
const rejectionCodeFor = (code: ApiErrorCode): SyncRejectionCode => {
  switch (code) {
    case 'permission_denied':
    case 'unauthenticated':
      return 'not_your_record';
    case 'not_found':
      return 'missing_reference';
    case 'validation_failed':
      return 'validation_failed';
    case 'conflict':
    case 'rate_limited':
    case 'internal_error':
      return 'internal_error';
  }
};

export interface FlushResult {
  readonly attempted: number;
  readonly sent: number;
  readonly stillQueued: number;
  /**
   * `FE-W44`. True when the queue could not be read, so nothing was attempted **and nothing
   * was written**. Distinct from `attempted: 0` with an empty queue, which means there was
   * genuinely nothing to send.
   */
  readonly unreadable?: boolean;
  /**
   * MR-49 / `FE-W61`. True when the signed-in user changed while this flush was running. It
   * stopped before the next send and wrote nothing: the rest of that queue belongs to the
   * previous user and must not be sent under the new one. Writes are idempotent by id, so the
   * previous user's next flush resends whatever this one did not record.
   */
  readonly ownerChanged?: boolean;
  /**
   * `FE-W135`. Audio left on the phone, untried, because "Send audio on WiFi only" is on and the
   * phone was not on WiFi. Present only when there was some. Their attempt counts are untouched: a
   * recording waiting for WiFi has not failed, and must never drift toward "Still trying".
   */
  readonly heldForWifi?: number;
}

/**
 * Try everything on disk, oldest first.
 *
 * Items are attempted **in order and independently**: one failing does not stop the
 * rest, because the reducer already treats each item's verdict as isolated, and an
 * MR whose second check-in is refused should still have their third one sent.
 */
export const flushOutbox = (
  client: OutboxWriteClient,
  store: QueuePersistence = devicePersistence,
  owner: () => string | null = queueOwner,
  conditions: UploadConditions = deviceUploadConditions,
): Promise<FlushResult> => {
  // `FE-W209`. **One flush of a queue at a time; a second waits its turn.** A flush starts on
  // mount, on foreground, on joining WiFi, on "Send now" and after an unplanned visit, and nothing
  // stopped two running together: both read the same `queued` rows and both sent them. For audio
  // that was two upload sessions for one recording, and whichever verdict was written last won --
  // so a row the server had accepted could end up shown as failed. Waiting, not skipping: the
  // caller that enqueued a row and then flushed must have ITS row looked at, and the run that was
  // already going read the queue before that row existed.
  const next = (flushTurns.get(store) ?? Promise.resolve()).then(
    () => flushOnce(client, store, owner, conditions),
    () => flushOnce(client, store, owner, conditions),
  );
  flushTurns.set(
    store,
    next.catch(() => undefined),
  );
  return next;
};

const flushTurns = new WeakMap<QueuePersistence, Promise<unknown>>();

const flushOnce = async (
  client: OutboxWriteClient,
  store: QueuePersistence,
  owner: () => string | null,
  conditions: UploadConditions,
): Promise<FlushResult> => {
  const startedFor = owner();
  const load = await store.read();
  if (load.kind === 'unreadable') {
    // `FE-W44`. Not "nothing to do". Flushing nothing and then writing at the bottom would
    // overwrite the queue this run could not read.
    return { attempted: 0, sent: 0, stillQueued: 0, unreadable: true };
  }
  let state = load.state;
  const waiting = state.items.filter((item) => item.status === 'queued');
  if (waiting.length === 0) return { attempted: 0, sent: 0, stillQueued: 0 };

  // `FE-W135`. Read once per flush: the network the sends below go out on, and the MR's switch.
  // Held audio is left out BEFORE the batch starts, so it is never marked in flight, never given a
  // failed attempt, and never reaches the sender -- it is simply not part of this run.
  const snapshot = await conditions.read();
  const held = waiting.filter((item) => heldForWifi(item.entity, snapshot)).length;
  const queued = waiting.filter((item) => !heldForWifi(item.entity, snapshot));
  if (queued.length === 0) {
    return { attempted: 0, sent: 0, stillQueued: waiting.length, heldForWifi: held };
  }
  const withHeld = held === 0 ? {} : { heldForWifi: held };

  state = syncQueueReducer(state, {
    type: 'batch_started',
    ids: queued.map((item) => item.id),
  });

  let sent = 0;
  // `BE-W176`. The dependency, explicit and from the WHOLE queue -- not only this run's items: every
  // visit the phone made that the server has not yet accepted (queued, in flight, or refused). Its
  // check-in, report and check-out share its id as `entityId`, and none of them is sent until the
  // visit itself is accepted -- sent earlier, each would be refused for a visit the server lacks.
  const visitsNotYetAccepted = new Set(
    state.items
      .filter((item) => item.entity === 'visit' && item.status !== 'synced')
      .map((item) => item.entityId),
  );
  const refusedVisits = new Set(
    state.items
      .filter((item) => item.entity === 'visit' && item.status === 'failed')
      .map((item) => item.entityId),
  );
  for (const item of queued) {
    // MR-49 / `FE-W61`. The client sends under whoever is signed in NOW. If that is no longer
    // the user whose queue this is, stop before sending another of their items as someone else.
    if (owner() !== startedFor) {
      return {
        attempted: sent,
        sent,
        stillQueued: queued.length - sent,
        ownerChanged: true,
        ...withHeld,
      };
    }
    if (item.entity !== 'visit' && visitsNotYetAccepted.has(item.entityId)) {
      // Held, with nothing sent. A refused visit is said to be the reason, so the rep acts on the
      // VISIT (the queue screen shows its refusal) instead of watching this wait.
      state = syncQueueReducer(state, {
        type: 'attempt_failed',
        ids: [item.id],
        // `FE-W153`. In the language the app is in when the reason is recorded: it is kept on the
        // row (`lastError`) and shown as stored.
        error: refusedVisits.has(item.entityId)
          ? t('queue.heldRefusedVisit')
          : t('queue.heldForVisit'),
      });
      continue;
    }
    try {
      const plan = sendFor(client, item);
      if ('blocked' in plan) {
        // **Recorded as a failed attempt, not skipped.** `continue` left the row in
        // `in_flight` -- the status `batch_started` had just given it -- and every later
        // flush selects only `queued`, so the row was stranded: never retried, never
        // shown as needing attention, and never reported. The comment said it was "left
        // where it is"; it was left where nothing would ever look again.
        //
        // `attempt_failed` returns it to `queued` with a visible reason, which is the
        // path that eventually dead-letters it to a person.
        state = syncQueueReducer(state, {
          type: 'attempt_failed',
          ids: [item.id],
          error:
            plan.blocked === 'unreadable_payload'
              ? t('queue.unreadablePayload')
              : t('queue.notConvertible'),
        });
        continue;
      }
      const response = await plan.send();
      await countUse(conditions, snapshot, response);
      // Accepted (or already the server's): what waits on this visit may go.
      if (item.entity === 'visit') visitsNotYetAccepted.delete(item.entityId);
      state = syncQueueReducer(state, {
        type: 'verdict_received',
        verdict: {
          id: item.id,
          status: 'accepted',
          rejectionCode: null,
          // Null on an accepted item, as the contract states -- absence means success.
          sqlState: null,
          explanation: null,
          // W2-B A. The server's, carried. This was `[]` -- the reducer keeps warnings per item, and
          // nothing on this path ever gave it one.
          warnings: serverWarnings(response),
          attemptsRemaining: 0,
          // **The server's, or none.** This read `nowIso()` under the comment "the
          // server answered, so this is the server's clock by definition". It was the
          // DEVICE's clock at the moment the response was parsed -- on a handset whose
          // clock `capture_consent` refuses to trust past a two-minute tolerance -- and
          // `QueueScreen` rendered it as "Server recorded this at ...".
          //
          // Every created entity carries `received_at`, stamped by the column default
          // `clock_timestamp()`, so the real value was in the response all along.
          receivedAt: serverReceivedAt(response),
        },
      });
      sent += 1;
    } catch (error: unknown) {
      // **A refusal is not a silence.** `sendOrQueue` has always drawn this line; the
      // flush did not, and treated a server "no" as "no answer" — retrying a permanently
      // refused row forever and never showing anybody why.
      // MR-18 B1. The `sync_push` refusal carries the SQLSTATE, which is the whole point
      // of MR-17's threading: 45001, 45004, 45007 and 45008 each reach the MR with their
      // own remedy instead of collapsing onto `internal_error`. Checked BEFORE
      // `ApiRequestError` because it is the richer verdict; the REST branch below stays for
      // any path still on that transport.
      if (error instanceof SyncPushRefusal) {
        state = syncQueueReducer(state, {
          type: 'verdict_received',
          verdict: {
            id: item.id,
            status: error.deadLettered ? 'dead_lettered' : 'rejected',
            // **MR-31 B3. NOT `?? 'internal_error'`.** The wire contract already makes
            // this nullable (`SyncRejectionCodeSchema.nullable()`), so the absence was
            // representable and the client was filling it in. And the filler was not
            // inert: `internal_error` is in `RETRYABLE`, so a refusal whose cause the app
            // does NOT know was telling the MR to try again. The comment three lines above
            // says the point of MR-17's threading was to stop codes collapsing onto
            // `internal_error`; this line collapsed the unknown ones onto it.
            rejectionCode: error.rejectionCode,
            sqlState: error.sqlState,
            explanation: error.message,
            warnings: [],
            attemptsRemaining: 0,
            receivedAt: null,
          },
        });
        continue;
      }

      if (error instanceof ApiRequestError) {
        state = syncQueueReducer(state, {
          type: 'verdict_received',
          verdict: {
            id: item.id,
            status: 'dead_lettered',
            rejectionCode: rejectionCodeFor(error.code),
            // **Null on THIS path, and that is honest rather than lazy.** An
            // `ApiRequestError` comes from the REST client, whose envelope carries an
            // `ApiErrorCode` and no SQLSTATE -- there is nothing to thread. The SQLSTATE
            // exists on the `sync_push` verdict, which Part C introduces; until a screen
            // writes through it, `refusalForSqlState(null)` correctly yields
            // `unrecognised` and the surface shows the honest fallback rather than a
            // guessed remedy.
            sqlState: null,
            // The server's sentence, verbatim. Never reworded — the queue screen renders
            // exactly this.
            explanation: error.message,
            warnings: [],
            attemptsRemaining: 0,
            // No server clock in an error body. Null rather than the device's, which is
            // the MR-08 C5 rule: carry the server's value or carry none.
            receivedAt: null,
          },
        });
        continue;
      }

      state = syncQueueReducer(state, {
        type: 'attempt_failed',
        ids: [item.id],
        error: error instanceof Error ? error.message : t('queue.noAnswer'),
      });
    }
  }

  // `FE-W209`. **Written back over what is on disk NOW, not over what this run read at its top.**
  // The sends above took time, and anything enqueued meanwhile is on disk and not in `state`:
  // writing `state` as it stands would delete it. So, inside the same lock every enqueue takes,
  // the queue is read again and every row this run never saw is kept.
  const verdicts = state;
  return withQueueLock(store, async () => {
    // MR-49 / `FE-W61`, once more at the last moment: `store` reads and writes the queue of whoever
    // is signed in NOW. If that changed during the final send, this run's verdicts belong to the
    // previous user's queue and are not written into the new one. Writes are idempotent by id.
    if (owner() !== startedFor) {
      return { attempted: sent, sent, stillQueued: queued.length - sent, ownerChanged: true };
    }
    const latest = await store.read();
    if (latest.kind === 'unreadable') {
      return { attempted: queued.length, sent, stillQueued: 0, unreadable: true };
    }
    const seen = new Set(load.state.items.map((item) => item.id));
    const merged = latest.state.items
      .filter((item) => !seen.has(item.id))
      .reduce((next, item) => syncQueueReducer(next, { type: 'enqueued', item }), verdicts);
    await store.write(merged);
    return {
      attempted: queued.length,
      sent,
      stillQueued: merged.items.filter((item) => item.status === 'queued').length,
      ...withHeld,
    };
  });
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
/**
 * Why a row could not be sent, when it could not.
 *
 * Two reasons, and they are different problems. `unreadable_payload` is a row this build
 * understands the KIND of and cannot parse — an older or newer shape. `not_convertible`
 * is an entity this build has no endpoint for at all, which today means the two audio
 * kinds waiting on the upload session client (FE-W29).
 */
export type SendBlocked = { readonly blocked: 'unreadable_payload' | 'not_convertible' };

type SendPlan = { readonly send: () => Promise<unknown> } | SendBlocked;

/**
 * The call that retries one queued row, chosen by its entity.
 *
 * **A `switch` with a `never` default, and that is the point of the whole file.** A queued
 * check-out was replayed as a check-in because this dispatch was a chain of `if`s ending
 * in `return null`: `check_out` simply had no branch, so it fell off the end and — because
 * `CreateCheckOutRequestSchema` IS `CreateCheckInRequestSchema` — nothing downstream could
 * tell. `sampleQueueItem`'s comment warns about exactly this two functions above, and
 * check-out was already the second entity when that warning was written.
 *
 * **A comment is not a guard.** With the switch below, adding a member to
 * `SyncEntitySchema` without adding a branch here assigns that member to `never` and the
 * build fails. The author is caught at compile time rather than the MR at the clinic door.
 *
 * `not_convertible` is returned explicitly for the entities that genuinely have no
 * endpoint yet, so "we cannot send this" is a decision written down once rather than the
 * absence of a branch.
 */
const sendFor = (client: OutboxWriteClient, item: SyncQueueItem): SendPlan => {
  const blocked = (reason: SendBlocked['blocked']): SendBlocked => ({ blocked: reason });
  const plan = <T>(body: T | null, call: (body: T) => Promise<unknown>): SendPlan =>
    body === null ? blocked('unreadable_payload') : { send: () => call(body) };

  switch (item.entity) {
    case 'check_in':
      return plan(CreateCheckInRequestFrom(item), (body) => client.createCheckIn(body));

    // A departure replays as a departure. Its absence is what made every queued check-out
    // arrive as an arrival.
    case 'check_out':
      return plan(CreateCheckOutRequestFrom(item), (body) => client.createCheckOut(body));

    case 'sample_and_input':
      return plan(CreateSampleAndInputRequestFrom(item), (body) =>
        client.createSampleAndInput(body),
      );

    case 'consent_record':
      return plan(CreateConsentRecordRequestFrom(item), (body) => client.createConsentRecord(body));

    // MR-18 B2. A call report replays as a call report. It was the one write that did not
    // queue at all -- a bare `createClientForScenario().createCallReport()` straight to the
    // mock -- so an MR with no signal was told to retype a visit summary the app had
    // declined to keep.
    case 'call_report':
      return plan(CreateCallReportRequestFrom(item), (body) => client.createCallReport(body));

    // W2-C B / `BE-W159`. A flag replays as a flag.
    case 'adverse_event':
      return plan(CreateAdverseEventFlagRequestFrom(item), (body) =>
        client.createAdverseEventFlag(body),
      );

    // MR-51 D1 / `FE-W29`. A voice note replays as a voice note: upload, then finalise.
    case 'voice_note':
      return plan(voiceNoteUploadFrom(item.payload), (body) => client.uploadVoiceNote(body));

    // MR-53 C1. A recording replays as a recording, through the same sender. It is reachable only
    // behind two off-by-default switches (`C3`): the build's, and the server's.
    case 'recording':
      return plan(recordingUploadFrom(item.payload), (body) => client.uploadRecording(body));

    // `BE-W176`. A visit the PHONE makes is an unplanned one (`BE-C78`), and it replays as one.
    // Until then this was `blocked('not_convertible')`: visits were written straight to the table.
    case 'visit':
      return plan(CreateVisitRequestFrom(item), (body) => client.createUnplannedVisit(body));

    // `BE-W190`. A day opened or ended replays as exactly that, with its own request id.
    case 'work_day':
      return plan(WorkDayRequestFrom(item), (body) => client.sendWorkDay(body));
  }

  // Unreachable while every member is handled above. If a member is added to
  // `SyncEntitySchema` and not to this switch, `item.entity` is not `never` here and the
  // assignment below fails to compile -- which is the whole guard.
  const unhandled: never = item.entity;
  return blocked(unhandled);
};

/**
 * Does this stored payload say it is what the row claims it is?
 *
 * **The field is `__queueEntity`, and the name matters.** The first attempt called it
 * `kind` and silently overwrote `CreateSampleAndInputRequest.kind`, which is a business
 * field whose values are `'sample' | 'input'` — so every queued handover would have gone
 * out declaring a kind that is not in the enum. It fails closed (`safeParse` rejects it,
 * the row never sends) rather than open, but it is the same family as the defect being
 * fixed: a device-local marker written into a namespace the contract already owns.
 * The prefix says this belongs to the queue and never to a request body.
 *
 * **B2, and it is not redundant with the exhaustive switch above.** They catch different
 * actors at different times:
 *
 *   * The `never` default catches the AUTHOR, at compile time, adding an entity without a
 *     branch. It cannot say anything about a row already on disk.
 *   * This catches the PAYLOAD, at replay time. The check-out defect wrote rows whose
 *     `entity` said `check_in` and whose body was a departure — and because
 *     `CreateCheckOutRequestSchema` **is** `CreateCheckInRequestSchema`, every shape check
 *     in the system agreed the row was fine. Two distinct events with one shape are
 *     indistinguishable to a type system by construction; only a value can separate them.
 *
 * The discriminant lives in the STORED payload, not on the wire. Nothing about the request
 * body sent to the server changes — the contract schemas are untouched and PostgREST never
 * sees this field — because the confusion being prevented is a device-local one, between
 * a row and the queue slot it sits in.
 *
 * **A payload with no `kind` is refused rather than trusted.** It can only come from a
 * build older than this one, which is exactly the build that wrote departures labelled as
 * arrivals, and replaying one on its own word is the defect. It surfaces as an unreadable
 * row — visible, retried, and eventually a person's problem — rather than as a wrong event
 * recorded silently. Nothing has shipped (G-WRITE is unmet, no device holds a queue), so
 * this strands nothing real.
 */
const payloadIs = (item: SyncQueueItem, expected: SyncQueueItem['entity']): boolean =>
  (item.payload as { __queueEntity?: unknown }).__queueEntity === expected;

/**
 * The stored payload, back as a request.
 *
 * Returns null rather than throwing when the payload does not fit the contract: a
 * single unreadable row must not stop the rest of the day's work from going.
 */
const captureRequestFrom = (
  item: SyncQueueItem,
  expected: 'check_in' | 'check_out',
): CreateCheckInRequest | null => {
  // The discriminant first. A departure whose row says `check_in` stops here rather than
  // being posted as an arrival.
  if (!payloadIs(item, expected)) return null;
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

const CreateCheckInRequestFrom = (item: SyncQueueItem): CreateCheckInRequest | null =>
  captureRequestFrom(item, 'check_in');

const CreateCheckOutRequestFrom = (item: SyncQueueItem): CreateCheckOutRequest | null =>
  captureRequestFrom(item, 'check_out');

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
  if (!payloadIs(item, 'sample_and_input')) return null;
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
/**
 * The same, for a call report.
 *
 * Parsed by the contract schema rather than shape-checked by hand, for the reason the
 * samples reader gives: a row written by an older build whose fields have since changed
 * fails here and stays queued, instead of being posted as a half-valid report.
 */
const CreateCallReportRequestFrom = (item: SyncQueueItem): CreateCallReportRequest | null => {
  if (!payloadIs(item, 'call_report')) return null;
  const parsed = CreateCallReportRequestSchema.safeParse(item.payload);
  if (!parsed.success) return null;
  // `FE-W196`. A row queued by a build from before the status was sent has none. It was queued by
  // "Send the report" all the same — the phone has no other way to make one — so it goes as
  // `submitted`, not as the server's default `'draft'` that no manager is ever shown.
  return { ...parsed.data, status: parsed.data.status ?? 'submitted' };
};

/** The same, for an unplanned visit: parsed by the contract, so it carries its reason or stays queued. */
const CreateVisitRequestFrom = (item: SyncQueueItem): CreateVisitRequest | null => {
  if (!payloadIs(item, 'visit')) return null;
  const parsed = CreateVisitRequestSchema.safeParse(item.payload);
  return parsed.success ? parsed.data : null;
};

const CreateAdverseEventFlagRequestFrom = (
  item: SyncQueueItem,
): CreateAdverseEventFlagRequest | null => {
  if (!payloadIs(item, 'adverse_event')) return null;
  const parsed = CreateAdverseEventFlagRequestSchema.safeParse(item.payload);
  return parsed.success ? parsed.data : null;
};

const WorkDayRequestFrom = (item: SyncQueueItem): WorkDayRequest | null => {
  if (!payloadIs(item, 'work_day')) return null;
  const parsed = WorkDayRequestSchema.safeParse(item.payload);
  return parsed.success ? parsed.data : null;
};

const CreateConsentRecordRequestFrom = (item: SyncQueueItem): CreateConsentRecordRequest | null => {
  if (!payloadIs(item, 'consent_record')) return null;
  const parsed = CreateConsentRecordRequestSchema.safeParse(item.payload);
  return parsed.success ? parsed.data : null;
};
