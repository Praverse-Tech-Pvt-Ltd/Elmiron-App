import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@fieldforce/core';
import type {
  ApiClient,
  CreateCheckInRequest,
  CreateConsentRecordRequest,
  CreateSampleAndInputRequest,
} from '@fieldforce/core';
import {
  checkInQueueItem,
  consentQueueItem,
  flushOutbox,
  sampleQueueItem,
  sendOrQueue,
} from './outbox';
import type { QueuePersistence } from './outbox';
import { emptyQueue } from './reducer';
import type { SyncQueueState } from './reducer';

/**
 * An in-memory store standing in for the device.
 *
 * The rules under test are logic, so they run under vitest in node — where
 * AsyncStorage cannot load at all ("window is not defined"). `QueuePersistence`
 * exists as a parameter for exactly this, and the real adapter is exercised on the
 * emulator instead.
 */
const inMemory = (): QueuePersistence & { current: () => SyncQueueState } => {
  let state: SyncQueueState = emptyQueue;
  return {
    read: () => Promise.resolve(state),
    write: (next) => {
      state = next;
      return Promise.resolve();
    },
    current: () => state,
  };
};

const body: CreateCheckInRequest = {
  id: '77777777-7777-4777-8777-777777777701',
  visitId: '66666666-6666-4666-8666-666666666601',
  coordinates: {
    latitude: 18.5204,
    longitude: 73.8567,
    accuracyMetres: 12,
    capturedAt: '2026-09-02T11:56:00+05:30',
  },
  source: 'manual',
  occurredAt: '2026-09-02T11:56:00+05:30',
};

const refusal = new ApiRequestError(403, {
  code: 'permission_denied',
  message: 'This visit is outside your territory working hours.',
  requestId: 'req-1',
  fieldErrors: null,
});

describe('what gets queued', () => {
  it('queues work the server never answered', async () => {
    // The whole of FE-G2: an MR who loses signal at a clinic door must not lose the
    // check-in. Before the outbox existed this threw and the work was gone.
    const store = inMemory();
    const outcome = await sendOrQueue(
      () => Promise.reject(new Error('Network request failed')),
      checkInQueueItem(body),
      store,
    );
    expect(outcome.kind).toBe('queued');
    expect(store.current().items).toHaveLength(1);
  });

  it('does NOT queue work the server refused', async () => {
    // A refusal is a verdict — the server has the work and said no. Queueing it
    // would push the same refused item on every flush, forever.
    const store = inMemory();
    const outcome = await sendOrQueue(() => Promise.reject(refusal), checkInQueueItem(body), store);
    expect(outcome.kind).toBe('refused');
    expect(store.current().items).toHaveLength(0);
  });

  it('does not queue work that was accepted', async () => {
    const store = inMemory();
    const outcome = await sendOrQueue(() => Promise.resolve({}), checkInQueueItem(body), store);
    expect(outcome.kind).toBe('sent');
    expect(store.current().items).toHaveLength(0);
  });

  it('keeps the request id, because it is the idempotency key', async () => {
    // The server dedupes on it. A queue that minted a new id on retry would turn one
    // check-in into two.
    const store = inMemory();
    await sendOrQueue(() => Promise.reject(new Error('offline')), checkInQueueItem(body), store);
    expect(store.current().items[0]?.id).toBe(body.id);
  });

  it('does not create a second row for the same id', async () => {
    const store = inMemory();
    const item = checkInQueueItem(body);
    await sendOrQueue(() => Promise.reject(new Error('offline')), item, store);
    await sendOrQueue(() => Promise.reject(new Error('offline')), item, store);
    expect(store.current().items).toHaveLength(1);
  });
});

describe('the queue survives being read back', () => {
  it('returns items that still parse against the contract', async () => {
    const store = inMemory();
    await sendOrQueue(() => Promise.reject(new Error('offline')), checkInQueueItem(body), store);
    const stored = store.current().items[0];
    expect(stored?.entity).toBe('check_in');
    expect(stored?.entityId).toBe(body.visitId);
    expect(stored?.status).toBe('queued');
  });
});

