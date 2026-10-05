import { beforeAll, describe, expect, it } from 'vitest';
import {
  AnalysisSchema,
  ConsentRecordSchema,
  ListAnalysesPageSchema,
  ListConsentRecordsPageSchema,
  MileageDaySchema,
  MileageRowSchema,
  ReadAnalysisResponseSchema,
  fromMileageRow,
} from '@fieldforce/core';
import { requireDatabase } from './db.js';
import { rest, signIn } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * W1-C A1 — the answer to **CR-3**, proven rather than asserted.
 *
 * Six MR screens read `services/mock` on `127.0.0.1:4010`, which **a real device cannot reach**.
 * The frontend asked two questions per function and said explicitly that it is not asking for a new
 * endpoint — only for evidence about the five that already exist:
 *
 *   1. is it granted to, and does it **BEHAVE** for, an MR's session?
 *   2. does its return **parse** against the `packages/core` schema the screen already uses?
 *
 * **Why `console-reads-contract.spec.ts` does not already answer this.** That suite proves three of
 * these five parse — **as an `admin`**. `list_analyses` and `list_consent_records` branch on role
 * (`v_role = 'admin' or … in (select public.visible_user_ids())`), and `read_analysis` returns
 * `data: null` for anything out of scope. **An admin passing proves nothing about an MR**, and the
 * frontend was right that it could not tell from the tree.
 *
 * So every call below is made with **an MR's own GoTrue token**, over real HTTP, and parsed with the
 * exact exported schema the screen uses. Reading the grant would not have answered either half:
 * `grant execute … to authenticated` is true for all five and says nothing about what the body does
 * with `current_app_role()`.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;
const tokens = new Map<string, string>();

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 120_000);

const token = async (user: FixtureUser): Promise<string> => {
  const cached = tokens.get(user.id);
  if (cached !== undefined) return cached;
  const { accessToken } = await signIn(user.email, user.password);
  tokens.set(user.id, accessToken);
  return accessToken;
};

const call = async (user: FixtureUser, path: string, body: Record<string, unknown>) =>
  rest(path, { token: await token(user), method: 'POST', body });

