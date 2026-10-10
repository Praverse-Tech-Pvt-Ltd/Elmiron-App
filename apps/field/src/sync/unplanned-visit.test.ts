import { describe, expect, it, vi } from 'vitest';
import { DoctorSchema, VisitSchema } from '@fieldforce/core';
import type {
  CreateCallReportRequest,
  CreateCheckInRequest,
  SyncQueueItem,
} from '@fieldforce/core';
import {
  callReportQueueItem,
  checkInQueueItem,
  checkOutQueueItem,
  enqueueFirst,
  flushOutbox,
  unplannedVisitQueueItem,
} from './outbox';
import type { QueuePersistence } from './outbox';
import { SyncPushRefusal, createPushClient } from './push-client';
import type { OutboxWriteClient } from './push-client';
import { emptyQueue } from './reducer';
import type { SyncQueueState } from './reducer';
import { pendingVisits, phoneMadeVisit, visitFor } from './selectors';
import {
  PROBLEM_WORDS,
  REASON_MAX,
  draftProblem,
  unplannedVisitRequest,
} from '../visits/unplanned';

/**
 * `BE-W176` / `BE-C78` — an unplanned visit made on the phone: the form's rules, what is queued,
 * the hold-back that keeps its check-in, report and check-out behind it, retries, read-back while
 * offline, and the merge with the server's copy.
 *
 * The dependency is the repository's own: every visit item carries the visit id as `entityId`.
 * Nothing here waits on a timer; every order is the queue's.
 */

const VISIT = '66666666-6666-4666-8666-666666666601';
const DOCTOR = '33333333-3333-4333-8333-333333333301';
const CLINIC = '44444444-4444-4444-8444-444444444401';
const OTHER_CLINIC = '44444444-4444-4444-8444-444444444499';
const REP = '22222222-2222-4222-8222-2222222222aa';
const MADE_AT = '2026-10-09T10:15:00.000Z';

const doctor = DoctorSchema.parse({
  id: DOCTOR,
  fullName: 'Dr Asha Deshpande',
  registrationNumber: null,
  specialty: null,
  qualification: null,
  territoryId: '11111111-1111-4111-8111-111111111103',
  assignedMrId: null,
  clinicAddresses: [
    {
      id: CLINIC,
      doctorId: DOCTOR,
      label: 'Main clinic',
      line1: '1 Road',
      line2: null,
      city: 'Pune',
      state: 'Maharashtra',
      postalCode: '411001',
      coordinates: null,
      geofenceRadiusMetres: 150,
    },
  ],
  isActive: true,
  createdAt: MADE_AT,
  updatedAt: MADE_AT,
});

/** A queue on disk, as JSON -- so every assertion is about what survives serialisation. */
const onDisk = (): QueuePersistence & { current: () => SyncQueueState } => {
  let saved = JSON.stringify(emptyQueue);
  return {
    read: () =>
      Promise.resolve({ kind: 'loaded' as const, state: JSON.parse(saved) as SyncQueueState }),
    write: (next) => {
      saved = JSON.stringify(next);
      return Promise.resolve();
    },
    current: () => JSON.parse(saved) as SyncQueueState,
  };
};

const ME = (): string => REP;

const visitBody = unplannedVisitRequest(
  { doctorId: DOCTOR, clinicAddressId: CLINIC, reason: '  Doctor called me in  ' },
  VISIT,
  MADE_AT,
);
const checkIn: CreateCheckInRequest = {
  id: '77777777-7777-4777-8777-777777777701',
  visitId: VISIT,
  coordinates: {
    latitude: 18.52,
    longitude: 73.85,
    accuracyMetres: 10,
    capturedAt: '2026-10-09T10:20:00Z',
  },
  source: 'manual',
  occurredAt: '2026-10-09T10:20:00Z',
};
const checkOut: CreateCheckInRequest = {
  ...checkIn,
  id: '77777777-7777-4777-8777-777777777702',
  occurredAt: '2026-10-09T10:40:00Z',
};
const report: CreateCallReportRequest = {
  id: '77777777-7777-4777-8777-777777777703',
  visitId: VISIT,
  summary: 'Discussed the dosing guide.',
  productIdsDiscussed: [],
  objectionsRaised: null,
  nextStep: null,
};

