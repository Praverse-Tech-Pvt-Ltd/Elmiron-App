import { describe, expect, it, vi } from 'vitest';
import { SyncPushRefusal, createPushClient } from './push-client';

/**
 * MR-18 B1/B4 — the five writes, through `sync_push`.
 *
 * These assert the CONTRACT with the server: the item shape sent, and what each verdict
 * means. The bounds themselves — geofence, shift window, the consent trio — are enforced
 * in the database and tested there; a client test that re-asserted them would be a second
 * copy of a rule this repository deliberately keeps in one place.
 */

const BATCH = '00000000-0000-4000-8000-00000000ba01';
const ITEM = '11111111-1111-4111-8111-111111111111';
const VISIT = '22222222-2222-4222-8222-222222222222';

const rpc = (impl: (fn: string, args: Record<string, unknown>) => unknown) => ({
  rpc: vi.fn((fn: string, args: Record<string, unknown>) =>
    Promise.resolve(
      impl(fn, args) as { data: unknown; error: { code?: string | null; message: string } | null },
    ),
  ),
});

const response = (over: Record<string, unknown> = {}) => ({
  batchId: BATCH,
  serverTime: '2026-09-10T09:00:00.000+00:00',
  results: [
    {
      id: ITEM,
      status: 'accepted',
      rejectionCode: null,
      sqlState: null,
      rejectionDetail: null,
      warnings: [],
    },
  ],
  queues: [],
  ...over,
});

const checkIn = {
  id: ITEM,
  visitId: VISIT,
  coordinates: {
    latitude: 18.52,
    longitude: 73.85,
    accuracyMetres: 8,
    capturedAt: '2026-09-10T08:00:00.000+00:00',
  },
  source: 'manual' as const,
  occurredAt: '2026-09-10T08:00:00.000+00:00',
};

/**
 * Real bodies per entity, not one shape reused.
 *
 * The first draft passed the check-in body to every method and the compiler refused it --
 * correctly. `CreateConsentRecordRequest` and `CreateSampleAndInputRequest` are genuinely
 * different shapes, and a test that pushed the wrong one would be asserting the entity
 * name while sending a payload the server would reject.
 */
const consent = {
  id: ITEM,
  visitId: VISIT,
  doctorId: '33333333-3333-4333-8333-333333333333',
  outcome: 'consented' as const,
  consentTextVersionId: '44444444-4444-4444-8444-444444444444',
  displayedLanguage: 'en-IN',
  capturedAt: '2026-09-10T08:00:00.000+00:00',
};

const sample = {
  id: ITEM,
  visitId: VISIT,
  doctorId: '33333333-3333-4333-8333-333333333333',
  kind: 'sample' as const,
  itemName: 'Elmiron 100mg',
  quantity: 4,
  declaredValueInr: 0,
  occurredAt: '2026-09-10T08:00:00.000+00:00',
};

const callReport = {
  id: ITEM,
  visitId: VISIT,
  summary: 'Discussed dosing.',
  productIdsDiscussed: [],
  objectionsRaised: null,
  nextStep: null,
};

const clientWith = (impl: (fn: string, args: Record<string, unknown>) => unknown) => {
  const db = rpc(impl);
  return { db, push: createPushClient({ client: db, newBatchId: () => BATCH }) };
};