describe.skipIf(!reachable)('CR-3 — the five functions, called as an MR', () => {
  /**
   * CR-3 named "`MileageRowSchema` or `MileageDaySchema`" for this one, and **which of the two is
   * the answer.** `daily_mileage` is a `returns table (mr_id, travel_date, check_in_count,
   * distance_metres)` function, so PostgREST serialises those column names literally and the wire
   * is **snake_case**. It is the only one of the five that is not a `jsonb` builder, which is why
   * MR-52 A2's camelCase sweep over `to_jsonb(row)` shapes never touched it.
   *
   * **That is not a defect, and the mapper already exists.** `MileageRowSchema` is the wire shape
   * and `fromMileageRow` converts it to `MileageDay` -- which is exactly what
   * `apps/field/src/capture/visits.ts:102` already does through `listMileage`.
   *
   * Asserted both ways below, because "it parses" is ambiguous until you say with which schema:
   * `MileageDaySchema` alone **must not** match the wire, and `fromMileageRow` **must**.
   */
  it('daily_mileage: the wire is snake_case, and fromMileageRow is the mapper', async () => {
    const response = await call(world.users.puneMr, '/rpc/daily_mileage', {
      p_from: '2026-01-01',
      p_to: '2026-12-31',
      p_mr_id: null,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);

    const rows = response.body as unknown[];
    expect(Array.isArray(rows), `daily_mileage returned ${JSON.stringify(response.body)}`).toBe(
      true,
    );
    // An empty array is a legitimate answer -- this MR drove nowhere in the window -- so the
    // fixture's own check-in is asserted to be present first, or the loop below proves nothing.
    expect(
      rows.length,
      'the fixture MR has check-ins, so there is at least one day',
    ).toBeGreaterThan(0);

    for (const row of rows) {
      const wire = MileageRowSchema.safeParse(row);
      expect(wire.success, `MileageRow mismatch: ${JSON.stringify(wire.error?.issues)}`).toBe(true);
      // The mapper the screen already uses.
      const day = fromMileageRow(row);
      expect(MileageDaySchema.safeParse(day).success).toBe(true);
    }
  });

  it('daily_mileage: MileageDaySchema alone does NOT match the wire — the naming half of CR-3', async () => {
    // The negative control for the test above. If this ever starts passing, the function was
    // converted to camelCase and `fromMileageRow` became a double-mapping bug -- so this assertion
    // is what makes "use the mapper" a fact rather than a habit.
    const response = await call(world.users.puneMr, '/rpc/daily_mileage', {
      p_from: '2026-01-01',
      p_to: '2026-12-31',
      p_mr_id: null,
    });
    const rows = response.body as unknown[];
    expect(MileageDaySchema.safeParse(rows[0]).success).toBe(false);
  });

  it('daily_mileage: an MR gets only their OWN days', async () => {
    const response = await call(world.users.puneMr, '/rpc/daily_mileage', {
      p_from: '2026-01-01',
      p_to: '2026-12-31',
      p_mr_id: null,
    });
    const days = (response.body as unknown[]).map(fromMileageRow);
    expect(
      days.every((d) => d.mrId === world.users.puneMr.id),
      'no other MR’s rows',
    ).toBe(true);
  });

  it('list_analyses: an MR gets their OWN analyses, and the page parses', async () => {
    const response = await call(world.users.puneMr, '/rpc/list_analyses', {
      p_mr_id: null,
      p_reason: null,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);

    const parsed = ListAnalysesPageSchema.safeParse(response.body);
    expect(
      parsed.success,
      `ListAnalysesPage mismatch: ${JSON.stringify(parsed.error?.issues)}`,
    ).toBe(true);
    // BEHAVES, not merely returns 200: the MR's own analysis is present.
    expect(parsed.data?.data.map((a) => a.id)).toContain(world.analyses.pune);
    // And a reason is NOT required for an MR -- only an admin must give one (`22023`). Passing null
    // above is the assertion; if the body required it for everyone this call would have failed.
  });

  it('list_analyses: an MR does NOT get another MR’s analyses — the scope half', async () => {
    const response = await call(world.users.puneMr, '/rpc/list_analyses', {
      p_mr_id: null,
      p_reason: null,
    });
    const parsed = ListAnalysesPageSchema.parse(response.body);
    expect(parsed.data.map((a) => a.id)).not.toContain(world.analyses.south);
  });

  it('read_analysis: an MR reads their own, and it parses as an Analysis', async () => {
    const response = await call(world.users.puneMr, '/rpc/read_analysis', {
      p_analysis_id: world.analyses.pune,
      p_reason: null,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);

    const parsed = ReadAnalysisResponseSchema.safeParse(response.body);
    expect(parsed.success, `ReadAnalysis mismatch: ${JSON.stringify(parsed.error?.issues)}`).toBe(
      true,
    );
    expect(parsed.data?.data, 'the analysis itself, not null').not.toBeNull();
    expect(AnalysisSchema.safeParse(parsed.data?.data).success).toBe(true);
  });

  it('read_analysis: out of scope is data null, not an error — an absence the server chose', async () => {
    const response = await call(world.users.puneMr, '/rpc/read_analysis', {
      p_analysis_id: world.analyses.south,
      p_reason: null,
    });
    expect(response.status).toBe(200);
    const parsed = ReadAnalysisResponseSchema.parse(response.body);
    expect(parsed.data).toBeNull();
  });

  it('respond_to_analysis: an MR can reply to their own', async () => {
    const response = await call(world.users.puneMr, '/rpc/respond_to_analysis', {
      p_analysis_id: world.analyses.pune,
      p_response: 'W1-C CR-3 probe: the MR replied.',
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  });

  it('respond_to_analysis: an MR canNOT reply to another MR’s — the positive control above is real', async () => {
    const response = await call(world.users.puneMr, '/rpc/respond_to_analysis', {
      p_analysis_id: world.analyses.south,
      p_response: 'W1-C CR-3 probe: this must be refused.',
    });
    // Refused. The code is the server's to choose; what matters is that it is not 200.
    expect(response.status, JSON.stringify(response.body)).not.toBe(200);
  });

  it('list_consent_records: an MR gets records in scope, and the page parses', async () => {
    const response = await call(world.users.puneMr, '/rpc/list_consent_records', {
      p_visit_id: null,
      p_reason: null,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);

    const parsed = ListConsentRecordsPageSchema.safeParse(response.body);
    expect(
      parsed.success,
      `ListConsentRecordsPage mismatch: ${JSON.stringify(parsed.error?.issues)}`,
    ).toBe(true);
    for (const record of parsed.data?.data ?? []) {
      expect(ConsentRecordSchema.safeParse(record).success).toBe(true);
    }
  });
});