/**
 * The four, queued offline in the order the rep did them. The queue orders rows by when the phone
 * made them (`clientCreatedAt`, ties broken by id), so each is made a second after the last -- as
 * taps are -- with the clock under the test's control, never a sleep.
 */
const aDayOffline = async (): Promise<ReturnType<typeof onDisk>> => {
  const store = onDisk();
  const at = (second: number): void => {
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 9, 10, 15, second)));
  };
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    at(0);
    await enqueueFirst(unplannedVisitQueueItem(visitBody), store);
    at(1);
    await enqueueFirst(checkInQueueItem(checkIn), store);
    at(2);
    await enqueueFirst(callReportQueueItem(report), store);
    at(3);
    await enqueueFirst(checkOutQueueItem(checkOut), store);
  } finally {
    vi.useRealTimers();
  }
  return store;
};

/** A client that records the order of every send. */
const recording = (visitSend: () => Promise<unknown>) => {
  const order: string[] = [];
  const ok = (name: string) =>
    vi.fn(() => {
      order.push(name);
      return Promise.resolve({ receivedAt: '2026-10-09T11:00:00Z', warnings: [] });
    });
  const client = {
    createUnplannedVisit: vi.fn(() => {
      order.push('visit');
      return visitSend();
    }),
    createCheckIn: ok('check_in'),
    createCallReport: ok('call_report'),
    createCheckOut: ok('check_out'),
  };
  return { client: client as unknown as OutboxWriteClient, order, raw: client };
};

const statusOf = (state: SyncQueueState, id: string): SyncQueueItem | undefined =>
  state.items.find((item) => item.id === id);

// =============================================================================
// 1. The form
// =============================================================================

describe('BE-W176 — the form', () => {
  const draft = { doctorId: DOCTOR, clinicAddressId: CLINIC, reason: 'Doctor called me in' };

  it('needs a doctor of the rep’s own, and a clinic of that doctor’s', () => {
    expect(draftProblem({ ...draft, doctorId: '' }, [doctor])).toBe('no_doctor');
    expect(
      draftProblem({ ...draft, doctorId: '99999999-9999-4999-8999-999999999999' }, [doctor]),
    ).toBe('no_doctor');
    expect(draftProblem({ ...draft, clinicAddressId: OTHER_CLINIC }, [doctor])).toBe(
      'clinic_not_doctors',
    );
    expect(draftProblem({ ...draft, clinicAddressId: null }, [doctor])).toBeNull();
  });

  it('needs a reason of 3 to 500 characters, as the database checks -- spaces do not count', () => {
    expect(draftProblem({ ...draft, reason: '  a ' }, [doctor])).toBe('reason_too_short');
    expect(draftProblem({ ...draft, reason: 'x'.repeat(REASON_MAX + 1) }, [doctor])).toBe(
      'reason_too_long',
    );
    expect(draftProblem({ ...draft, reason: 'abc' }, [doctor])).toBeNull();
    expect(PROBLEM_WORDS.reason_too_short).toMatch(/why/u);
  });

  it('builds the request with the reason trimmed, the one id, and the moment it was made', () => {
    expect(visitBody).toEqual({
      id: VISIT,
      doctorId: DOCTOR,
      clinicAddressId: CLINIC,
      scheduledFor: MADE_AT,
      unplannedReason: 'Doctor called me in',
    });
  });
});

// =============================================================================
// 2. What is queued, and what is sent
// =============================================================================

