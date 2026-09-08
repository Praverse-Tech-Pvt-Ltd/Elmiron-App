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
  checkOutQueueItem,
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

describe('MR-08 C: a departure is not an arrival, and the clock is the server’s', () => {
  it('replays a queued CHECK-OUT as a check-out, never as a check-in', async () => {
    // **The defect.** `visit/[id].tsx` queued both stages with `checkInQueueItem`, so a
    // check-out taken with no signal was written to disk as `entity: 'check_in'` and
    // replayed through `createCheckIn`. An MR who lost signal at the clinic door had
    // their DEPARTURE recorded as an ARRIVAL: a real geo-and-time record, against the
    // right visit, describing the wrong event, with nothing reporting a problem.
    //
    // `CreateCheckOutRequestSchema` IS `CreateCheckInRequestSchema`, so no shape check
    // anywhere could have caught it, and `check_out` had been in `SyncEntitySchema` since
    // the enum was written without a single caller.
    const store = inMemory();
    await sendOrQueue(
      () => Promise.reject(new Error('Network request failed')),
      checkOutQueueItem(body),
      store,
    );
    expect(store.current().items[0]?.entity).toBe('check_out');

    const createCheckIn = vi.fn(() => Promise.resolve({}));
    const createCheckOut = vi.fn(() => Promise.resolve({}));
    await flushOutbox({ createCheckIn, createCheckOut } as unknown as ApiClient, store);

    expect(createCheckIn).not.toHaveBeenCalled();
    expect(createCheckOut).toHaveBeenCalledTimes(1);
    expect(createCheckOut).toHaveBeenCalledWith(body);
  });

  it('THE POSITIVE CONTROL: a queued check-IN still replays as a check-in', async () => {
    // Without this, the assertion above is also satisfied by an outbox that sends every
    // arrival as a departure — the same defect pointing the other way.
    const store = inMemory();
    await sendOrQueue(
      () => Promise.reject(new Error('Network request failed')),
      checkInQueueItem(body),
      store,
    );

    const createCheckIn = vi.fn(() => Promise.resolve({}));
    const createCheckOut = vi.fn(() => Promise.resolve({}));
    await flushOutbox({ createCheckIn, createCheckOut } as unknown as ApiClient, store);

    expect(createCheckOut).not.toHaveBeenCalled();
    expect(createCheckIn).toHaveBeenCalledTimes(1);
  });

  it('carries the SERVER’s receivedAt out of the response', async () => {
    // C5. This used to be `new Date().toISOString()` under the comment "the server
    // answered, so this is the server's clock by definition". Every created entity
    // carries `received_at`, stamped by `clock_timestamp()`, so the real value was in
    // the response the whole time.
    const store = inMemory();
    await sendOrQueue(
      () => Promise.reject(new Error('Network request failed')),
      checkInQueueItem(body),
      store,
    );

    const serverStamp = '2026-09-08T11:22:33.444Z';
    const createCheckIn = vi.fn(() => Promise.resolve({ receivedAt: serverStamp }));
    await flushOutbox({ createCheckIn } as unknown as ApiClient, store);

    expect(store.current().items[0]?.syncedAt).toBe(serverStamp);
  });

  it('and carries NOTHING when the response has no server clock', async () => {
    // The other state. A response shape this build does not recognise is not a reason to
    // invent a timestamp: the item is still accepted, it simply has no server clock, and
    // `QueueScreen` renders nothing rather than something untrue.
    const store = inMemory();
    await sendOrQueue(
      () => Promise.reject(new Error('Network request failed')),
      checkInQueueItem(body),
      store,
    );

    const createCheckIn = vi.fn(() => Promise.resolve({}));
    const result = await flushOutbox({ createCheckIn } as unknown as ApiClient, store);

    expect(result.sent).toBe(1);
    expect(store.current().items[0]?.status).toBe('synced');
    expect(store.current().items[0]?.syncedAt).toBeNull();
  });
});

