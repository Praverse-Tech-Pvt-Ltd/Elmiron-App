import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncPullResponse } from '@fieldforce/core';
import { memoryPullCursorStore } from './pull-cursor';
import {
  applyChanges,
  doctorWithAddresses,
  emptyStore,
  mapChanges,
  noticeFor,
  pullOnce,
  removalWording,
} from './pull';

/**
 * FE-W22 — the pull consumer.
 *
 * **The payloads below were captured from a real round trip**, not invented:
 * `services/api/tests/sync-pull-contract.spec.ts` calls `sync_pull` over HTTP through Kong
 * and PostgREST and parses the result with the contract's own schema, and these are the
 * rows it returned. That provenance is the point. An invented fixture would have been
 * camelCase, because that is what the contract says a `Visit` looks like — and every key
 * the server actually sends is snake_case, which is the divergence that made the mappers
 * necessary in the first place.
 *
 * The round-trip test is what keeps them honest: if the server's shape changes, it fails
 * there, in the workspace that has a database.
 */

const REAL_VISIT_ROW = {
  id: 'd7850b77-9d45-41ad-a1ba-80209103f747',
  mr_id: '89e39cd4-15a9-4935-9808-a2614201071f',
  status: 'completed',
  doctor_id: 'd00980db-502c-42b8-891a-5cfa2200c2d1',
  created_at: '2026-09-07T20:02:29.719617+00:00',
  started_at: '2026-09-07T18:02:29.719617+00:00',
  updated_at: '2026-09-07T20:02:29.719617+00:00',
  received_at: '2026-09-07T20:02:29.739645+00:00',
  beat_plan_id: null,
  completed_at: '2026-09-07T19:02:29.719617+00:00',
  not_met_reason: null,
  scheduled_for: null,
  clinic_address_id: null,
};

const REAL_DOCTOR_ROW = {
  id: 'd00980db-502c-42b8-891a-5cfa2200c2d1',
  full_name: 'Dr Pune Fixture',
  is_active: true,
  specialty: 'Urology',
  created_at: '2026-09-07T20:02:29.719617+00:00',
  updated_at: '2026-09-07T20:02:29.719617+00:00',
  territory_id: '08e509b4-49bb-4445-a771-c4a6cb356d6f',
  qualification: 'MBBS, MS',
  assigned_mr_id: '89e39cd4-15a9-4935-9808-a2614201071f',
  organisation_id: '93820c9c-19a6-4762-961b-f9f5ea368900',
  registration_number: 'MH-1001',
};

const REAL_BEAT_PLAN_ROW = {
  id: 'a553fe79-6034-4533-83f2-ca61b03659fe',
  mr_id: '89e39cd4-15a9-4935-9808-a2614201071f',
  status: 'submitted',
  version: 1,
  plan_date: '2026-09-07',
  created_at: '2026-09-07T20:02:29.719617+00:00',
  updated_at: '2026-09-07T20:02:29.719617+00:00',
  approved_at: null,
  territory_id: '08e509b4-49bb-4445-a771-c4a6cb356d6f',
  approved_by_user_id: null,
  supersedes_beat_plan_id: null,
};

const INCREMENTAL_COMPLETENESS = {
  phase: 2,
  reflects: ['insert', 'update', 'delete', 'out_of_scope'] as const,
  omits: [] as const,
  entities: ['visit', 'beat_plan', 'doctor'] as const,
  omittedEntities: ['consent_record', 'analysis'],
  note: 'Deletions arrive as payload-free tombstones …',
};

const FULL_RESYNC_COMPLETENESS = {
  phase: 2,
  reflects: ['insert', 'update'] as const,
  omits: ['delete', 'out_of_scope'] as const,
  entities: ['visit', 'beat_plan', 'doctor'] as const,
  omittedEntities: ['consent_record', 'analysis'],
  note: 'This is a full re-sync and carries no deletions …',
};