describe('BE-W176 — what the phone queues and sends', () => {
  it('an offline unplanned visit is ONE queued `visit` item, keyed by the visit id, that survives the disk', async () => {
    const store = onDisk();
    expect(await enqueueFirst(unplannedVisitQueueItem(visitBody), store)).toEqual({
      kind: 'queued',
    });
    const [item] = store.current().items;
    expect(item).toMatchObject({ id: VISIT, entity: 'visit', entityId: VISIT, status: 'queued' });
    expect(item?.payload).toMatchObject({
      id: VISIT,
      doctorId: DOCTOR,
      clinicAddressId: CLINIC,
      scheduledFor: MADE_AT,
      unplannedReason: 'Doctor called me in',
    });
  });

  it('sends origin UNPLANNED with the reason -- and no rep, organisation or plan the server should decide', async () => {
    const rpc = vi.fn((_fn: string, _args: Record<string, unknown>) =>
      Promise.resolve({
        data: {
          batchId: '88888888-8888-4888-8888-888888888888',
          results: [
            {
              id: VISIT,
              status: 'accepted',
              rejectionCode: null,
              sqlState: null,
              sqlDetail: null,
              sqlHint: null,
              rejectionDetail: null,
              warnings: [],
            },
          ],
          serverTime: '2026-10-09T11:00:00Z',
        },
        error: null,
      }),
    );
    await createPushClient({
      client: { rpc },
      newBatchId: () => '88888888-8888-4888-8888-888888888888',
    }).createUnplannedVisit(visitBody);

    const args = rpc.mock.calls[0]?.[1] as {
      p_items: { id: string; entity: string; entityId: string; payload: Record<string, unknown> }[];
    };
    const [sent] = args.p_items;
    expect(sent).toMatchObject({ id: VISIT, entity: 'visit', entityId: VISIT });
    expect(sent?.payload).toEqual({
      doctorId: DOCTOR,
      clinicAddressId: CLINIC,
      scheduledFor: MADE_AT,
      origin: 'unplanned',
      unplannedReason: 'Doctor called me in',
    });
    for (const owned of ['mrId', 'mr_id', 'organisationId', 'organisation_id', 'beatPlanId']) {
      expect(sent?.payload, `${owned} is the server's to decide`).not.toHaveProperty(owned);
    }
  });
});

// =============================================================================
// 3. The hold-back
// =============================================================================

describe('BE-W176 — nothing is sent for a visit the server does not have yet', () => {
  it('visit fails without an answer: check-in, report and check-out are NOT sent, and stay queued with a reason', async () => {
    const store = await aDayOffline();
    const { client, order } = recording(() => Promise.reject(new Error('Network request failed')));

    await flushOutbox(client, store, ME);

    expect(order).toEqual(['visit']);
    const state = store.current();
    for (const id of [checkIn.id, report.id, checkOut.id]) {
      expect(statusOf(state, id)).toMatchObject({
        status: 'queued',
        lastError: 'Waiting for its visit to be sent first.',
      });
    }
    expect(statusOf(state, VISIT)?.status).toBe('queued');
  });

  it('then signal: the visit first, then the three in the order they were done -- each once', async () => {
    const store = await aDayOffline();
    await flushOutbox(
      recording(() => Promise.reject(new Error('Network request failed'))).client,
      store,
      ME,
    );

    const second = recording(() =>
      Promise.resolve({ receivedAt: '2026-10-09T11:00:00Z', warnings: [] }),
    );
    await flushOutbox(second.client, store, ME);
    expect(second.order).toEqual(['visit', 'check_in', 'call_report', 'check_out']);
    expect(store.current().items.every((item) => item.status === 'synced')).toBe(true);

    // A later flush has nothing left: no second visit, no second check-in.
    const third = recording(() => Promise.resolve({}));
    await flushOutbox(third.client, store, ME);
    expect(third.order).toEqual([]);
  });

  it('the visit REFUSED: it is not retried, and its dependents are held, saying why, never sent', async () => {
    const store = await aDayOffline();
    const refused = recording(() =>
      Promise.reject(
        new SyncPushRefusal({
          message: 'unplanned_visit_needs_reason',
          sqlState: '22023',
          rejectionCode: 'validation_failed',
          deadLettered: false,
          detail: null,
          hint: null,
        }),
      ),
    );
    await flushOutbox(refused.client, store, ME);
    expect(refused.order).toEqual(['visit']);
    expect(statusOf(store.current(), VISIT)?.status).toBe('failed');

    const again = recording(() => Promise.resolve({}));
    await flushOutbox(again.client, store, ME);
    expect(again.order, 'a refused visit is terminal, not spun').toEqual([]);
    expect(statusOf(store.current(), checkIn.id)).toMatchObject({
      status: 'queued',
      lastError:
        'Not sent: the server refused the visit this belongs to. See that visit on this screen.',
    });
  });

  it('a visit left refused by an EARLIER flush still holds a check-in queued later', async () => {
    const store = onDisk();
    await enqueueFirst(unplannedVisitQueueItem(visitBody), store);
    const refusal = new SyncPushRefusal({
      message: 'refused',
      sqlState: '22023',
      rejectionCode: 'validation_failed',
      deadLettered: false,
      detail: null,
      hint: null,
    });
    await flushOutbox(recording(() => Promise.reject(refusal)).client, store, ME);
    await enqueueFirst(checkInQueueItem(checkIn), store);

    const later = recording(() => Promise.resolve({}));
    await flushOutbox(later.client, store, ME);
    expect(later.raw.createCheckIn).not.toHaveBeenCalled();
  });

  it('a check-in that ties with its visit and sorts AHEAD of it is held, then sent -- never refused', async () => {
    // Same millisecond, and an id that sorts before the visit's: the queue's own tie-break puts the
    // check-in first. The hold-back is computed from the whole queue before anything is sent, so the
    // check-in waits this flush and goes on the next.
    const early = { ...checkIn, id: '00000000-0000-4000-8000-000000000001' };
    const store = onDisk();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-09T10:15:00.000Z'));
    try {
      await enqueueFirst(unplannedVisitQueueItem(visitBody), store);
      await enqueueFirst(checkInQueueItem(early), store);
    } finally {
      vi.useRealTimers();
    }
    expect(store.current().items.map((item) => item.entity)).toEqual(['check_in', 'visit']);

    const first = recording(() => Promise.resolve({}));
    await flushOutbox(first.client, store, ME);
    expect(first.order).toEqual(['visit']);
    expect(statusOf(store.current(), early.id)?.status).toBe('queued');

    const second = recording(() => Promise.resolve({}));
    await flushOutbox(second.client, store, ME);
    expect(second.order).toEqual(['check_in']);
  });

  it('an item for a PLANNED visit (no queued visit item) is not held', async () => {
    const store = onDisk();
    await enqueueFirst(checkInQueueItem(checkIn), store);
    const { order } = recording(() => Promise.resolve({}));
    const run = recording(() => Promise.resolve({}));
    await flushOutbox(run.client, store, ME);
    expect(order).toEqual([]);
    expect(run.order).toEqual(['check_in']);
  });
});