describe('MR-09 B: the misroute class, not just the one instance', () => {
  it('B2: a payload labelled check_in in a check_out row is REFUSED, not sent as the other kind', async () => {
    // The exact corruption, reconstructed. This is what the buggy build wrote: a row whose
    // `entity` says one event and whose body is the other. Before the discriminant, every
    // shape check in the system agreed the row was fine — `CreateCheckOutRequestSchema`
    // **is** `CreateCheckInRequestSchema`, so two distinct events had one shape and a type
    // system cannot separate those by construction.
    const store = inMemory();
    await sendOrQueue(
      () => Promise.reject(new Error('Network request failed')),
      { ...checkOutQueueItem(body), payload: { ...body, __queueEntity: 'check_in' } },
      store,
    );

    const createCheckIn = vi.fn(() => Promise.resolve({}));
    const createCheckOut = vi.fn(() => Promise.resolve({}));
    await flushOutbox({ createCheckIn, createCheckOut } as unknown as ApiClient, store);

    // Neither. Not sent as the wrong event, and not sent as the right one either — the
    // row contradicts itself and nothing here is entitled to guess which half is true.
    expect(createCheckIn).not.toHaveBeenCalled();
    expect(createCheckOut).not.toHaveBeenCalled();

    // And it is VISIBLE: back to queued with a reason, on its way to a person.
    const item = store.current().items[0];
    expect(item?.status).toBe('queued');
    expect(item?.lastError).toMatch(/different version of the app/i);
  });

  it('B2: a payload with no discriminant at all is refused rather than trusted', async () => {
    // A row from a build older than this one — which is exactly the build that wrote
    // departures labelled as arrivals. Replaying one on its own word is the defect.
    const store = inMemory();
    const legacyPayload: Record<string, unknown> = { ...body };
    await sendOrQueue(
      () => Promise.reject(new Error('Network request failed')),
      { ...checkOutQueueItem(body), payload: legacyPayload },
      store,
    );

    const createCheckOut = vi.fn(() => Promise.resolve({}));
    await flushOutbox({ createCheckOut } as unknown as ApiClient, store);

    expect(createCheckOut).not.toHaveBeenCalled();
    expect(store.current().items[0]?.status).toBe('queued');
  });

  it('B4: an entity with no endpoint is returned to the queue, not STRANDED in flight', async () => {
    // The second defect in the same dispatch. `batch_started` marks every selected row
    // `in_flight`; the old code then did `if (send === null) continue`, recording no
    // verdict at all — and every later flush selects only `queued`. The row was stranded:
    // never retried, never shown as needing attention, never reported. The comment said it
    // was "left where it is"; it was left where nothing would ever look again.
    const store = inMemory();
    await sendOrQueue(
      () => Promise.reject(new Error('Network request failed')),
      {
        ...checkInQueueItem(body),
        entity: 'recording',
        payload: { ...body, __queueEntity: 'recording' },
      },
      store,
    );

    const createCheckIn = vi.fn(() => Promise.resolve({}));
    await flushOutbox({ createCheckIn } as unknown as ApiClient, store);

    expect(createCheckIn).not.toHaveBeenCalled();
    const item = store.current().items[0];
    expect(item?.status, 'a row nothing can send must not sit in_flight forever').toBe('queued');
    expect(item?.lastError).toMatch(/cannot send this kind of item yet/i);
    expect(item?.attemptCount).toBeGreaterThan(1);
  });

  it('THE POSITIVE CONTROL: a correctly labelled row still sends', async () => {
    // Without this, every assertion above is satisfied by an outbox that refuses
    // everything — which would "fix" the misroute by never sending anything again.
    const store = inMemory();
    await sendOrQueue(
      () => Promise.reject(new Error('Network request failed')),
      checkOutQueueItem(body),
      store,
    );

    const createCheckOut = vi.fn(() => Promise.resolve({ receivedAt: '2026-09-08T00:00:00.000Z' }));
    await flushOutbox({ createCheckOut } as unknown as ApiClient, store);

    expect(createCheckOut).toHaveBeenCalledTimes(1);
    // And the body that goes out is the contract's, with no device-local marker on it.
    expect(createCheckOut).toHaveBeenCalledWith(body);
    expect(store.current().items[0]?.status).toBe('synced');
  });
});

describe('MR-10 C: a refusal during a flush is not a silence', () => {
  const refusal = () =>
    new ApiRequestError(403, {
      code: 'permission_denied',
      message: 'The consent notice changed since it was displayed.',
      requestId: 'req-1',
      fieldErrors: null,
    });

  it('dead-letters a refused row instead of retrying it forever', async () => {
    // **The scheduled defect.** `sendOrQueue` has always told a refusal from a silence —
    // an ApiRequestError means the server answered, so the item is not queued. The FLUSH
    // did not: its catch recorded `attempt_failed` for everything, which returns the row
    // to `queued`.
    //
    // So nothing in the app ever produced `rejected` or `dead_lettered`, and the entire
    // rejection path was unreachable: RejectionRecord, the queue screen's rejection block,
    // deadLettered, attemptsRemaining, the server-clock line. A consent refused 45001
    // would have sat in the queue as "waiting to send", retried on every flush forever,
    // never explained — while the MR believed it was on its way.
    const store = inMemory();
    await sendOrQueue(
      () => Promise.reject(new Error('Network request failed')),
      checkInQueueItem(body),
      store,
    );

    const createCheckIn = vi.fn(() => Promise.reject(refusal()));
    await flushOutbox({ createCheckIn } as unknown as ApiClient, store);

    const item = store.current().items[0];
    expect(item?.status, 'a refused row must not go back to queued').toBe('failed');

    const rejection = store.current().rejections[body.id];
    expect(rejection).toBeDefined();
    expect(rejection?.deadLettered, 'a replayed payload is refused identically forever').toBe(true);
    // The server's sentence, verbatim.
    expect(rejection?.explanation).toBe('The consent notice changed since it was displayed.');
    // No server clock in an error body — carry none rather than the device's (MR-08 C5).
    expect(rejection?.receivedAt).toBeNull();
  });

  it('and a genuine silence still returns the row to the queue', async () => {
    // The other side, and the distinction the whole fix turns on. A network failure means
    // the server decided nothing, so the work is still the MR's to deliver.
    const store = inMemory();
    await sendOrQueue(
      () => Promise.reject(new Error('Network request failed')),
      checkInQueueItem(body),
      store,
    );

    const createCheckIn = vi.fn(() => Promise.reject(new Error('Network request failed')));
    await flushOutbox({ createCheckIn } as unknown as ApiClient, store);

    const item = store.current().items[0];
    expect(item?.status).toBe('queued');
    expect(item?.attemptCount).toBeGreaterThan(1);
    expect(store.current().rejections[body.id]).toBeUndefined();
  });

  it('THE POSITIVE CONTROL: an accepted row is still accepted', async () => {
    // Without this, both assertions above are satisfied by a flush that fails everything.
    const store = inMemory();
    await sendOrQueue(
      () => Promise.reject(new Error('Network request failed')),
      checkInQueueItem(body),
      store,
    );
    const createCheckIn = vi.fn(() => Promise.resolve({ receivedAt: '2026-09-08T00:00:00.000Z' }));
    await flushOutbox({ createCheckIn } as unknown as ApiClient, store);
    expect(store.current().items[0]?.status).toBe('synced');
  });
});
