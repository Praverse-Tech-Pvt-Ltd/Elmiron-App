import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { ListAnalysisOverridesResponseSchema } from '@fieldforce/core';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * MR-50 C2 — `BE-W100`. `list_analysis_overrides` returns what the contract declares.
 *
 * The function built rows with `to_jsonb(o)` and emitted snake_case; `AnalysisOverrideSchema`
 * declares camelCase. Asserted the only way that means anything: the REAL response, parsed through
 * the core schema the console will parse it with. Under `C8` these rows are the human-review record
 * SOP monitoring relies on.
 */
const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
});

/** One override by the West manager on the Pune analysis, then the list, as the manager. */
const readBack = async (client: Client): Promise<unknown> => {
  await asUser(client, world.users.westManager);
  await client.query('select public.create_analysis_override($1, $2, $3)', [
    world.analyses.pune,
    null,
    'MR-50 C2 — the finding overstated the objection',
  ]);
  const { rows } = await client.query<{ page: unknown }>(
    'select public.list_analysis_overrides($1) as page',
    [world.analyses.pune],
  );
  return rows[0]?.page;
};

describe.skipIf(!reachable)('BE-W100 — the overrides read parses through the core contract', () => {
  it('parses the real response through ListAnalysisOverridesResponseSchema', async () => {
    await inRolledBackTransaction(async (client) => {
      const parsed = ListAnalysisOverridesResponseSchema.safeParse(await readBack(client));
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      const row = parsed.data?.data[0];
      expect(row?.analysisId).toBe(world.analyses.pune);
      expect(row?.overriddenByUserId).toBe(world.users.westManager.id);
      expect(row?.reason).toBe('MR-50 C2 — the finding overstated the objection');
    });
  });

  it('carries no snake_case key — the drift, asserted absent', async () => {
    await inRolledBackTransaction(async (client) => {
      const page = (await readBack(client)) as { data: Record<string, unknown>[] };
      const keys = Object.keys(page.data[0] ?? {});
      expect(keys.filter((k) => k.includes('_'))).toEqual([]);
      // Positive control: there IS a row with keys, so the empty list above is not vacuous.
      expect(keys).toContain('analysisId');
    });
  });
});