// =============================================================================
// 4. Read back, and the merge with the server's copy
// =============================================================================

describe('BE-W176 — the visit is on the phone at once, and once', () => {
  it('queued and offline: read back as an UNPLANNED visit with its reason, not started, no day claimed', async () => {
    const store = await aDayOffline();
    const visit = phoneMadeVisit(VISIT, store.current().items, REP);
    expect(visit).toMatchObject({
      id: VISIT,
      mrId: REP,
      doctorId: DOCTOR,
      clinicAddressId: CLINIC,
      origin: 'unplanned',
      unplannedReason: 'Doctor called me in',
      beatPlanId: null,
      status: 'planned',
      visitDay: null,
    });
    expect(VisitSchema.safeParse(visit).success, 'a whole Visit, as the screens expect').toBe(true);
  });

  it('nothing to read back without a signed-in rep, or for an id the phone did not make', async () => {
    const store = await aDayOffline();
    expect(phoneMadeVisit(VISIT, store.current().items, null)).toBeNull();
    expect(phoneMadeVisit(checkIn.id, store.current().items, REP)).toBeNull();
  });

  it('after sync: the server’s copy replaces the phone’s by id -- one visit, the server’s day and status', async () => {
    const store = await aDayOffline();
    const fromServer = VisitSchema.parse({
      id: VISIT,
      mrId: REP,
      doctorId: DOCTOR,
      beatPlanId: null,
      origin: 'unplanned',
      plannedDate: null,
      unplannedReason: 'Doctor called me in',
      clinicAddressId: CLINIC,
      status: 'completed',
      notMetReason: null,
      scheduledFor: MADE_AT,
      startedAt: '2026-10-09T10:20:00Z',
      completedAt: '2026-10-09T10:40:00Z',
      visitDay: '2026-10-09',
      receivedAt: '2026-10-09T11:00:00Z',
      createdAt: '2026-10-09T11:00:00Z',
      updatedAt: '2026-10-09T11:00:01Z',
    });
    const shown = visitFor(VISIT, [fromServer], store.current().items, REP);
    expect(shown).toBe(fromServer);
    expect(shown).toMatchObject({
      origin: 'unplanned',
      status: 'completed',
      visitDay: '2026-10-09',
    });
  });
});

