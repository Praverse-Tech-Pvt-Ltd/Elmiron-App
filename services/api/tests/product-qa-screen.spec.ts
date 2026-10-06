import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { requireDatabase, withClient } from './db.js';
import { ANON_KEY, API_URL, asUser, signIn, withIdentityLock } from './auth.js';
import type { ProfileLike } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * W2-C C3 / `BE-W160` — the Product Q&A SCREEN's own transport, end to end, against the local stack
 * with the stub provider: `createLiveProductQaTransport` and `productQaOutcome` from `apps/field`,
 * as the signed-in rep, with NO approved knowledge loaded — the state a pilot company starts in.
 * Loaded by path for the reason `mr-chat.spec.ts` gives (W1-Z B3).
 */
const reachable = await requireDatabase();
const FUNCTION_URL = `${API_URL}/functions/v1/ai-gateway`;
const served = await (async (): Promise<boolean> => {
  if (!reachable) return false;
  try {
    return (await fetch(FUNCTION_URL, { method: 'POST' })).status > 0;
  } catch {
    return false;
  }
})();
if (reachable && !served) {
  console.warn(`No Edge Function at ${FUNCTION_URL} — the Product Q&A screen test is skipped.`);
}
const live = reachable && served;

type Transport = (body: { feature: 'product_qa'; question: string }) => Promise<{
  status: number;
  body: unknown;
}>;
interface FieldModules {
  createLiveProductQaTransport: (c: {
    baseUrl: string;
    apiKey: string;
    accessToken: () => Promise<string | null>;
  }) => Transport;
  productQaOutcome: (r: { status: number; body: unknown }) => { kind: string; text?: string };
}

const field = async (): Promise<FieldModules> => {
  const load = async (rel: string): Promise<Record<string, unknown>> =>
    (await import(fileURLToPath(new URL(rel, import.meta.url)))) as Record<string, unknown>;
  const liveModule = await load('../../../apps/field/src/product-qa/live.ts');
  const outcomeModule = await load('../../../apps/field/src/product-qa/outcome.ts');
  return {
    createLiveProductQaTransport: liveModule[
      'createLiveProductQaTransport'
    ] as FieldModules['createLiveProductQaTransport'],
    productQaOutcome: outcomeModule['productQaOutcome'] as FieldModules['productQaOutcome'],
  };
};

let world: FixtureWorld;
let mrToken = '';
let runId = '';

const setThreshold = async (db: Client, key: string, value: string): Promise<void> => {
  await db.query(
    `insert into public.app_thresholds (key, value, scope, organisation_id, note, effective_from)
     values ($1, $2::jsonb, 'organisation', $3, $4, now())`,
    [key, value, world.organisationId, `W2-C C3 test artefact (${runId}). NOT a product decision.`],
  );
};

const asRpcUser = async (db: Client, who: ProfileLike, sql: string, params: unknown[]) => {
  await db.query('begin');
  try {
    await asUser(db, who);
    await db.query(sql, params);
    await db.query('commit');
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
};

beforeAll(async () => {
  if (!live) return;
  world = await seedFixtures();
  runId = randomUUID().slice(0, 8);
  await withClient(async (db) => {
    await setThreshold(db, 'ai_daily_requests_per_user', '50');
    // product_qa's own approved prompt, with ITS output schema — and NO knowledge loaded.
    const promptId = randomUUID();
    await db.query(
      `insert into public.ai_prompt_versions
         (id, organisation_id, feature, version_number, system_prompt, output_schema_name,
          created_by_user_id)
       values ($1, $2, 'product_qa',
               (select coalesce(max(version_number), 0) + 1 from public.ai_prompt_versions
                 where organisation_id = $2 and feature = 'product_qa'),
               'You are the approved product information assistant.', 'ProductQaOutputSchema', $3)`,
      [promptId, world.organisationId, world.users.admin.id],
    );
    const reviewer = await withIdentityLock(async () => {
      const id = randomUUID();
      await db.query(
        `insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')`,
        [id, `pqa-reviewer-${id.slice(0, 8)}@example.test`],
      );
      await db.query(
        `insert into public.user_profiles (id, full_name, role, territory_id, is_active, organisation_id)
         values ($1, 'PQA Reviewer', 'admin', null, true, $2)`,
        [id, world.organisationId],
      );
      const profile: ProfileLike = { id, role: 'admin', territoryId: null, isActive: true };
      return profile;
    });
    await asRpcUser(db, world.users.admin, 'select public.submit_ai_prompt_version($1)', [
      promptId,
    ]);
    await asRpcUser(db, reviewer, 'select public.approve_ai_prompt_version($1, $2)', [
      promptId,
      'W2-C C3: product_qa prompt for a local test. Stub provider, no vendor.',
    ]);
  });
  mrToken = (await signIn(world.users.puneMr.email, world.users.puneMr.password)).accessToken;
}, 180_000);

describe.skipIf(!live)('W2-C C3 — the Product Q&A screen’s own transport, end to end', () => {
  it('with the feature SWITCHED OFF, the screen reads "switched off" — nothing was asked', async () => {
    const { createLiveProductQaTransport, productQaOutcome } = await field();
    const send = createLiveProductQaTransport({
      baseUrl: API_URL,
      apiKey: ANON_KEY,
      accessToken: () => Promise.resolve(mrToken),
    });
    const response = await send({ feature: 'product_qa', question: 'What is the dose?' });
    expect(response.status).toBe(403);
    expect(productQaOutcome(response).kind).toBe('switched_off');
  });

  it('switched ON with NO approved material: the honest "no approved information", by the screen’s mapping', async () => {
    await withClient(async (db) => {
      await setThreshold(db, 'ai_feature_enabled:product_qa', 'true');
    });
    const { createLiveProductQaTransport, productQaOutcome } = await field();
    const send = createLiveProductQaTransport({
      baseUrl: API_URL,
      apiKey: ANON_KEY,
      accessToken: () => Promise.resolve(mrToken),
    });
    const response = await send({ feature: 'product_qa', question: 'What is the dose?' });
    expect(response.status).toBe(200);
    expect((response.body as { kind: string }).kind).toBe('not_available');
    const outcome = productQaOutcome(response);
    expect(outcome.kind).toBe('no_approved_information');
    expect(outcome.text?.length ?? 0).toBeGreaterThan(0);

    // POSITIVE CONTROL on identity: with nobody signed in, nothing is sent at all.
    const signedOut = createLiveProductQaTransport({
      baseUrl: API_URL,
      apiKey: ANON_KEY,
      accessToken: () => Promise.resolve(null),
    });
    await expect(signedOut({ feature: 'product_qa', question: 'x' })).rejects.toThrow(
      /not signed in/u,
    );
  });
});