const response = (over: Partial<SyncPullResponse> = {}): SyncPullResponse =>
  ({
    changes: [],
    serverTime: '2026-09-07T20:02:29.754702+00:00',
    hasMore: false,
    nextCursor: '{"v": 1, "upto": null, "after": null, "since": "1389:1389:"}',
    completeness: INCREMENTAL_COMPLETENESS,
    ...over,
  }) as SyncPullResponse;

const upsert = (entity: string, payload: Record<string, unknown>) => ({
  entity,
  entityId: payload['id'],
  reason: 'upserted',
  payload,
  updatedAt: payload['updated_at'],
});

describe('mapping a real payload', () => {
  it('maps every entity the pull carries, from the keys the server actually sends', () => {
    const mapped = mapChanges(
      response({
        changes: [
          upsert('visit', REAL_VISIT_ROW),
          upsert('doctor', REAL_DOCTOR_ROW),
          upsert('beat_plan', REAL_BEAT_PLAN_ROW),
        ],
      } as unknown as Partial<SyncPullResponse>),
    );
    expect(mapped).toHaveLength(3);
    expect(mapped[0]).toMatchObject({ kind: 'upsert', entity: 'visit' });
    // camelCase out, snake_case in. This assertion is the divergence, written down.
    expect(mapped[0]).toMatchObject({
      record: { mrId: REAL_VISIT_ROW.mr_id, receivedAt: REAL_VISIT_ROW.received_at },
    });
    expect(mapped[1]).toMatchObject({ record: { fullName: 'Dr Pune Fixture' } });
    expect(mapped[2]).toMatchObject({ record: { planDate: '2026-09-07', version: 1 } });
  });

  it('drops organisation_id rather than carrying it into the app', () => {
    // `to_jsonb(d)` is an implicit `select *`, so the payload ships a column the contract
    // never modelled. Registered as BE-W71; this is the client half of not using it.
    const [mapped] = mapChanges(
      response({
        changes: [upsert('doctor', REAL_DOCTOR_ROW)],
      } as unknown as Partial<SyncPullResponse>),
    );
    expect(mapped).toBeDefined();
    expect(Object.keys((mapped as { record: object }).record)).not.toContain('organisationId');
    expect(Object.keys((mapped as { record: object }).record)).not.toContain('organisation_id');
  });

  it('refuses an upsert with no payload rather than inventing a record', () => {
    expect(() =>
      mapChanges(
        response({
          changes: [
            {
              entity: 'visit',
              entityId: REAL_VISIT_ROW.id,
              reason: 'upserted',
              payload: null,
              updatedAt: REAL_VISIT_ROW.updated_at,
            },
          ],
        } as unknown as Partial<SyncPullResponse>),
      ),
    ).toThrow(/no payload/);
  });

  /**
   * MR-12 Part B. `mapChange` is the SECOND dispatcher in pull.ts, forty lines above the
   * one MR-11 fixed, and it was left without an exhaustiveness guard because that audit
   * was scoped to the site the defect had been found at.
   *
   * A fifth `SyncPullEntity` did already break the build there, but as TS2366 — "Function
   * lacks ending return statement". That names the wrong problem, and the obvious fix for
   * it, a trailing `return` or `throw`, removes the guard permanently. With the `never`
   * default the compiler says `Type '"scratch_entity"' is not assignable to type 'never'`
   * and names the member instead.
   *
   * This asserts the runtime half, which the compile-time half is supposed to make
   * unreachable — an entity the server sends that this build has never heard of must fail
   * loudly rather than be mapped to whichever branch happens to be last.
   */
  it('refuses an entity it has no branch for, rather than mapping it to the last one', () => {
    expect(() =>
      mapChanges(
        response({
          changes: [
            {
              entity: 'scratch_entity',
              entityId: REAL_VISIT_ROW.id,
              reason: 'upserted',
              payload: REAL_VISIT_ROW,
              updatedAt: REAL_VISIT_ROW.updated_at,
            },
          ],
        } as unknown as Partial<SyncPullResponse>),
      ),
    ).toThrow(/unhandled pull entity/);
  });
});

