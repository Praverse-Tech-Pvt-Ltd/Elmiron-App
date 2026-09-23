import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ApiRequestError, createApiClient } from '@fieldforce/core';
import { requireDatabase, withClient } from './db.js';
import { API_URL, rest, signIn } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * MR-51 B — `BE-W110`. The SOP-review record, written and read over real HTTP.
 *
 * `analysis_overrides` is the human-review record `C8`'s SOP monitoring relies on. Until MR-51 the
 * console's save went to `/analyses/:id/overrides`, a path only `services/mock` answered, and the RPC
 * behind it returned snake_case. So this drives the **same client the console uses**
 * (`createApiClient` from `@fieldforce/core`) against PostgREST, with a token from a real GoTrue
 * password sign-in — no mock, no minted claims, no `set local role`. What the client parses is what
 * the server said.
 *
 * `analysis_overrides` is append-only (`reject_mutation`), so the rows this writes stay. Each carries
 * a fresh reason so a test finds only its own row.
 */
const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
});

const clientFor = async (user: FixtureUser) => {
  const { accessToken } = await signIn(user.email, user.password);
  return {
    accessToken,
    client: createApiClient({
      baseUrl: `${API_URL}/rest/v1`,
      getAccessToken: () => accessToken,
    }),
  };
};

/** The stored row, with the organisation of its reviewer and of the analysis's MR. */
const storedRow = async (reason: string) =>
  withClient(async (db) => {
    const { rows } = await db.query<{
      id: string;
      overridden_by_user_id: string;
      reviewer_org: string;
      analysis_org: string;
    }>(
      `select o.id, o.overridden_by_user_id,
              reviewer.organisation_id as reviewer_org,
              mr.organisation_id       as analysis_org
         from public.analysis_overrides o
         join public.user_profiles reviewer on reviewer.id = o.overridden_by_user_id
         join public.analyses a             on a.id = o.analysis_id
         join public.user_profiles mr       on mr.id = a.mr_id
        where o.reason = $1`,
      [reason],
    );
    return rows;
  });

describe.skipIf(!reachable)('BE-W110 — an admin saves an override through the real server', () => {
  it('B2: saved by the console client, stored with the right reviewer and organisation, listed back', async () => {
    const reason = `MR-51 B2 ${randomUUID()}`;
    const { client } = await clientFor(world.users.admin);

    const saved = await client.createAnalysisOverride(world.analyses.pune, {
      findingId: null,
      reason,
    });
    // The client parsed it as AnalysisOverrideSchema; the content is the server's.
    expect(saved.analysisId).toBe(world.analyses.pune);
    expect(saved.overriddenByUserId).toBe(world.users.admin.id);
    expect(saved.reason).toBe(reason);

    const rows = await storedRow(reason);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(saved.id);
    expect(rows[0]?.overridden_by_user_id).toBe(world.users.admin.id);
    expect(rows[0]?.reviewer_org).toBe(world.organisationId);
    expect(rows[0]?.analysis_org).toBe(world.organisationId);

    // FE-W12's read, through the same client: the saved row is in the history.
    const page = await client.listAnalysisOverrides({
      analysisId: world.analyses.pune,
      reason: 'MR-51 B2 — reading back the override just logged',
    });
    expect(page.data.map((o) => o.id)).toContain(saved.id);
  });
});

describe.skipIf(!reachable)('BE-W110 — B3: another organisation cannot save or read it', () => {
  it('the rival admin is refused the save, by scope, and nothing is written', async () => {
    const reason = `MR-51 B3 rival save ${randomUUID()}`;
    const { client, accessToken } = await clientFor(world.users.rivalAdmin);

    await expect(
      client.createAnalysisOverride(world.analyses.pune, { findingId: null, reason }),
    ).rejects.toBeInstanceOf(ApiRequestError);

    // The refusal is the scope check — not a missing reason, not a bad token.
    const raw = await rest('/rpc/create_analysis_override', {
      token: accessToken,
      method: 'POST',
      body: { p_analysis_id: world.analyses.pune, p_finding_id: null, p_reason: reason },
    });
    expect(raw.status).toBe(403);
    expect(raw.body).toMatchObject({ code: '42501' });
    expect(raw.text).toContain('not within your scope');

    expect(await storedRow(reason)).toEqual([]);
  });

  it('the rival admin is refused the read, by scope, with a reason given', async () => {
    const { client, accessToken } = await clientFor(world.users.rivalAdmin);
    const input = { analysisId: world.analyses.pune, reason: 'MR-51 B3 — rival read attempt' };

    await expect(client.listAnalysisOverrides(input)).rejects.toBeInstanceOf(ApiRequestError);

    const raw = await rest('/rpc/list_analysis_overrides', {
      token: accessToken,
      method: 'POST',
      body: { p_analysis_id: input.analysisId, p_reason: input.reason },
    });
    expect(raw.status).toBe(403);
    expect(raw.body).toMatchObject({ code: '42501' });
    expect(raw.text).toContain('not within your scope');
  });

  it('positive control: the same two calls succeed for the owning admin', async () => {
    const reason = `MR-51 B3 owner ${randomUUID()}`;
    const { client } = await clientFor(world.users.admin);

    const saved = await client.createAnalysisOverride(world.analyses.pune, {
      findingId: null,
      reason,
    });
    const page = await client.listAnalysisOverrides({
      analysisId: world.analyses.pune,
      reason: 'MR-51 B3 — owner reads the same analysis',
    });
    expect(page.data.map((o) => o.id)).toContain(saved.id);
    expect(await storedRow(reason)).toHaveLength(1);
  });
});
