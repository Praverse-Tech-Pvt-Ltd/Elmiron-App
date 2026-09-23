import { beforeAll, describe, expect, it } from 'vitest';
import {
  ListAnalysesPageSchema,
  ListConsentRecordsPageSchema,
  ReadAnalysisResponseSchema,
} from '@fieldforce/core';
import { requireDatabase } from './db.js';
import { rest, signIn } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * MR-52 A2 — `FE-W66`: the three reads the console makes return what the contract declares.
 *
 * Asserted the only way that means anything: the REAL response over real HTTP, parsed through the
 * schemas `apps/console` parses them with. Before this the functions emitted `to_jsonb(row)`
 * snake_case, and nothing noticed because every console page read the mock instead.
 */
const reachable = await requireDatabase();

let world: FixtureWorld;
const tokens = new Map<string, string>();

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
});

const token = async (user: FixtureUser): Promise<string> => {
  const cached = tokens.get(user.id);
  if (cached !== undefined) return cached;
  const { accessToken } = await signIn(user.email, user.password);
  tokens.set(user.id, accessToken);
  return accessToken;
};

const call = async (user: FixtureUser, path: string, body: Record<string, unknown>) =>
  rest(path, { token: await token(user), method: 'POST', body });

describe.skipIf(!reachable)('MR-52 A2 — the console reads parse through the core contract', () => {
  it('read_analysis returns an Analysis, in camelCase', async () => {
    const response = await call(world.users.admin, '/rpc/read_analysis', {
      p_analysis_id: world.analyses.pune,
      p_reason: 'MR-52 A2 — contract check',
    });
    expect(response.status, response.text).toBe(200);
    const parsed = ReadAnalysisResponseSchema.safeParse(response.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data?.data?.id).toBe(world.analyses.pune);
    // The two columns this schema does not have, answered honestly rather than invented.
    expect(parsed.data?.data?.transcriptId).toBeNull();
    expect(parsed.data?.data?.findings).toEqual([]);
    // The drift itself, asserted absent.
    expect(response.text).not.toMatch(/"mr_id"|"rubric_version"|"created_at"/u);
  });

  it('list_analyses returns Analyses, in camelCase, and not an empty list', async () => {
    const response = await call(world.users.admin, '/rpc/list_analyses', {
      p_mr_id: null,
      p_reason: 'MR-52 A2 — contract check',
    });
    expect(response.status, response.text).toBe(200);
    const parsed = ListAnalysesPageSchema.safeParse(response.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    // Content, not container: an empty page would satisfy the schema and prove nothing.
    expect(parsed.data?.data.map((a) => a.id)).toContain(world.analyses.pune);
  });

  it('list_consent_records returns ConsentRecords, in camelCase, and not an empty list', async () => {
    const response = await call(world.users.admin, '/rpc/list_consent_records', {
      p_visit_id: null,
      p_reason: 'MR-52 A2 — contract check',
    });
    expect(response.status, response.text).toBe(200);
    const parsed = ListConsentRecordsPageSchema.safeParse(response.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data?.data.length).toBeGreaterThan(0);
    expect(parsed.data?.data[0]?.capturedByMrId.length).toBeGreaterThan(0);
    expect(response.text).not.toMatch(/"captured_by_mr_id"|"consent_text_version_id"/u);
  });

  it('the read and the list agree, because one function shapes both rows', async () => {
    const one = await call(world.users.admin, '/rpc/read_analysis', {
      p_analysis_id: world.analyses.pune,
      p_reason: 'MR-52 A2 — contract check',
    });
    const many = await call(world.users.admin, '/rpc/list_analyses', {
      p_mr_id: null,
      p_reason: 'MR-52 A2 — contract check',
    });
    const fromRead = ReadAnalysisResponseSchema.parse(one.body).data;
    const fromList = ListAnalysesPageSchema.parse(many.body).data.find(
      (a) => a.id === world.analyses.pune,
    );
    expect(fromRead).toEqual(fromList);
  });
});
