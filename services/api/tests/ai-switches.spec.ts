import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { GATEWAY_FEATURES } from '@fieldforce/core';
import { requireDatabase, withClient } from './db.js';
import { ANON_KEY, API_URL, asUser, signIn } from './auth.js';
import type { ProfileLike } from './auth.js';
import { SWITCHABLE, describeStatus, parseSwitches, runSwitches } from '../scripts/ai-switches.mjs';

/**
 * W2-I B1 — the switches script. The parse runs anywhere; the switching runs against the local stack
 * as a throwaway company's own admin, and is proved by the GATEWAY'S OWN admission check
 * (`ai_begin_request`), asked as that company's rep — not by reading back the row it wrote.
 */
describe('W2-I B1 — the command is checked before anything is written', () => {
  it('the five names are exactly the gateway’s five', () => {
    expect([...SWITCHABLE].sort()).toEqual([...GATEWAY_FEATURES].sort());
  });

  it('accepted commands, and what each would write', () => {
    expect(parseSwitches(['on', 'mr_chat', 'product_qa'])).toEqual({
      command: {
        verb: 'on',
        writes: [
          { key: 'ai_feature_enabled:mr_chat', value: true },
          { key: 'ai_feature_enabled:product_qa', value: true },
        ],
      },
      problems: [],
    });
    expect(parseSwitches(['off', 'all']).command.writes).toHaveLength(5);
    expect(parseSwitches(['off', 'all']).command.writes.every((w) => w.value === false)).toBe(true);
    expect(parseSwitches(['limit', '20']).command.writes).toEqual([
      { key: 'ai_daily_requests_per_user', value: 20 },
    ]);
    expect(parseSwitches(['status'])).toEqual({
      command: { verb: 'status', writes: [] },
      problems: [],
    });
  });

  it('refused — and a single bad name refuses the whole command', () => {
    const refused = (words: string[]) => parseSwitches(words).problems;
    expect(refused(['on', 'mr_chat', 'mrchat'])).toHaveLength(1);
    expect(refused(['on'])).toHaveLength(1);
    expect(refused(['on', 'all', 'mr_chat'])).toHaveLength(1);
    expect(refused(['on', 'pv_screening'])).toHaveLength(1); // a real feature, not a gateway one
    for (const n of ['0', '-1', '2.5', 'ten', '1000000', ''])
      expect(refused(['limit', n])).toHaveLength(1);
    expect(refused(['limit', '5', '6'])).toHaveLength(1);
    expect(refused(['status', 'now'])).toHaveLength(1);
    expect(refused(['enable', 'mr_chat'])).toHaveLength(1);
  });

  it('status says why a feature does not run', () => {
    expect(
      describeStatus({
        limit: 20,
        features: [
          { feature: 'mr_chat', on: true, approvedInstructions: true },
          { feature: 'product_qa', on: true, approvedInstructions: false },
          { feature: 'lms_tutor', on: false, approvedInstructions: false },
        ],
      }),
    ).toBe(
      [
        'daily limit per person: 20',
        'mr_chat     RUNS',
        'product_qa  does not run: no approved instruction set',
        'lms_tutor   does not run: switched off, no approved instruction set',
      ].join('\n'),
    );
  });
});

// ---------------------------------------------------------------------------------------------------

const reachable = await requireDatabase();

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
let world: World;

const target = (who: Person) => ({
  url: API_URL,
  apiKey: ANON_KEY,
  email: who.email,
  password: world.password,
});
const admin = (p: Person): ProfileLike => ({
  id: p.userId,
  role: 'admin',
  territoryId: null,
  isActive: true,
});
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
/** The gateway's admission, asked as the company's rep: null when admitted, else the refusal code. */
const admission = async (feature: string): Promise<string | null> => {
  const { accessToken } = await signIn(world.rep.email, world.password);
  const res = await fetch(`${API_URL}/rest/v1/rpc/ai_begin_request`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_feature: feature }),
  });
  const body = (await res.json()) as { code?: string };
  return res.ok ? null : (body.code ?? String(res.status));
};

beforeAll(async () => {
  if (!reachable) return;
  world = JSON.parse(
    execFileSync(
      'node',
      [fileURLToPath(new URL('../scripts/seed-practice-world.mjs', import.meta.url))],
      { encoding: 'utf8' },
    ),
  ) as World;
  // An approved mr_chat instruction set for THIS company, through its own four eyes.
  await withClient(async (db) => {
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
      'W2-I B1: a local test prompt.',
    ]);
  });
}, 180_000);

describe.skipIf(!reachable)('W2-I B1 — switched with the script, proved by the gateway', () => {
  it('OFF → refused 45011; `on mr_chat` → admitted; `off mr_chat` → refused again', async () => {
    const before = await runSwitches(parseSwitches(['status']).command, target(world.authorAdmin));
    expect(before.features.find((f) => f.feature === 'mr_chat')).toEqual({
      feature: 'mr_chat',
      on: false,
      approvedInstructions: true,
    });
    expect(await admission('mr_chat')).toBe('45011');

    const on = await runSwitches(
      parseSwitches(['on', 'mr_chat']).command,
      target(world.authorAdmin),
    );
    expect(describeStatus(on)).toMatch(/^mr_chat {5}RUNS$/mu);
    expect(await admission('mr_chat')).toBeNull();
    // Only the named feature moved: product_qa is still off, and still refused.
    expect(on.features.find((f) => f.feature === 'product_qa')?.on).toBe(false);
    expect(await admission('product_qa')).toBe('45011');

    await runSwitches(parseSwitches(['off', 'mr_chat']).command, target(world.authorAdmin));
    expect(await admission('mr_chat')).toBe('45011');
  });

  it('`limit 1` is the limit the gateway enforces: the second request of the day is refused', async () => {
    await runSwitches(parseSwitches(['on', 'mr_chat']).command, target(world.authorAdmin));
    const status = await runSwitches(
      parseSwitches(['limit', '1']).command,
      target(world.authorAdmin),
    );
    expect(status.limit).toBe(1);
    // The first test's admitted request already used today's one.
    expect(await admission('mr_chat')).toBe('45012');
    await runSwitches(parseSwitches(['limit', '20']).command, target(world.authorAdmin));
    expect(await admission('mr_chat')).toBeNull();
  });

  it('ON but with no approved instruction set: status says so, and the gateway agrees', async () => {
    const status = await runSwitches(
      parseSwitches(['on', 'product_qa']).command,
      target(world.authorAdmin),
    );
    expect(describeStatus(status)).toMatch(
      /^product_qa {2}does not run: no approved instruction set$/mu,
    );
    expect(await admission('product_qa')).toBe('45011');
    await runSwitches(parseSwitches(['off', 'product_qa']).command, target(world.authorAdmin));
  });

  it('REFUSED for a rep, by the database (42501) — nothing changes', async () => {
    await expect(
      runSwitches(parseSwitches(['off', 'mr_chat']).command, target(world.rep)),
    ).rejects.toMatchObject({ code: '42501' });
    expect(await admission('mr_chat')).toBeNull();
  });
});
