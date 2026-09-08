import { describe, expect, it } from 'vitest';
import { createApiClient } from '@fieldforce/core';
import { checkInQueueItem, sendOrQueue } from './outbox';
import { emptyQueue, syncQueueReducer } from './reducer';
import type { SyncQueueState } from './reducer';

/**
 * MR-01 A3 — what actually happens to a check-in with no connectivity.
 *
 * **Not a unit test of the reducer.** The reducer has been tested since FE-W3 and it was
 * never the doubtful part. What has never been exercised is the classification: whether a
 * connection that cannot be made reaches `sendOrQueue` as a *transport* failure, which
 * queues, or as an `ApiRequestError`, which does not.
 *
 * That distinction decides whether the app is offline-first or silently lossy, and it is
 * not visible by reading either file. `sendOrQueue` treats an `ApiRequestError` as "the
 * server answered, whatever it said, so it has the work" and **deliberately drops the
 * item** — queueing a refusal would re-send something already refused on every flush,
 * forever. Correct for a refusal. Catastrophic for a connection error misclassified as one:
 * an MR in a basement clinic would see a message and lose the visit.
 *
 * So this drives the **real** `ApiClient`, over the **real** `fetch`, at a port with
 * nothing listening — which is what a handset with no signal produces at this layer — and
 * asserts where the work ends up.
 *
 * **What it does not cover**, stated so nobody reads more into it than it proves: it does
 * not render a screen, it does not run on Android, and it does not exercise the radio.
 * B4's device proof is still owed. What it does prove is the branch that decides whether
 * that device proof can possibly pass.
 */

/** Nothing listens here. Chosen high and unused rather than the mock's 4010. */
const DEAD_BASE_URL = 'http://127.0.0.1:49517';

const memoryStore = () => {
  let state: SyncQueueState = emptyQueue;
  return {
    read: () => Promise.resolve(state),
    write: (next: SyncQueueState) => {
      state = next;
      return Promise.resolve();
    },
    current: () => state,
  };
};

const CHECK_IN_BODY = {
  id: '6f7d2f1e-0b6a-4f4a-9b6f-2b6a8c4d1e01',
  visitId: '2a1b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  // Whether the geofence fired it or the MR pressed a button. Both are recorded, and the
  // contract makes it required rather than defaulted -- which is right: a check-in with an
  // unstated source is a check-in nobody can adjudicate later.
  source: 'automatic' as const,
  occurredAt: '2026-09-08T09:40:00+05:30',
  coordinates: {
    latitude: 18.5204,
    longitude: 73.8567,
    accuracyMetres: 12,
    capturedAt: '2026-09-08T09:40:00+05:30',
  },
};

describe('A3 — a check-in with nothing listening', () => {
  it('classifies an unreachable server as transport, not as a refusal', async () => {
    // The assertion the whole offline story rests on. If this ever reads `refused`, the
    // work is discarded and the MR is told something happened that did not.
    const client = createApiClient({
      baseUrl: DEAD_BASE_URL,
      getAccessToken: () => Promise.resolve('not-a-real-token'),
    });
    const store = memoryStore();

    const outcome = await sendOrQueue(
      () => client.createCheckIn(CHECK_IN_BODY),
      checkInQueueItem(CHECK_IN_BODY),
      store,
    );

    expect(outcome.kind).toBe('queued');
  }, 20_000);

  it('the item is on disk afterwards, with its client-generated id intact', async () => {
    // `id` is the idempotency key and the server dedupes on it. A store that minted a new
    // one would turn one check-in into two.
    const client = createApiClient({
      baseUrl: DEAD_BASE_URL,
      getAccessToken: () => Promise.resolve('not-a-real-token'),
    });
    const store = memoryStore();

    await sendOrQueue(
      () => client.createCheckIn(CHECK_IN_BODY),
      checkInQueueItem(CHECK_IN_BODY),
      store,
    );

    const queued = store.current().items;
    expect(queued).toHaveLength(1);
    // `id` is the idempotency key the server dedupes on; `entityId` is the VISIT, so
    // everything waiting on one visit groups together on the queue screen
    // (`outbox.ts:74-77`). A first pass at this test asserted the wrong one of the two,
    // which is worth leaving recorded: they are both uuids and only one is the key.
    expect(queued[0]?.id).toBe(CHECK_IN_BODY.id);
    expect(queued[0]?.entityId).toBe(CHECK_IN_BODY.visitId);
    expect(queued[0]?.status).toBe('queued');
    // Nothing server-stamped is invented while it waits.
    expect(queued[0]?.syncedAt).toBeNull();
  }, 20_000);

  it('the control is not vacuous: a server that DOES answer is not queued', async () => {
    // Without this, the two assertions above would pass against a `sendOrQueue` that
    // queues unconditionally -- which would look identical offline and lose every refusal.
    const store = memoryStore();
    const outcome = await sendOrQueue(
      () => Promise.resolve({ ok: true }),
      checkInQueueItem(CHECK_IN_BODY),
      store,
    );
    expect(outcome.kind).toBe('sent');
    expect(store.current().items).toHaveLength(0);
  });

  it('the reducer is not what is under test here, and is still consistent', () => {
    // A sanity anchor, so a failure above is read as a transport-classification problem
    // rather than as the queue being broken.
    const item = checkInQueueItem(CHECK_IN_BODY);
    const state = syncQueueReducer(emptyQueue, { type: 'enqueued', item });
    expect(state.items).toHaveLength(1);
  });
});
