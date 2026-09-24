import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  BENCHMARK_MATCHING_QUESTION,
  PRODUCT_QA_BENCHMARK,
  PRODUCT_QA_OUTPUT_SCHEMA_NAME,
  answerProductQuestion,
} from '@fieldforce/core';
import type {
  ControlPlaneRpc,
  LlmProvider,
  ProductQaBenchmarkCase,
  ScriptedModelBehaviour,
} from '@fieldforce/core';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asOwner, asUser } from './auth.js';
import type { ProfileLike } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * AI-D1 — `product_qa` end to end against the REAL control plane.
 *
 * `answerProductQuestion` (packages/core) runs here with a `ControlPlaneRpc` that calls the real
 * functions as the MR — `ai_begin_request`, `search_approved_knowledge`, `ai_complete_request` —
 * and a scripted model. The first time those three are exercised together, by the code that will
 * call them.
 *
 * **The knowledge fixture is written the way a label is written, not the way the question is
 * asked.** Tuning the fixture's wording to the question would make the matching cases pass and
 * prove nothing about retrieval.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

/**
 * The control plane over a `pg` client, with named arguments exactly as PostgREST sends them.
 *
 * Each call runs in a savepoint because each PostgREST request is its own transaction: a refused
 * call must not poison the next one, here any more than there.
 */
const pgRpc = (client: Client): ControlPlaneRpc => ({
  call: async (fn, args) => {
    const names = Object.keys(args);
    const params = names.map((n) => args[n] ?? null);
    const list = names.map((n, i) => `${n} => $${String(i + 1)}`).join(', ');
    await client.query('savepoint rpc');
    try {
      const r = await client.query<{ result: unknown }>(
        `select public.${fn}(${list}) as result`,
        params,
      );
      await client.query('release savepoint rpc');
      return r.rows[0]?.result;
    } catch (error) {
      await client.query('rollback to savepoint rpc');
      throw error;
    }
  },
});

const LABEL_TEXT = [
  '# Storage',
  'Store Benchmarol tablets below 25 °C in the original pack. Protect from moisture.',
  '# Presentation',
  'Strips of 10 film-coated tablets.',
].join('\n\n');

const setThreshold = (client: Client, key: string, value: unknown) =>
  asOwner(client, () =>
    client.query(
      `insert into public.app_thresholds (key, value, scope, note)
       values ($1, $2::jsonb, 'global', 'ai-product-qa.spec -- test only, rolled back')`,
      [key, JSON.stringify(value)],
    ),
  );

/**
 * Flag on, limit set, an approved product_qa prompt — and, when `knowledge` is `'matching'`, one
 * approved label. `'none'` means nothing approved is in scope (see `benchmarks.ts`).
 */
const world0 = async (client: Client, knowledge: 'matching' | 'none' = 'matching') => {
  const reviewerId = randomUUID();
  await asOwner(client, async () => {
    await client.query(
      `insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')`,
      [reviewerId, `qa-reviewer-${reviewerId.slice(0, 8)}@example.test`],
    );
    await client.query(
      `insert into public.user_profiles (id, full_name, role, territory_id, is_active, organisation_id)
       values ($1, 'QA Reviewer', 'admin', null, true, $2)`,
      [reviewerId, world.organisationId],
    );
  });
  const reviewer: ProfileLike = {
    id: reviewerId,
    role: 'admin',
    territoryId: null,
    isActive: true,
  };

  await setThreshold(client, 'ai_feature_enabled:product_qa', true);
  await setThreshold(client, 'ai_daily_requests_per_user', 100);

  await asUser(client, world.users.admin);
  const promptId = randomUUID();
  await client.query(
    `insert into public.ai_prompt_versions (id, feature, system_prompt, output_schema_name, created_by_user_id)
     values ($1, 'product_qa', 'You are the approved product information assistant.', $2, $3)`,
    [promptId, PRODUCT_QA_OUTPUT_SCHEMA_NAME, world.users.admin.id],
  );
  await client.query('select public.submit_ai_prompt_version($1)', [promptId]);

  const documentId = randomUUID();
  const versionId = randomUUID();
  if (knowledge === 'none') {
    await asUser(client, reviewer);
    await client.query('select public.approve_ai_prompt_version($1, $2)', [promptId, 'Reviewed.']);
    return { versionId: null };
  }
  await client.query(
    `insert into public.knowledge_documents (id, title, document_type) values ($1, 'Benchmarol label', 'faq')`,
    [documentId],
  );
  await client.query(
    `insert into public.knowledge_document_versions
       (id, document_id, body, source_reference, effective_from, created_by_user_id)
     values ($1, $2, $3, 'Benchmarol label v3', '2026-01-01', $4)`,
    [versionId, documentId, LABEL_TEXT, world.users.admin.id],
  );
  await client.query('select public.submit_knowledge_version($1)', [versionId]);

  await asUser(client, reviewer);
  await client.query('select public.approve_ai_prompt_version($1, $2)', [promptId, 'Reviewed.']);
  await client.query('select public.approve_knowledge_version($1, $2)', [versionId, 'Reviewed.']);
  return { versionId };
};

