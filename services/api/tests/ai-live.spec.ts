import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { StartSimSessionResponseSchema } from '@fieldforce/core';
import { INDIA_PROFILES } from '../supabase/functions/_shared/bedrock-provider.ts';
import { requireDatabase, withClient } from './db.js';
import { API_URL, asUser, signIn, withIdentityLock } from './auth.js';
import type { ProfileLike } from './auth.js';
import { acquireGlobalThresholds } from './global-thresholds.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';
import { modelAccessGate, readFunctionsEnv } from './live-credential.js';

/**
 * W2-D A3 — ALL FIVE features against the real model, through the real gateway. `pnpm ai:live`.
 *
 * `bedrock-live.spec.ts` proves the two India profiles answer. This file proves the five FEATURES
 * do: a real sign-in, a real `POST /functions/v1/ai-gateway`, the function's own Deno process calling
 * Bedrock, and the audit row read back. **The instruction sets used are the DRAFTS in
 * `docs/ai-platform/drafts/`** (text and model config), approved locally through the real four-eyes
 * RPCs by fixture admins — so the first live run also tests the words the operator will be asked to
 * approve, not a test sentence.
 *
 * It SKIPS, with the reason in the first test's title, until every gate is open, in this order:
 *   1. no credential in `services/api/supabase/functions/.env` (every CI run, by design);
 *   2. model access not granted (the probe names the vendor's error);
 *   3. `AI_PROVIDER` is not `bedrock` in that file — the gateway would answer from the STUB, and a
 *      green run would prove nothing about the model;
 *   4. no local database, or no function being served.
 *
 * **Past the gates it does not skip — it fails.** If the gates say "live" and a row says
 * `model_provider = 'stub'`, `functions serve` was started before `AI_PROVIDER` was set: that is a
 * misconfigured day, and a red that names it is the honest outcome.
 *
 * What it asserts per feature (`KEY-DAY-CHECKLIST.md` D1 §5):
 *   ordinary request → row `completed`, `model_provider` `bedrock`, `model_name` the feature's India
 *   profile, real token counts, the approved prompt's id;
 *   a patient detail → row `blocked`, `model_provider` NULL — refused before any provider call.
 */

const FUNCTION_URL = `${API_URL}/functions/v1/ai-gateway`;
const PATIENT = 'patient Meena Kumari, 42, has bladder pain';

const gate = await (async (): Promise<{ ready: boolean; reason: string }> => {
  const access = await modelAccessGate();
  if (!access.ready) return access;
  if (readFunctionsEnv()?.['AI_PROVIDER'] !== 'bedrock') {
    return {
      ready: false,
      reason:
        'AI_PROVIDER is not bedrock in services/api/supabase/functions/.env — the gateway would answer from the stub',
    };
  }
  if (!(await requireDatabase())) return { ready: false, reason: 'no local database' };
  try {
    await fetch(FUNCTION_URL, { method: 'POST' });
  } catch {
    return { ready: false, reason: `no function served at ${FUNCTION_URL} (pnpm functions:serve)` };
  }
  return { ready: true, reason: 'live' };
})();

type Feature = 'product_qa' | 'mr_chat' | 'lms_tutor' | 'ai_doctor' | 'ai_coach';

const SCHEMA: Record<Feature, string> = {
  product_qa: 'ProductQaOutputSchema',
  mr_chat: 'MrChatOutputSchema',
  lms_tutor: 'LmsTutorOutputSchema',
  ai_doctor: 'SimDoctorTurnOutputSchema',
  ai_coach: 'SimCoachOutputSchema',
};

/** The same choice the gateway makes (`ai-gateway/index.ts`, `BEDROCK_PROFILE`). */
const PROFILE: Record<Feature, string> = {
  product_qa: INDIA_PROFILES.sonnet,
  ai_doctor: INDIA_PROFILES.sonnet,
  ai_coach: INDIA_PROFILES.sonnet,
  mr_chat: INDIA_PROFILES.haiku,
  lms_tutor: INDIA_PROFILES.haiku,
};