describe('what reaches the server', () => {
  it('sends one item, keyed by the request id, with the visit as entityId', async () => {
    // The id is the idempotency key and is never regenerated -- that is what makes a retry
    // the same write rather than a second one. `entityId` is the visit, matching what
    // `outbox.ts` stores, so everything for one visit groups on the queue screen.
    const { db, push } = clientWith(() => ({ data: response(), error: null }));
    await push.createCheckIn(checkIn);

    expect(db.rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = db.rpc.mock.calls[0] ?? [];
    expect(fn).toBe('sync_push');
    expect(args?.['p_batch_id']).toBe(BATCH);
    expect(args?.['p_items']).toEqual([
      { id: ITEM, entity: 'check_in', entityId: VISIT, payload: checkIn },
    ]);
  });

  it('pushes a CHECK-OUT as check_out, not as a check-in', async () => {
    // **The MR-08 defect, at the new boundary.** `CreateCheckOutRequestSchema` IS
    // `CreateCheckInRequestSchema`, so no shape check anywhere can tell these apart -- a
    // departure sent under the wrong entity is a real geo-and-time record, against the
    // right visit, describing the wrong event, with nothing reporting a problem. Only a
    // value can separate them, so the value is asserted.
    const { db, push } = clientWith(() => ({ data: response(), error: null }));
    await push.createCheckOut(checkIn);
    expect((db.rpc.mock.calls[0]?.[1]?.['p_items'] as { entity: string }[])[0]?.entity).toBe(
      'check_out',
    );
  });

  it('names the right entity for each of the other three', async () => {
    // A positive control on the mapping as a whole: without it, "always check_in" would
    // pass the two cases above.
    const cases = [
      ['consent_record', (c: ReturnType<typeof clientWith>) => c.push.createConsentRecord(consent)],
      [
        'sample_and_input',
        (c: ReturnType<typeof clientWith>) => c.push.createSampleAndInput(sample),
      ],
      ['call_report', (c: ReturnType<typeof clientWith>) => c.push.createCallReport(callReport)],
    ] as const;
    for (const [entity, call] of cases) {
      const made = clientWith(() => ({ data: response(), error: null }));
      await call(made);
      expect(
        (made.db.rpc.mock.calls[0]?.[1]?.['p_items'] as { entity: string }[])[0]?.entity,
        `pushed the wrong entity for ${entity}`,
      ).toBe(entity);
    }
  });
});

describe('EXACTLY ONCE — B4', () => {
  it('treats a DUPLICATE as success, because the write landed and the answer did not', async () => {
    // **The replay that actually happens.** Not a synthetic double-send: the request
    // reached the server, the row was written, and the acknowledgement was lost on the way
    // back. The item is still queued on the device, so the next flush sends it again --
    // and `sync_push` answers `duplicate` because `sync_items.id` already holds it.
    //
    // Treating that as an error would dead-letter work the server already has, and ask the
    // MR to do something about the network's memory.
    const { push } = clientWith(() => ({
      data: response({
        results: [
          {
            id: ITEM,
            status: 'duplicate',
            rejectionCode: null,
            sqlState: null,
            rejectionDetail: null,
            warnings: [],
          },
        ],
      }),
      error: null,
    }));
    await expect(push.createCheckIn(checkIn)).resolves.toEqual({
      receivedAt: '2026-09-10T09:00:00.000+00:00',
    });
  });

  it('sends the SAME id on a replay, which is what makes the server able to dedupe', async () => {
    // The mechanism only works if the id is stable. A client that minted a new id per
    // attempt would turn one visit into two, and the server could not tell.
    const { db, push } = clientWith(() => ({ data: response(), error: null }));
    await push.createCheckIn(checkIn);
    await push.createCheckIn(checkIn);
    const ids = db.rpc.mock.calls.map((call) => (call[1]['p_items'] as { id: string }[])[0]?.id);
    expect(ids).toEqual([ITEM, ITEM]);
  });
});

describe('what a refusal carries', () => {
  it('throws a SyncPushRefusal carrying the SQLSTATE, not a flattened error', async () => {
    // MR-17 threaded `sqlState` to the queue screen so 45001, 45004, 45007 and 45008 each
    // reach the MR with their own remedy. Flattening it into an ApiRequestError here would
    // discard the field on the one path that finally has it.
    const { push } = clientWith(() => ({
      data: response({
        results: [
          {
            id: ITEM,
            status: 'rejected',
            rejectionCode: 'internal_error',
            sqlState: '45001',
            rejectionDetail: 'the consent notice changed since it was displayed',
            warnings: [],
          },
        ],
      }),
      error: null,
    }));

    await expect(push.createConsentRecord(consent)).rejects.toBeInstanceOf(SyncPushRefusal);
    const error = await push.createConsentRecord(consent).catch((e: unknown) => e);
    expect((error as SyncPushRefusal).sqlState).toBe('45001');
    expect((error as SyncPushRefusal).deadLettered).toBe(false);
    expect((error as SyncPushRefusal).message).toMatch(/consent notice changed/);
  });

  it('marks a dead_lettered verdict as such, so it is not retried forever', async () => {
    const { push } = clientWith(() => ({
      data: response({
        results: [
          {
            id: ITEM,
            status: 'dead_lettered',
            rejectionCode: 'internal_error',
            sqlState: '45004',
            rejectionDetail: 'over the cap',
            warnings: [],
          },
        ],
      }),
      error: null,
    }));
    const error = await push.createSampleAndInput(sample).catch((e: unknown) => e);
    expect((error as SyncPushRefusal).deadLettered).toBe(true);
  });

  it('a TRANSPORT failure is NOT a refusal — it must stay queued', async () => {
    // The distinction the whole outbox is built on. A refusal means the server answered
    // and said no, so retrying pushes the same refused item forever. A transport failure
    // means the server said nothing, so the work still needs sending. Throwing a plain
    // Error rather than a SyncPushRefusal is what keeps `flushOutbox` on the right side of
    // that line.
    const { push } = clientWith(() => ({ data: null, error: { message: 'network down' } }));
    const error = await push.createCheckIn(checkIn).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SyncPushRefusal);
  });

  it('refuses to guess when the response carries no verdict for this item', async () => {
    // A batch that came back without an answer for the item we sent is a server defect,
    // not a success. Returning `accepted` here would mark work as landed that nothing
    // confirmed.
    const { push } = clientWith(() => ({ data: response({ results: [] }), error: null }));
    await expect(push.createCheckIn(checkIn)).rejects.toThrow(/no verdict/i);
  });

  it('parses the response rather than casting it', async () => {
    // The only place that can notice the server changed shape.
    const { push } = clientWith(() => ({ data: { results: 'not an array' }, error: null }));
    await expect(push.createCheckIn(checkIn)).rejects.toThrow();
  });
});
