import { beforeAll, describe, expect, it } from 'vitest';
import {
  BeatPlanSchema,
  DoctorSchema,
  SyncPullResponseSchema,
  fromBeatPlanRow,
  fromDoctorRow,
  fromVisitRow,
} from '@fieldforce/core';
import { requireDatabase } from './db.js';
import { mintAccessToken, rest } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * FIX-14 C4 — a real response, through PostgREST, parsed by the contract that describes it.
 *
 * **No client has ever received a real response in this product.** Every response-side
 * divergence found so far — FIX-06's missing mappers, the mock echoing the outbox back as
 * pull results — was found by something trying to use one. This is the file that tries.
 *
 * It uses the **faithful path** deliberately: a real JWT, over HTTP, through Kong and
 * PostgREST, exactly as `apps/field` will call it. The fast path in the rest of this suite
 * talks to Postgres directly and would not see anything PostgREST does to the payload on
 * the way out — which is precisely the layer where a shape divergence hides.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

const pullOverHttp = async (
  cursor: string | null,
  limit = 50,
): Promise<{ status: number; body: unknown }> => {
  const token = mintAccessToken({
    id: world.users.puneMr.id,
    role: world.users.puneMr.role,
    territoryId: world.users.puneMr.territoryId,
    isActive: true,
  });
  return rest('/rpc/sync_pull', {
    method: 'POST',
    token,
    body: { p_cursor: cursor, p_entities: null, p_limit: limit },
  });
};

