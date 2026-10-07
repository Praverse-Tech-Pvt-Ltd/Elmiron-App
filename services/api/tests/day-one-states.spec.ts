import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { requireDatabase, withClient } from './db.js';
import { ANON_KEY, API_URL, asUser, signIn } from './auth.js';
import type { ProfileLike } from './auth.js';

/**
 * W2-G A4 — what a rep sees FIRST if anything is wrong on day one, read on the LIVE shape: the
 * assistant's real transport (`createLiveAssistantTransport`) and the screen's own mapping
 * (`outcomeFromGateway`), loaded from `apps/field` by path, as a signed-in rep, against the local
 * gateway. Until W2-G these states had only ever been read on the sample fixture.
 *
 * **Its own organisation.** `seed-practice-world.mjs` mints a throwaway company with two admins and a
 * rep, so switching `mr_chat` on and setting a daily limit of ONE touches no other suite's fixtures.
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
  console.warn(`No Edge Function at ${FUNCTION_URL} — the day-one states test is skipped.`);
}
const live = reachable && served;

interface Person {
  email: string;
  userId: string;
  organisationId: string;
}
interface World {
  password: string;
  run: string;
  authorAdmin: Person;
  approverAdmin: Person;
  rep: Person;
}
type Response = { status: number; body: unknown };
interface FieldModules {
  send: (message: string) => Promise<Response>;
  outcome: (r: Response) => Record<string, unknown>;
}

let world: World;
let repToken = '';

const field = async (): Promise<FieldModules> => {
  const load = async (rel: string): Promise<Record<string, unknown>> =>
    (await import(fileURLToPath(new URL(rel, import.meta.url)))) as Record<string, unknown>;
  const liveModule = await load('../../../apps/field/src/assistant/live.ts');
  const outcomeModule = await load('../../../apps/field/src/assistant/outcome.ts');
  const create = liveModule['createLiveAssistantTransport'] as (
    c: unknown,
  ) => (body: unknown) => Promise<Response>;
  const transport = create({
    baseUrl: API_URL,
    apiKey: ANON_KEY,
    accessToken: () => Promise.resolve(repToken),
  });
  return {
    send: (message) => transport({ feature: 'mr_chat', message }),
    outcome: outcomeModule['outcomeFromGateway'] as FieldModules['outcome'],
  };
};

const admin = (p: Person): ProfileLike => ({
  id: p.userId,
  role: 'admin',
  territoryId: null,
  isActive: true,
});

/** As an admin of the throwaway company, committed. */
const asAdmin = async (db: Client, who: Person, sql: string, params: unknown[]): Promise<void> => {
  await db.query('begin');
  try {
    await asUser(db, admin(who));
    await db.query(sql, params);
    await db.query('commit');
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
};

const setCompanySetting = (db: Client, key: string, value: unknown) =>
  asAdmin(db, world.authorAdmin, `select public.set_organisation_threshold($1, $2::jsonb, $3)`, [
    key,
    JSON.stringify(value),
    `day-one-states.spec run ${world.run} — a throwaway company`,
  ]);

beforeAll(async () => {
  if (!live) return;
  world = JSON.parse(
    execFileSync(
      'node',
      [fileURLToPath(new URL('../scripts/seed-practice-world.mjs', import.meta.url))],
      {
        encoding: 'utf8',
      },
    ),
  ) as World;
  repToken = (await signIn(world.rep.email, world.password)).accessToken;
  await withClient(async (db) => {
    // An approved `mr_chat` prompt for THIS company, through its own four eyes.
    const promptId = randomUUID();
    await asAdmin(
      db,
      world.authorAdmin,
      `insert into public.ai_prompt_versions (id, feature, system_prompt, output_schema_name, model_config, created_by_user_id)
       values ($1, 'mr_chat', 'You help a rep use the app.', 'MrChatOutputSchema', '{"temperature":0.2,"maxTokens":500}', $2)`,
      [promptId, world.authorAdmin.userId],
    );
    await asAdmin(db, world.authorAdmin, `select public.submit_ai_prompt_version($1)`, [promptId]);
    await asAdmin(db, world.approverAdmin, `select public.approve_ai_prompt_version($1, $2)`, [
      promptId,
      'W2-G A4: a local test prompt. Stub provider, no vendor.',
    ]);
  });
}, 180_000);

describe.skipIf(!live)('W2-G A4 — the assistant’s first states, on the live shape', () => {
  it('SWITCHED OFF: the real 403 reads "not available" — nothing was asked', async () => {
    const { send, outcome } = await field();
    const response = await send('How do I end my day?');
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: '45011' });
    expect(outcome(response)).toEqual({ kind: 'not_available' });
  });

  it('NO MODEL, the stub’s DEFAULT: every question gets the product-question redirect, read as a refusal (BE-W166)', async () => {
    const { send, outcome } = await field();
    await withClient(async (db) => {
      await setCompanySetting(db, 'ai_feature_enabled:mr_chat', true);
      await setCompanySetting(db, 'ai_daily_requests_per_user', 20);
    });
    // FOUND by this test, W2-G A4: the stub's default `mr_chat` reply is `inScope: false`, so the
    // gateway answers a HOW-TO question with the real out-of-scope sentence — untrue of the question,
    // and indistinguishable from a real refusal on the screen. Only on a LOCAL target: elsewhere the
    // stub refuses to exist and the answer is 503 `no_provider` ("not available"). One more reason
    // the flag stays off while the stub is the only model.
    const response = await send('How do I end my day?');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ kind: 'out_of_scope' });
    expect(outcome(response)).toMatchObject({
      kind: 'refusal',
      text: expect.stringMatching(/^That looks like a product question/u) as unknown,
    });
  });

  it('NO MODEL, the stub’s in-scope reply: its marker reads "not available" — never an answer', async () => {
    const { send, outcome } = await field();
    const response = await send('How do I end my day? [STUB:in-scope]');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ kind: 'answered' });
    expect(String((response.body as { answer?: unknown }).answer)).toMatch(/^\[PRACTICE STUB/u);
    expect(outcome(response)).toEqual({ kind: 'not_available' });
  });

  it('REFUSED: a patient detail is refused before any model, and shown as a refusal', async () => {
    const { send, outcome } = await field();
    const response = await send('Patient Ramesh Kumar, phone 9876543210 — what should I tell him?');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ kind: 'patient_specific' });
    expect(outcome(response)).toMatchObject({ kind: 'refusal' });
  });

  it('LIMIT REACHED: the real 429 reads "at limit", with the reset time the server sent', async () => {
    const { send, outcome } = await field();
    await withClient(async (db) => {
      await setCompanySetting(db, 'ai_daily_requests_per_user', 1);
    });
    const response = await send('One more question.');
    expect(response.status).toBe(429);
    expect(response.body).toMatchObject({ code: '45012' });
    const read = outcome(response);
    expect(read['kind']).toBe('at_limit');
    expect(read['resetsAt']).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u));
  });
});