/** A model that follows the script, citing the first source it was actually shown. */
const scripted = (behaviour: ScriptedModelBehaviour, calls: { n: number }): LlmProvider => ({
  generate: (request) => {
    calls.n += 1;
    const firstId = /id=([0-9a-f-]{36})/.exec(request.messages[1]?.content ?? '')?.[1] ?? '';
    const r = (text: string) =>
      Promise.resolve({
        text,
        usage: { inputTokens: 80, outputTokens: 15 },
        provider: 'scripted',
        model: 's-1',
      });
    switch (behaviour) {
      case 'answers_with_valid_citation':
        return r(
          JSON.stringify({ supported: true, answer: 'Below 25 °C.', citedChunkIds: [firstId] }),
        );
      case 'cites_unknown_chunk':
        return r(JSON.stringify({ supported: true, answer: 'x', citedChunkIds: [randomUUID()] }));
      case 'answers_without_citation':
        return r(JSON.stringify({ supported: true, answer: 'x', citedChunkIds: [] }));
      case 'says_unsupported':
        return r(JSON.stringify({ supported: false, answer: '', citedChunkIds: [] }));
      case 'returns_prose':
        return r('It is fine to store it anywhere.');
      case 'times_out':
        return new Promise(() => undefined);
      case 'must_not_be_called':
        return Promise.reject(new Error('the model must not be called'));
    }
  },
});

const runCase = async (client: Client, c: ProductQaBenchmarkCase) => {
  const calls = { n: 0 };
  await asUser(client, world.users.puneMr);
  const result = await answerProductQuestion({
    rpc: pgRpc(client),
    provider: scripted(c.model, calls),
    question: c.question,
    marketId: null,
    productId: null,
    timeoutMs: 100,
  });
  const logged = await asOwner(client, () =>
    client.query<{
      status: string;
      flags: string[];
      knowledge_version_ids: string[];
      user_id: string;
    }>(
      `select status, flags, knowledge_version_ids, user_id from public.ai_requests where id = $1`,
      [result.requestId],
    ),
  );
  return { result, calls: calls.n, row: logged.rows[0] };
};

describe.skipIf(!reachable)('AI-D1 — product_qa benchmark through the real control plane', () => {
  const runnable = PRODUCT_QA_BENCHMARK.filter((c) => !c.requiresRealModel);

  it.each(runnable.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    await inRolledBackTransaction(async (client) => {
      const { versionId } = await world0(client, c.knowledge);
      const { result, calls, row } = await runCase(client, c);

      expect(result.kind).toBe(c.expected.kind);
      expect(calls > 0, 'model called').toBe(c.expected.modelCalled);
      expect(row?.status).toBe(c.expected.requestStatus);
      expect(row?.flags).toEqual([...c.expected.flags].sort());
      expect(row?.user_id).toBe(world.users.puneMr.id);
      expect(row?.knowledge_version_ids).toEqual(result.kind === 'answered' ? [versionId] : []);
    });
  });

  it.skip.each(PRODUCT_QA_BENCHMARK.filter((c) => c.requiresRealModel).map((c) => [c.id] as const))(
    '%s — needs a real model (D2)',
    () => undefined,
  );

  it('a feature that is switched off refuses before anything else — no request is logged', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      await expect(
        answerProductQuestion({
          rpc: pgRpc(client),
          provider: scripted('must_not_be_called', { n: 0 }),
          question: BENCHMARK_MATCHING_QUESTION,
          marketId: null,
          productId: null,
        }),
      ).rejects.toMatchObject({ code: '45011' });
      const n = await asOwner(client, () =>
        client.query(`select 1 from public.ai_requests where user_id = $1`, [
          world.users.puneMr.id,
        ]),
      );
      expect(n.rowCount).toBe(0);
    });
  });
});