describe.skipIf(!reachable)('sync_pull over PostgREST conforms to the contract', () => {
  it('returns 200 and a body the contract can parse, unmodified', async () => {
    const response = await pullOverHttp(null);
    expect(response.status).toBe(200);

    // Parsed, not cast. A cast would let every divergence through and this whole file
    // would be a slower way of believing the contract.
    const parsed = SyncPullResponseSchema.safeParse(response.body);
    if (!parsed.success) {
      // Printed in full when it fails, because "invalid_type at changes.0.updatedAt" is
      // the finding, not the failure.
      throw new Error(`contract divergence:\n${JSON.stringify(parsed.error.issues, null, 2)}`);
    }
    expect(parsed.success).toBe(true);
  });

  it('the parse is not vacuous: the response actually carries changes', async () => {
    // A schema whose every field is optional parses `{}`. This asserts the round trip
    // returned something for the schema to have an opinion about.
    const response = await pullOverHttp(null);
    const parsed = SyncPullResponseSchema.parse(response.body);
    expect(parsed.changes.length).toBeGreaterThan(0);
    expect(parsed.nextCursor.length).toBeGreaterThan(0);
    expect(parsed.completeness.entities.length).toBeGreaterThan(0);
  });

  it('an incremental pull also conforms, with the cursor from the first', async () => {
    // The second call is where a cursor round trip can break: PostgREST re-encodes the
    // body, and a cursor is an opaque string full of colons and commas.
    const first = SyncPullResponseSchema.parse((await pullOverHttp(null)).body);
    const second = await pullOverHttp(first.nextCursor);
    expect(second.status).toBe(200);
    const parsed = SyncPullResponseSchema.safeParse(second.body);
    if (!parsed.success) {
      throw new Error(`contract divergence:\n${JSON.stringify(parsed.error.issues, null, 2)}`);
    }
    expect(parsed.data.completeness.omits).toEqual([]);
  });

  it('a refusal arrives with its SQLSTATE, not as a generic 500', async () => {
    // The client's whole error path depends on `code` surviving PostgREST. If it does
    // not, `refusalForSqlState` gets nothing to work with and every refusal renders as
    // "the app does not recognise the reason".
    const response = await rest('/rpc/sync_pull', {
      method: 'POST',
      token: mintAccessToken({
        id: world.users.puneMr.id,
        role: world.users.puneMr.role,
        territoryId: world.users.puneMr.territoryId,
        isActive: true,
      }),
      body: { p_cursor: 'not a cursor', p_entities: null, p_limit: 50 },
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.body).toMatchObject({ code: '45005' });
  });

  it('an unauthenticated caller cannot reach it at all', async () => {
    const response = await rest('/rpc/sync_pull', {
      method: 'POST',
      body: { p_cursor: null, p_entities: null, p_limit: 50 },
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});

describe.skipIf(!reachable)('C4 — what the payload actually contains', () => {
  const payloadsByEntity = async (): Promise<Record<string, Record<string, unknown>>> => {
    const parsed = SyncPullResponseSchema.parse((await pullOverHttp(null, 200)).body);
    const found: Record<string, Record<string, unknown>> = {};
    for (const change of parsed.changes) {
      if (change.payload !== null && found[change.entity] === undefined) {
        found[change.entity] = change.payload;
      }
    }
    return found;
  };

  it('every payload key is snake_case — the divergence, asserted rather than assumed', async () => {
    // The contract describes an app in camelCase; `to_jsonb(row)` returns the table in
    // snake_case. Both are right about their own side, which is why the answer is a
    // mapper and not a migration. This is the assertion that stops anybody "fixing" it
    // in the wrong direction.
    const payloads = await payloadsByEntity();
    // `clinic_address` joined in MR-11 (BE-W87). This list is deliberately exact rather
    // than a `toContain`: it is the set of entities the pull carries, and a new one
    // arriving unannounced is exactly what this assertion is for. It caught the contract
    // enum being left behind when the migration landed.
    expect(Object.keys(payloads).sort()).toEqual([
      'beat_plan',
      'clinic_address',
      'doctor',
      'visit',
    ]);
    for (const [entity, payload] of Object.entries(payloads)) {
      const camel = Object.keys(payload).filter((k) => /[A-Z]/.test(k));
      expect(camel, `${entity} keys`).toEqual([]);
    }
  });

  it('the row mappers turn a REAL payload into the contract types', async () => {
    // Not a fixture. These are the bytes PostgREST returned a moment ago.
    const payloads = await payloadsByEntity();
    expect(() => fromVisitRow(payloads['visit'])).not.toThrow();
    expect(() => fromDoctorRow(payloads['doctor'])).not.toThrow();
    expect(() => fromBeatPlanRow(payloads['beat_plan'])).not.toThrow();

    const visit = fromVisitRow(payloads['visit']);
    expect(visit.mrId).toBe(payloads['visit']?.['mr_id']);
    expect(visit.receivedAt).toBe(payloads['visit']?.['received_at']);
  });

  it('the AGGREGATE schemas cannot be satisfied by a pull, and that is the finding', async () => {
    // `DoctorSchema` requires `clinicAddresses` and `BeatPlanSchema` requires `entries`.
    // Neither is a column, so no pull payload can produce one. Asserting the failure
    // keeps the reason visible: if somebody later makes the pull join the children in,
    // this test fails and they have to say why.
    const payloads = await payloadsByEntity();
    expect(DoctorSchema.safeParse(fromDoctorRow(payloads['doctor'])).success).toBe(false);
    expect(BeatPlanSchema.safeParse(fromBeatPlanRow(payloads['beat_plan'])).success).toBe(false);
  });

  it('pins the payload key sets, so the client fixtures cannot go stale unnoticed', async () => {
    // `apps/field/src/sync/pull.test.ts` holds copies of these rows, captured from this
    // round trip. The field workspace has no database and cannot notice a column being
    // added -- `to_jsonb(row)` is an implicit `select *`, so a new column reaches every
    // handset the day it is created. This is where that gets noticed.
    const payloads = await payloadsByEntity();
    expect(Object.keys(payloads['visit'] ?? {}).sort()).toEqual([
      'beat_plan_id',
      'clinic_address_id',
      'completed_at',
      'created_at',
      'doctor_id',
      'id',
      'mr_id',
      'not_met_reason',
      'received_at',
      'scheduled_for',
      'started_at',
      'status',
      'updated_at',
    ]);
    expect(Object.keys(payloads['doctor'] ?? {}).sort()).toEqual([
      'assigned_mr_id',
      'created_at',
      'full_name',
      'id',
      'is_active',
      'organisation_id',
      'qualification',
      'registration_number',
      'specialty',
      'territory_id',
      'updated_at',
    ]);
    expect(Object.keys(payloads['beat_plan'] ?? {}).sort()).toEqual([
      'approved_at',
      'approved_by_user_id',
      'created_at',
      'id',
      'mr_id',
      'plan_date',
      'status',
      'supersedes_beat_plan_id',
      'territory_id',
      'updated_at',
      'version',
    ]);
  });

  it('a full re-sync declares the omission the client must show the MR', async () => {
    // C2's server half. The client half is `noticeFor` in apps/field.
    const parsed = SyncPullResponseSchema.parse((await pullOverHttp(null)).body);
    expect(parsed.completeness.omits).toContain('delete');
    expect(parsed.completeness.note).toMatch(/full re-sync/i);
  });
});