describe('flushing', () => {
  const clientThat = (send: () => Promise<unknown>): ApiClient =>
    ({ createCheckIn: send }) as unknown as ApiClient;

  it('does nothing when there is nothing waiting', async () => {
    const result = await flushOutbox(
      clientThat(() => Promise.resolve({})),
      inMemory(),
    );
    expect(result).toEqual({ attempted: 0, sent: 0, stillQueued: 0 });
  });

  it('sends what is waiting and clears it', async () => {
    const store = inMemory();
    await sendOrQueue(() => Promise.reject(new Error('offline')), checkInQueueItem(body), store);
    const result = await flushOutbox(
      clientThat(() => Promise.resolve({})),
      store,
    );
    expect(result.sent).toBe(1);
    expect(result.stillQueued).toBe(0);
  });

  it('leaves work queued when the flush also fails', async () => {
    // Nothing is dropped on a failed attempt: no verdict means the server never saw
    // it, so the item goes back to queued rather than being marked failed.
    const store = inMemory();
    await sendOrQueue(() => Promise.reject(new Error('offline')), checkInQueueItem(body), store);
    const result = await flushOutbox(
      clientThat(() => Promise.reject(new Error('still offline'))),
      store,
    );
    expect(result.sent).toBe(0);
    expect(result.stillQueued).toBe(1);
  });

  it('keeps going after one item fails', async () => {
    // An MR whose second check-in fails should still have their third one sent.
    const store = inMemory();
    await sendOrQueue(() => Promise.reject(new Error('offline')), checkInQueueItem(body), store);
    await sendOrQueue(
      () => Promise.reject(new Error('offline')),
      checkInQueueItem({ ...body, id: '77777777-7777-4777-8777-777777777702' }),
      store,
    );

    let call = 0;
    const result = await flushOutbox(
      clientThat(() => {
        call += 1;
        return call === 1 ? Promise.reject(new Error('one bad')) : Promise.resolve({});
      }),
      store,
    );

    expect(result.attempted).toBe(2);
    expect(result.sent).toBe(1);
  });

  it('sends the payload the MR actually made, not a rebuilt one', async () => {
    // An outbox that reconstructs the body later can send something different from
    // what happened at the clinic door.
    const store = inMemory();
    await sendOrQueue(() => Promise.reject(new Error('offline')), checkInQueueItem(body), store);
    const seen = vi.fn(() => Promise.resolve({}));
    await flushOutbox(clientThat(seen), store);
    expect(seen).toHaveBeenCalledWith(
      expect.objectContaining({ id: body.id, visitId: body.visitId, occurredAt: body.occurredAt }),
    );
  });
});

/**
 * The flush routes by entity, and getting this wrong is a silent corruption.
 *
 * Until C5 there was exactly one thing on the queue, so the flush sent every row
 * through `createCheckIn`. That was correct by accident. With a second entity the
 * same code would replay a handover — an item name, a quantity, a declared value —
 * through `record_check_in`, which is a write of the wrong shape to the wrong
 * table on the MR's behalf. These tests pin the routing rather than the count.
 */
const sample: CreateSampleAndInputRequest = {
  id: '88888888-8888-4888-8888-888888888801',
  visitId: '66666666-6666-4666-8666-666666666601',
  doctorId: '66666666-6666-4666-8666-6666666666bb',
  kind: 'sample',
  itemName: 'Elmiron 100 mg, 30s',
  quantity: 2,
  declaredValueInr: 240,
  occurredAt: '2026-09-02T12:04:00+05:30',
};