describe('deletion and scope-loss are different things', () => {
  it('a tombstone removes the local row', () => {
    const seeded = applyChanges(
      emptyStore(),
      mapChanges(
        response({
          changes: [upsert('visit', REAL_VISIT_ROW)],
        } as unknown as Partial<SyncPullResponse>),
      ),
    );
    expect(seeded.visit.size).toBe(1);

    const after = applyChanges(
      seeded,
      mapChanges(
        response({
          changes: [
            {
              entity: 'visit',
              entityId: REAL_VISIT_ROW.id,
              reason: 'deleted',
              payload: null,
              updatedAt: REAL_VISIT_ROW.updated_at,
            },
          ],
        } as unknown as Partial<SyncPullResponse>),
      ),
    );
    expect(after.visit.size).toBe(0);
  });

  it('an out_of_scope event removes it too — the handset must not keep it', () => {
    // The privacy half of ADR §6 Q2: a reassigned MR does not keep the old list.
    const seeded = applyChanges(
      emptyStore(),
      mapChanges(
        response({
          changes: [upsert('doctor', REAL_DOCTOR_ROW)],
        } as unknown as Partial<SyncPullResponse>),
      ),
    );
    const after = applyChanges(
      seeded,
      mapChanges(
        response({
          changes: [
            {
              entity: 'doctor',
              entityId: REAL_DOCTOR_ROW.id,
              reason: 'out_of_scope',
              payload: null,
              updatedAt: REAL_DOCTOR_ROW.updated_at,
            },
          ],
        } as unknown as Partial<SyncPullResponse>),
      ),
    );
    expect(after.doctor.size).toBe(0);
  });

  it('C3: the word "deleted" never appears for an out_of_scope reason', () => {
    // "Deleted" is false for a reassignment, and for a consent record dangerously so.
    const wording = removalWording('out_of_scope');
    expect(wording.toLowerCase()).not.toMatch(/delet|removed on the server/);
    expect(wording).toMatch(/no longer yours/i);
    // And the reason survives mapping, so a screen can switch on it rather than infer it.
    const [mapped] = mapChanges(
      response({
        changes: [
          {
            entity: 'doctor',
            entityId: REAL_DOCTOR_ROW.id,
            reason: 'out_of_scope',
            payload: null,
            updatedAt: REAL_DOCTOR_ROW.updated_at,
          },
        ],
      } as unknown as Partial<SyncPullResponse>),
    );
    expect(mapped).toMatchObject({ kind: 'remove', reason: 'out_of_scope' });
  });
});

describe('the completeness field is surfaced, and only when it says something', () => {
  it('says nothing on an incremental pull that omits nothing', () => {
    // A notice on every pull trains people to dismiss it, and then it is not there on the
    // pull where it mattered. The silence is the feature.
    expect(noticeFor(INCREMENTAL_COMPLETENESS as never)).toBeNull();
  });

  it('speaks on a full re-sync, in words rather than a code', () => {
    const notice = noticeFor(FULL_RESYNC_COMPLETENESS as never);
    expect(notice).not.toBeNull();
    expect(notice?.body).toMatch(/full refresh/i);
    // No SQLSTATE, no field name, no "omits".
    expect(`${notice?.title ?? ''} ${notice?.body ?? ''}`).not.toMatch(
      /omit|45\d{3}|completeness/i,
    );
  });
});

