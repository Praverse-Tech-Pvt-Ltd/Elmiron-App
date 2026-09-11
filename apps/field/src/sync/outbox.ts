import {
  ApiRequestError,
  CreateCallReportRequestSchema,
  CreateConsentRecordRequestSchema,
  CreateSampleAndInputRequestSchema,
  SyncQueueItemSchema,
} from '@fieldforce/core';
import type {
  ApiErrorCode,
  CreateCallReportRequest,
  SyncRejectionCode,
  CreateCheckInRequest,
  CreateCheckOutRequest,
  CreateConsentRecordRequest,
  CreateSampleAndInputRequest,
  SyncQueueItem,
} from '@fieldforce/core';
import { asyncStorageQueueStore, loadQueueState } from './async-storage-store';
import { SyncPushRefusal } from './push-client';
import type { OutboxWriteClient } from './push-client';
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
      return { kind: 'refused', message: error.message };
    }

    const state = await store.read();
    await store.write(syncQueueReducer(state, { type: 'enqueued', item }));
    return { kind: 'queued' };
  }
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
}

/**
 * Try everything on disk, oldest first.
 *
 * Items are attempted **in order and independently**: one failing does not stop the
 * rest, because the reducer already treats each item's verdict as isolated, and an
 * MR whose second check-in is refused should still have their third one sent.
 */
export const flushOutbox = async (
  client: OutboxWriteClient,
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
              ? 'This item was written by a different version of the app and cannot be read.'
              : 'This app cannot send this kind of item yet.',
        });
        continue;
      }
      const response = await plan.send();
      state = syncQueueReducer(state, {
        type: 'verdict_received',
        verdict: {
          id: item.id,
          status: 'accepted',
          rejectionCode: null,
          // Null on an accepted item, as the contract states -- absence means success.
          sqlState: null,
          explanation: null,
          warnings: [],
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
            rejectionCode: error.rejectionCode ?? 'internal_error',
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

    // Still deliberate gaps rather than oversights:
    //   `visit`      -- written straight to the table, no RPC in the way (FIX-07).
    //   `recording`  -- needs an uploadGrantId only an upload session can mint (FE-W29).
    //   `voice_note` -- the same.
    // Listed rather than defaulted, so that converting one is a change to this line and
    // not a change to nothing.
    case 'visit':
    case 'recording':
    case 'voice_note':
      return blocked('not_convertible');
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
  return parsed.success ? parsed.data : null;
};

const CreateConsentRecordRequestFrom = (item: SyncQueueItem): CreateConsentRecordRequest | null => {
  if (!payloadIs(item, 'consent_record')) return null;
  const parsed = CreateConsentRecordRequestSchema.safeParse(item.payload);
  return parsed.success ? parsed.data : null;
};