describe('the flush sends each queued row through its own endpoint', () => {
  it('never replays a handover as a check-in', async () => {
    const store = inMemory();
    await sendOrQueue(
      () => Promise.reject(new Error('Network request failed')),
      sampleQueueItem(sample),
      store,
    );

    const createCheckIn = vi.fn(() => Promise.resolve({}));
    const createSampleAndInput = vi.fn(() => Promise.resolve({}));
    await flushOutbox({ createCheckIn, createSampleAndInput } as unknown as ApiClient, store);

    expect(createCheckIn).not.toHaveBeenCalled();
    expect(createSampleAndInput).toHaveBeenCalledTimes(1);
    // The payload goes back out byte-identical, which is what makes the retry the
    // same handover rather than a second one.
    expect(createSampleAndInput).toHaveBeenCalledWith(sample);
  });

  it('sends a mixed queue down both paths in one flush', async () => {
    const store = inMemory();
    const fail = () => Promise.reject(new Error('Network request failed'));
    await sendOrQueue(fail, checkInQueueItem(body), store);
    await sendOrQueue(fail, sampleQueueItem(sample), store);

    const createCheckIn = vi.fn(() => Promise.resolve({}));
    const createSampleAndInput = vi.fn(() => Promise.resolve({}));
    const result = await flushOutbox(
      { createCheckIn, createSampleAndInput } as unknown as ApiClient,
      store,
    );

    expect(createCheckIn).toHaveBeenCalledTimes(1);
    expect(createSampleAndInput).toHaveBeenCalledTimes(1);
    expect(result.sent).toBe(2);
  });

  it('leaves a row of an entity it cannot send where it is, rather than guessing', async () => {
    // A row written by a newer build. Posting it down whichever endpoint happened
    // to be first would be worse than leaving it queued, so it stays queued and
    // the queue screen keeps showing it as waiting.
    const store = inMemory();
    await sendOrQueue(
      () => Promise.reject(new Error('Network request failed')),
      { ...checkInQueueItem(body), entity: 'recording' as const },
      store,
    );

    const createCheckIn = vi.fn(() => Promise.resolve({}));
    const result = await flushOutbox({ createCheckIn } as unknown as ApiClient, store);

    expect(createCheckIn).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
    expect(store.current().items).toHaveLength(1);
  });
});

/**
 * A consent answer waits on disk exactly as a check-in does, and a decline waits
 * exactly as a yes does.
 *
 * The second of those is the one worth a test. All three outcomes post to the same
 * endpoint and all three succeed; an outbox that retried a consent eagerly and a
 * decline lazily would be the app putting its thumb on the scale after the doctor
 * had already answered.
 */
const consent = (outcome: 'consented' | 'declined'): CreateConsentRecordRequest => ({
  id:
    outcome === 'consented'
      ? '99999999-9999-4999-8999-999999999901'
      : '99999999-9999-4999-8999-999999999902',
  visitId: '66666666-6666-4666-8666-666666666601',
  doctorId: '66666666-6666-4666-8666-6666666666bb',
  outcome,
  notAskedReason: null,
  consentTextVersionId: '66666666-6666-4666-8666-6666666666dd',
  displayedLanguage: 'en-IN',
  capturedAt: '2026-09-02T11:58:00+05:30',
});

describe('a queued consent answer', () => {
  it('goes back out through the consent endpoint, byte-identical', async () => {
    const store = inMemory();
    await sendOrQueue(
      () => Promise.reject(new Error('Network request failed')),
      consentQueueItem(consent('declined')),
      store,
    );

    const createConsentRecord = vi.fn(() => Promise.resolve({}));
    const createCheckIn = vi.fn(() => Promise.resolve({}));
    await flushOutbox({ createConsentRecord, createCheckIn } as unknown as ApiClient, store);

    expect(createCheckIn).not.toHaveBeenCalled();
    // The version id and the displayed language survive the queue. Without them the
    // record cannot say what was agreed to, and an unprovable consent is worse than
    // a missing one.
    expect(createConsentRecord).toHaveBeenCalledWith(consent('declined'));
  });

  it('treats a decline and a consent identically', async () => {
    const store = inMemory();
    const fail = () => Promise.reject(new Error('Network request failed'));
    await sendOrQueue(fail, consentQueueItem(consent('declined')), store);
    await sendOrQueue(fail, consentQueueItem(consent('consented')), store);

    const createConsentRecord = vi.fn(() => Promise.resolve({}));
    const result = await flushOutbox({ createConsentRecord } as unknown as ApiClient, store);

    expect(createConsentRecord).toHaveBeenCalledTimes(2);
    expect(result.sent).toBe(2);
  });
});