describe('the pull loop', () => {
  const rpc = (
    impl: (args: Record<string, unknown>) => {
      data: unknown;
      error: { code?: string | null; message: string } | null;
    },
  ) => ({
    rpc: vi.fn((_fn: string, args: Record<string, unknown>) => Promise.resolve(impl(args))),
  });

  let cursors: ReturnType<typeof memoryPullCursorStore>;
  beforeEach(() => {
    cursors = memoryPullCursorStore();
  });

  it('persists the cursor, and sends it on the next pull — a restart in the only sense that matters', async () => {
    const client = rpc(() => ({ data: response(), error: null }));
    const first = await pullOnce({ userId: 'mr-1', cursors, client });
    expect(first.kind).toBe('pulled');

    // A new call, reading the cursor back out of the store rather than from memory.
    await pullOnce({ userId: 'mr-1', cursors, client });
    const second = client.rpc.mock.calls[1]?.[1];
    expect(second?.['p_cursor']).toBe(response().nextCursor);
  });

  it('keeps cursors apart per user, so a shared handset cannot skip a sweep', async () => {
    const client = rpc(() => ({ data: response(), error: null }));
    await pullOnce({ userId: 'mr-1', cursors, client });
    await pullOnce({ userId: 'mr-2', cursors, client });
    expect(client.rpc.mock.calls[1]?.[1]?.['p_cursor']).toBeNull();
  });

  it('C5: a too-old cursor triggers a full re-sync rather than a generic failure', async () => {
    await cursors.save('mr-1', 'an old cursor');
    let call = 0;
    const client = rpc((args) => {
      call += 1;
      if (call === 1) {
        expect(args['p_cursor']).toBe('an old cursor');
        return { data: null, error: { code: '45006', message: 'cursor too old' } };
      }
      expect(args['p_cursor']).toBeNull();
      return {
        data: response({
          completeness: FULL_RESYNC_COMPLETENESS,
        } as unknown as Partial<SyncPullResponse>),
        error: null,
      };
    });

    const outcome = await pullOnce({ userId: 'mr-1', cursors, client });
    expect(outcome.kind).toBe('pulled');
    if (outcome.kind !== 'pulled') return;
    expect(outcome.resynced).toBe(true);
    // ...and because a full re-sync carries no removals, the user is told.
    expect(outcome.notice).not.toBeNull();
    expect(client.rpc).toHaveBeenCalledTimes(2);
  });

  it('FORGETS the expired cursor, even when the re-sync itself then fails', async () => {
    // MR-14 B7. Found by mutation: deleting `cursors.clear()` passed all twenty cases,
    // because every one of them let the retry SUCCEED -- and a successful pull saves a
    // fresh cursor over the dead one, hiding whether it was ever cleared.
    //
    // The difference only shows when the retry also fails. Without the clear, the expired
    // cursor is still on disk at the next launch, which sends it again, gets 45006 again,
    // and does so on every launch after that: a handset that hit an expired cursor while
    // losing signal would never sync again. With it, the next launch is a full sweep.
    await cursors.save('mr-1', 'an old cursor');
    const client = rpc(() => ({ data: null, error: { code: '45006', message: 'cursor too old' } }));

    const outcome = await pullOnce({ userId: 'mr-1', cursors, client });

    // The second attempt was made and also refused, so this is reported rather than
    // silently swallowed...
    expect(outcome.kind).toBe('refused');
    expect(client.rpc).toHaveBeenCalledTimes(2);
    // ...and the dead cursor is gone, so the next launch starts clean.
    expect(await cursors.load('mr-1')).toBeNull();
  });

  it('an unrecognised cursor recovers the same way', async () => {
    await cursors.save('mr-1', 'from another server');
    let call = 0;
    const client = rpc(() => {
      call += 1;
      return call === 1
        ? { data: null, error: { code: '45005', message: 'not recognised' } }
        : { data: response(), error: null };
    });
    const outcome = await pullOnce({ userId: 'mr-1', cursors, client });
    expect(outcome.kind).toBe('pulled');
  });

  it('a refusal that is NOT about the cursor is surfaced, not retried', async () => {
    // Retrying a shift-window or permission refusal would turn one honest answer into two
    // requests and the same answer.
    const client = rpc(() => ({ data: null, error: { code: '42501', message: 'no' } }));
    const outcome = await pullOnce({ userId: 'mr-1', cursors, client });
    expect(outcome).toMatchObject({ kind: 'refused', refusal: { code: 'not_permitted' } });
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it('parses the response rather than casting it', async () => {
    // The only place that can notice the server changed shape.
    const client = rpc(() => ({ data: { changes: 'not an array' }, error: null }));
    await expect(pullOnce({ userId: 'mr-1', cursors, client })).rejects.toThrow();
  });
});

describe('MR-11 B4 — a doctor whose addresses have not arrived says so', () => {
  const doctorRecord = {
    id: '33333333-3333-4333-8333-333333333301',
    fullName: 'Dr Partial',
    registrationNumber: null,
    specialty: null,
    qualification: null,
    territoryId: '44444444-4444-4444-8444-444444444401',
    assignedMrId: null,
    isActive: true,
    createdAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z',
  };

  const address = {
    id: '55555555-5555-4555-8555-555555555501',
    doctorId: doctorRecord.id,
    label: 'Main clinic',
    line1: '12 FC Road',
    line2: null,
    city: 'Pune',
    state: 'Maharashtra',
    postalCode: '411004',
    // A geofence centre has no provenance, so the contract's Coordinates cannot describe
    // one. See `fromClinicAddressRow`.
    coordinates: null,
    geofenceRadiusMetres: 150,
  };

  it('reports addressesPending rather than an empty address presented as fact', () => {
    // The cost of the separate-entity design, paid honestly. A doctor and their addresses
    // are independent rows in one cursor-ordered stream, so the doctor can legitimately
    // arrive first — and the product's rule is that the app never presents what the server
    // has not said. `addressesPending` is that state having a name.
    const store = applyChanges(emptyStore(), [
      { kind: 'upsert', entity: 'doctor', record: doctorRecord },
    ]);

    const view = doctorWithAddresses(store, doctorRecord.id);
    expect(view?.addressesPending).toBe(true);
    expect(view?.clinicAddresses).toEqual([]);
    // The doctor is still known. "Addresses syncing" is a different statement from
    // "no such doctor", and a screen must be able to tell them apart.
    expect(view?.doctor.fullName).toBe('Dr Partial');
  });

  it('and stops saying it the moment an address arrives', () => {
    // THE POSITIVE CONTROL. Without it, `addressesPending: true` for ever would satisfy
    // the assertion above — a flag that never clears is as wrong as one that never sets.
    const store = applyChanges(emptyStore(), [
      { kind: 'upsert', entity: 'doctor', record: doctorRecord },
      { kind: 'upsert', entity: 'clinic_address', record: address },
    ]);

    const view = doctorWithAddresses(store, doctorRecord.id);
    expect(view?.addressesPending).toBe(false);
    expect(view?.clinicAddresses).toHaveLength(1);
    expect(view?.clinicAddresses[0]?.city).toBe('Pune');
  });

  it('an unknown doctor is null, not a doctor with no addresses', () => {
    // The two are different facts and the caller must not have to guess which it holds.
    expect(doctorWithAddresses(emptyStore(), doctorRecord.id)).toBeNull();
  });

  it('a removed clinic address leaves the store, and the doctor stays', () => {
    const store = applyChanges(emptyStore(), [
      { kind: 'upsert', entity: 'doctor', record: doctorRecord },
      { kind: 'upsert', entity: 'clinic_address', record: address },
    ]);
    const after = applyChanges(store, [
      { kind: 'remove', entity: 'clinic_address', id: address.id, reason: 'deleted' },
    ]);

    const view = doctorWithAddresses(after, doctorRecord.id);
    expect(view?.clinicAddresses).toEqual([]);
    expect(view?.addressesPending).toBe(true);
    expect(after.doctor.size, 'the doctor was removed with their address').toBe(1);
  });

  it('a clinic address is NOT stored as a beat plan — the misroute the switch prevents', () => {
    // The if/else chain this replaced ended in a bare `else` that wrote to `beat_plan`.
    // Adding a fourth entity without touching that line would have stored every clinic
    // address as a beat plan: the same shape as the check-out replayed as a check-in.
    const store = applyChanges(emptyStore(), [
      { kind: 'upsert', entity: 'clinic_address', record: address },
    ]);
    expect(store.clinic_address.size).toBe(1);
    expect(store.beat_plan.size, 'a clinic address landed in beat_plan').toBe(0);
  });
});