// =============================================================================
// 5. Pending sync -- MR-47 kept: no day until the server gives one
// =============================================================================

describe('BE-W176 — Pending sync: no day until the server gives one', () => {
  const serverCopy = (status: 'planned' | 'completed') =>
    VisitSchema.parse({
      id: VISIT,
      mrId: REP,
      doctorId: DOCTOR,
      beatPlanId: null,
      origin: 'unplanned',
      plannedDate: null,
      unplannedReason: 'Doctor called me in',
      clinicAddressId: CLINIC,
      status,
      notMetReason: null,
      scheduledFor: MADE_AT,
      startedAt: null,
      completedAt: null,
      visitDay: '2026-10-09',
      receivedAt: '2026-10-09T11:00:00Z',
      createdAt: '2026-10-09T11:00:00Z',
      updatedAt: '2026-10-09T11:00:00Z',
    });

  it('offline: the visit is Pending sync, waiting, with no day', async () => {
    const store = await aDayOffline();
    const pending = pendingVisits(store.current(), [], REP);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ state: 'waiting', problem: null });
    expect(pending[0]?.visit).toMatchObject({ id: VISIT, origin: 'unplanned', visitDay: null });
  });

  it('no signed-in rep: nothing pending is shown', async () => {
    const store = await aDayOffline();
    expect(pendingVisits(store.current(), [], null)).toEqual([]);
  });

  it('sent but not yet pulled: still pending ("sent"); once the pull has it, gone from Pending sync', async () => {
    const store = await aDayOffline();
    await flushOutbox(recording(() => Promise.resolve({})).client, store, ME);
    expect(pendingVisits(store.current(), [], REP).map((p) => p.state)).toEqual(['sent']);

    const pulled = [serverCopy('completed')];
    expect(pendingVisits(store.current(), pulled, REP)).toEqual([]);
    // ...and the one copy shown is the server's, under the server's day.
    expect(visitFor(VISIT, pulled, store.current().items, REP)).toMatchObject({
      visitDay: '2026-10-09',
    });
  });

  it('refused: pending with the server’s explanation -- never moved to a day', async () => {
    const store = await aDayOffline();
    await flushOutbox(
      recording(() =>
        Promise.reject(
          new SyncPushRefusal({
            message: 'unplanned_visit_needs_reason',
            sqlState: '22023',
            rejectionCode: 'validation_failed',
            deadLettered: false,
            detail: null,
            hint: null,
          }),
        ),
      ).client,
      store,
      ME,
    );
    const [entry] = pendingVisits(store.current(), [], REP);
    expect(entry?.state).toBe('refused');
    expect(entry?.problem).toBeTruthy();
    expect(entry?.visit.visitDay).toBeNull();
  });

  it('a refusal the server did not explain still says where to act', () => {
    const item = { ...unplannedVisitQueueItem(visitBody), status: 'failed' as const };
    const [entry] = pendingVisits({ items: [item], rejections: {} }, [], REP);
    expect(entry?.problem).toMatch(/queue screen/u);
  });

  it('midnight and a device timezone change reclassify nothing: the list takes no clock at all', async () => {
    const store = await aDayOffline();
    const zone = process.env['TZ'];
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-09T18:29:59Z')); // 23:59:59 in India
      process.env['TZ'] = 'Asia/Kolkata';
      const before = pendingVisits(store.current(), [], REP);
      vi.setSystemTime(new Date('2026-10-09T18:30:01Z')); // 00:00:01 the next day in India
      process.env['TZ'] = 'America/New_York';
      const after = pendingVisits(store.current(), [], REP);
      expect(after).toEqual(before);
      expect(after[0]?.visit.visitDay, 'no day is ever claimed').toBeNull();
    } finally {
      vi.useRealTimers();
      if (zone === undefined) delete process.env['TZ'];
      else process.env['TZ'] = zone;
    }
  });
});