/** The draft's own text and model config — the first ```text and ```json blocks of its file. */
const draft = (feature: Feature): { text: string; modelConfig: string } => {
  const file = readFileSync(
    new URL(`../../../docs/ai-platform/drafts/${feature}.md`, import.meta.url),
    'utf8',
  );
  const text = /```text\r?\n([\s\S]*?)\r?\n```/u.exec(file)?.[1];
  const modelConfig = /```json\r?\n([\s\S]*?)\r?\n```/u.exec(file)?.[1];
  if (text === undefined || modelConfig === undefined) {
    throw new Error(`drafts/${feature}.md has no text or json block`);
  }
  return { text, modelConfig };
};

let world: FixtureWorld;
let reviewer: ProfileLike;
let releaseGlobalThresholds: (() => Promise<void>) | null = null;
let runId = '';
let token = '';
let marketId = '';
let productId = '';
let lessonId = '';
let scenarioId = '';
let sessionId = '';
const promptId = {} as Record<Feature, string>;

const asRpcUser = async (
  db: Client,
  profile: ProfileLike,
  sql: string,
  params: unknown[],
): Promise<void> => {
  await db.query('begin');
  try {
    await asUser(db, profile);
    await db.query(sql, params);
    await db.query('commit');
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
};

const gateway = async (
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

interface AuditRow {
  feature: string;
  status: string;
  error_code: string | null;
  model_provider: string | null;
  model_name: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  prompt_version_id: string;
}

const auditRow = async (where: string, params: unknown[]): Promise<AuditRow> =>
  withClient(async (db) => {
    const { rows } = await db.query<AuditRow>(
      `select feature, status, error_code, model_provider, model_name, input_tokens, output_tokens,
              prompt_version_id
         from public.ai_requests where ${where}`,
      params,
    );
    const row = rows[0];
    if (row === undefined) throw new Error(`no ai_requests row (${where})`);
    return row;
  });

const latestRow = (feature: Feature): Promise<AuditRow> =>
  auditRow(`user_id = $1 and feature = $2 order by started_at desc limit 1`, [
    world.users.puneMr.id,
    feature,
  ]);

const expectAnsweredByTheModel = (row: AuditRow, feature: Feature): void => {
  expect(row, JSON.stringify(row)).toMatchObject({
    feature,
    status: 'completed',
    model_provider: 'bedrock',
    model_name: PROFILE[feature],
    prompt_version_id: promptId[feature],
  });
  expect(row.input_tokens).toBeGreaterThan(0);
  expect(row.output_tokens).toBeGreaterThan(0);
};

const expectRefusedBeforeTheModel = (row: AuditRow, feature: Feature): void => {
  expect(row, JSON.stringify(row)).toMatchObject({
    feature,
    status: 'blocked',
    model_provider: null,
  });
};

beforeAll(async () => {
  if (!gate.ready) return;
  releaseGlobalThresholds = await acquireGlobalThresholds();
  world = await seedFixtures();
  runId = randomUUID().slice(0, 8);

  await withClient(async (db) => {
    // The second admin. By SQL, so it does not count against the file's identity budget.
    const reviewerId = await withIdentityLock(async () => {
      const id = randomUUID();
      await db.query(
        `insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')`,
        [id, `live-reviewer-${id.slice(0, 8)}@example.test`],
      );
      await db.query(
        `insert into public.user_profiles (id, full_name, role, territory_id, is_active, organisation_id)
         values ($1, 'Live Reviewer', 'admin', null, true, $2)`,
        [id, world.organisationId],
      );
      return id;
    });
    reviewer = { id: reviewerId, role: 'admin', territoryId: null, isActive: true };

    const note = `W2-D A3 live run (${runId}). NOT a product decision.`;
    for (const key of [
      'ai_feature_enabled:product_qa',
      'ai_feature_enabled:mr_chat',
      'ai_feature_enabled:lms_tutor',
      'ai_feature_enabled:ai_doctor',
      'ai_feature_enabled:ai_coach',
    ]) {
      await db.query(
        `insert into public.app_thresholds (key, value, scope, organisation_id, note, effective_from)
         values ($1, 'true'::jsonb, 'organisation', $2, $3, now())`,
        [key, world.organisationId, note],
      );
    }
    await db.query(
      `insert into public.app_thresholds (key, value, scope, organisation_id, note, effective_from)
       values ('ai_daily_requests_per_user', '50'::jsonb, 'organisation', $1, $2, now())`,
      [world.organisationId, note],
    );

    // Every prompt is a DRAFT's text, submitted by one admin and approved by another.
    for (const feature of Object.keys(SCHEMA) as Feature[]) {
      const { text, modelConfig } = draft(feature);
      const id = randomUUID();
      await db.query(
        `insert into public.ai_prompt_versions
           (id, organisation_id, feature, version_number, system_prompt, output_schema_name,
            model_config, created_by_user_id)
         values ($1, $2, $3,
                 (select coalesce(max(version_number), 0) + 1 from public.ai_prompt_versions
                   where organisation_id = $2 and feature = $3),
                 $4, $5, $6::jsonb, $7)`,
        [
          id,
          world.organisationId,
          feature,
          text,
          SCHEMA[feature],
          modelConfig,
          world.users.admin.id,
        ],
      );
      await asRpcUser(db, world.users.admin, `select public.submit_ai_prompt_version($1)`, [id]);
      await asRpcUser(db, reviewer, `select public.approve_ai_prompt_version($1, $2)`, [
        id,
        `W2-D A3: the DRAFT instruction set, approved for a local live run only.`,
      ]);
      promptId[feature] = id;
    }

    // product_qa: one product, one market, one approved knowledge version.
    marketId = randomUUID();
    productId = randomUUID();
    await db.query(
      `insert into public.markets (id, organisation_id, country_code, name) values ($1, $2, 'IN', $3)`,
      [marketId, world.organisationId, `Live India ${runId}`],
    );
    await db.query(
      `insert into public.products (id, organisation_id, brand_name) values ($1, $2, $3)`,
      [productId, world.organisationId, `Livexa ${runId}`],
    );
    await db.query(
      `insert into public.product_markets (product_id, market_id, organisation_id) values ($1, $2, $3)`,
      [productId, marketId, world.organisationId],
    );
    const documentId = randomUUID();
    await db.query(
      `insert into public.knowledge_documents
         (id, organisation_id, title, document_type, product_id, created_by_user_id)
       values ($1, $2, $3, 'product_label', $4, $5)`,
      [
        documentId,
        world.organisationId,
        `Livexa storage ${runId}`,
        productId,
        world.users.admin.id,
      ],
    );
    const knowledgeId = randomUUID();
    await db.query(
      `insert into public.knowledge_document_versions
         (id, document_id, organisation_id, market_id, body, source_reference, effective_from,
          created_by_user_id)
       values ($1, $2, $3, $4, $5, $6, '2026-01-01', $7)`,
      [
        knowledgeId,
        documentId,
        world.organisationId,
        marketId,
        'Livexa storage: keep below 25 degrees Celsius and away from direct sunlight.',
        `Synthetic live-run source ${runId}`,
        world.users.admin.id,
      ],
    );
    await asRpcUser(db, world.users.admin, `select public.submit_knowledge_version($1)`, [
      knowledgeId,
    ]);
    await asRpcUser(db, reviewer, `select public.approve_knowledge_version($1, $2)`, [
      knowledgeId,
      'W2-D A3: synthetic text for a local live run.',
    ]);

    // lms_tutor: one published lesson the rep is enrolled on.
    const courseId = randomUUID();
    const versionId = randomUUID();
    const moduleId = randomUUID();
    lessonId = randomUUID();
    await db.query('begin');
    try {
      await asUser(db, world.users.admin);
      await db.query(`insert into public.courses (id, title) values ($1, $2)`, [
        courseId,
        `Live course ${runId}`,
      ]);
      await db.query(
        `insert into public.course_versions (id, course_id, organisation_id, title) values ($1, $2, $3, 'v1')`,
        [versionId, courseId, randomUUID()],
      );
      await db.query(
        `insert into public.course_modules (id, course_version_id, organisation_id, position, title)
         values ($1, $2, $3, 1, 'Module one')`,
        [moduleId, versionId, randomUUID()],
      );
      await db.query(
        `insert into public.lessons (id, module_id, course_version_id, organisation_id, position, title, body)
         values ($1, $2, $3, $4, 1, 'Opening the conversation', $5)`,
        [
          lessonId,
          moduleId,
          randomUUID(),
          randomUUID(),
          'Open every visit by stating who you are and why you came, then ask how much time the doctor has. Keep to that time.',
        ],
      );
      await db.query(`select public.publish_course_version($1)`, [versionId]);
      await db.query('commit');
    } catch (error) {
      await db.query('rollback');
      throw error;
    }
    await asRpcUser(db, world.users.admin, `select public.assign_course($1, $2, null)`, [
      courseId,
      world.users.puneMr.id,
    ]);
    await asRpcUser(db, world.users.puneMr, `select public.start_course_version($1)`, [versionId]);

    // ai_doctor / ai_coach: draft persona P2 and scenario S2, approved by four eyes.
    const personaId = randomUUID();
    await asRpcUser(
      db,
      world.users.admin,
      `insert into public.sim_personas
         (id, organisation_id, display_name, specialty, stance, brief, created_by_user_id)
       values ($1, $2, $3, 'Internal medicine', 'sceptical', $4, $5)`,
      [
        personaId,
        world.organisationId,
        `Sceptical physician (practice) ${runId}`,
        'DRAFT. An experienced physician who has heard many pitches and believes few. Polite but unconvinced.',
        world.users.admin.id,
      ],
    );
    await asRpcUser(db, world.users.admin, `select public.submit_sim_content('persona', $1)`, [
      personaId,
    ]);
    await asRpcUser(db, reviewer, `select public.approve_sim_content('persona', $1, $2)`, [
      personaId,
      'W2-D A3: draft persona, local live run.',
    ]);
    scenarioId = randomUUID();
    await asRpcUser(
      db,
      world.users.admin,
      `insert into public.sim_scenarios
         (id, organisation_id, persona_id, title, objective, objection, created_by_user_id)
       values ($1, $2, $3, $4, 'Have the doctor accept one specific claim as supported', $5, $6)`,
      [
        scenarioId,
        world.organisationId,
        personaId,
        `They all say that ${runId}`,
        'Every company tells me theirs is better. Why should I believe you?',
        world.users.admin.id,
      ],
    );
    await asRpcUser(db, world.users.admin, `select public.submit_sim_content('scenario', $1)`, [
      scenarioId,
    ]);
    await asRpcUser(db, reviewer, `select public.approve_sim_content('scenario', $1, $2)`, [
      scenarioId,
      'W2-D A3: draft scenario, local live run.',
    ]);
  });

  token = (await signIn(world.users.puneMr.email, world.users.puneMr.password)).accessToken;
}, 60_000);

afterAll(async () => {
  try {
    if (!gate.ready || runId === '') return;
    await withClient(async (db) => {
      await db.query(`delete from public.product_markets where product_id = $1`, [productId]);
    });
  } finally {
    await releaseGlobalThresholds?.();
    releaseGlobalThresholds = null;
  }
});

describe('W2-D A3 — all five features, live, through the gateway', () => {
  it(`gate: ${gate.ready ? 'READY' : `SKIPPING — ${gate.reason}`}`, () => {
    expect(gate.reason.length).toBeGreaterThan(0);
  });

  describe.skipIf(!gate.ready)('each feature answered by its India profile', () => {
    it('product_qa: an ordinary question is answered by the model', async () => {
      const r = await gateway({ question: 'How should it be stored?', marketId, productId });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expectAnsweredByTheModel(await auditRow('id = $1', [r.body['requestId']]), 'product_qa');
    }, 60_000);

    it('product_qa: a patient detail is refused before the model', async () => {
      const r = await gateway({ question: PATIENT, marketId, productId });
      expect(r.body['kind'], JSON.stringify(r.body)).toBe('patient_specific');
      expectRefusedBeforeTheModel(await auditRow('id = $1', [r.body['requestId']]), 'product_qa');
    }, 60_000);

    it('mr_chat: an ordinary question is answered by the model', async () => {
      const r = await gateway({ feature: 'mr_chat', message: 'How do I file a call report?' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expectAnsweredByTheModel(await auditRow('id = $1', [r.body['requestId']]), 'mr_chat');
    }, 60_000);

    it('mr_chat: a patient detail is refused before the model', async () => {
      const r = await gateway({ feature: 'mr_chat', message: PATIENT });
      expect(r.body['kind'], JSON.stringify(r.body)).toBe('patient_specific');
      expectRefusedBeforeTheModel(await auditRow('id = $1', [r.body['requestId']]), 'mr_chat');
    }, 60_000);

    it('lms_tutor: an ordinary question is answered by the model', async () => {
      const r = await gateway({
        feature: 'lms_tutor',
        lessonId,
        question: 'What should I ask the doctor first?',
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expectAnsweredByTheModel(await auditRow('id = $1', [r.body['requestId']]), 'lms_tutor');
    }, 60_000);

    it('lms_tutor: a patient detail is refused before the model', async () => {
      const r = await gateway({ feature: 'lms_tutor', lessonId, question: PATIENT });
      expect(r.body['kind'], JSON.stringify(r.body)).toBe('patient_specific');
      expectRefusedBeforeTheModel(await auditRow('id = $1', [r.body['requestId']]), 'lms_tutor');
    }, 60_000);

    it('ai_doctor: a practice turn is answered by the model', async () => {
      const started = await withClient(async (db) => {
        await db.query('begin');
        await asUser(db, world.users.puneMr);
        const { rows } = await db.query<{ r: unknown }>(
          `select public.start_sim_session($1) as r`,
          [scenarioId],
        );
        await db.query('commit');
        return rows[0]?.r;
      });
      sessionId = StartSimSessionResponseSchema.parse(started).sessionId;
      const r = await gateway({
        feature: 'ai_doctor',
        sessionId,
        repText:
          'Good morning, doctor. I am here about our approved label for blood pressure control.',
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body['kind'], JSON.stringify(r.body)).toBe('replied');
      const turn = await withClient(async (db) => {
        const { rows } = await db.query<{ ai_request_id: string }>(
          `select ai_request_id from public.sim_turns where session_id = $1 and role = 'doctor'`,
          [sessionId],
        );
        return rows[0]?.ai_request_id;
      });
      expectAnsweredByTheModel(await auditRow('id = $1', [turn]), 'ai_doctor');
    }, 60_000);

    it('ai_doctor: a patient detail is refused before the model', async () => {
      const r = await gateway({ feature: 'ai_doctor', sessionId, repText: PATIENT });
      expect(r.body['kind'], JSON.stringify(r.body)).toBe('patient_specific');
      expectRefusedBeforeTheModel(await latestRow('ai_doctor'), 'ai_doctor');
    }, 60_000);

    it('ai_coach: the ended session is analysed by the model', async () => {
      await withClient(async (db) => {
        await db.query('begin');
        await asUser(db, world.users.puneMr);
        await db.query(`select public.end_sim_session($1)`, [sessionId]);
        await db.query('commit');
      });
      const r = await gateway({ feature: 'ai_coach', sessionId });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body['kind'], JSON.stringify(r.body)).toBe('analysed');
      expectAnsweredByTheModel(await latestRow('ai_coach'), 'ai_coach');
    }, 90_000);
  });
});
