import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { requireDatabase, withClient } from './db.js';
import { API_URL, asUser, signIn, withIdentityLock } from './auth.js';
import { acquireGlobalThresholds } from './global-thresholds.js';
import type { ProfileLike } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * W1-I Part B — `mr_chat` end to end through the DEPLOYED Edge Function.
 *
 * `mr-chat.test.ts` drives `answerMrChat` with a scripted rpc and a scripted model, and proves what
 * the CODE does. **This file proves the database agrees**: a real GoTrue password sign-in, a real
 * `POST` to `http://127.0.0.1:54321/functions/v1/ai-gateway`, and the function's own Deno process
 * calling the RPCs as that user.
 *
 * **THE ASSERTION THAT MATTERS MOST IS NOT A MESSAGE.** `mr_chat`'s guardrail must refuse before any
 * provider call. Asserting the returned sentence would prove only that a sentence came back — the
 * provider could have run first and had its answer discarded. So the proof is read out of the audit
 * row: the stub always reports itself as `stub` with non-null token counts, so
 *
 *   **`ai_requests.model_provider IS NULL` is reachable only if `generate` never ran.**
 *
 * Asserted with its positive control, so a null cannot mean a broken insert.
 *
 * **Its own flag and its own prompt, asserted rather than assumed.** `mr_chat` gets
 * `ai_feature_enabled:mr_chat` and an `mr_chat` prompt version with `MrChatOutputSchema`. One test
 * turns `product_qa` on while `mr_chat` stays off and shows `mr_chat` still refused — the spec's rule
 * that modes must not silently behave as one another, as a test rather than a sentence.
 *
 * **Fixtures are COMMITTED, not rolled back**, because the Edge Function runs in its own process on
 * its own connection and cannot see an open transaction. Everything is namespaced by `runId` and
 * removed in `afterAll`; `app_thresholds` is append-only, so its global rows are reverted by
 * inserting later rows that say they are test artefacts.
 */

const reachable = await requireDatabase();
const FUNCTION_URL = `${API_URL}/functions/v1/ai-gateway`;

const functionIsServed = await (async (): Promise<boolean> => {
  if (!reachable) return false;
  try {
    const response = await fetch(FUNCTION_URL, { method: 'POST' });
    return response.status > 0;
  } catch {
    return false;
  }
})();

if (reachable && !functionIsServed) {
  console.warn(
    `No Edge Function at ${FUNCTION_URL} — mr_chat gateway tests will be skipped.\n` +
      "Run 'pnpm --filter @fieldforce/core build && pnpm functions:serve' first if you meant to run them.",
  );
}

const live = reachable && functionIsServed;

let world: FixtureWorld;
let releaseGlobalThresholds: (() => Promise<void>) | null = null;
let runId = '';
let promptVersionId: string;
let productId: string;
let reviewer: ProfileLike;
let mrToken: string;
/** The brand name this run puts in the catalogue. The out-of-scope control matches on it. */
let brandName = '';

const makeReviewer = async (db: Client, organisationId: string): Promise<string> =>
  withIdentityLock(async () => {
    const id = randomUUID();
    await db.query(
      `insert into auth.users (id, email, aud, role)
       values ($1, $2, 'authenticated', 'authenticated')`,
      [id, `mrchat-reviewer-${id.slice(0, 8)}@example.test`],
    );
    await db.query(
      `insert into public.user_profiles (id, full_name, role, territory_id, is_active, organisation_id)
       values ($1, 'MR Chat Reviewer', 'admin', null, true, $2)`,
      [id, organisationId],
    );
    return id;
  });

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

const setThreshold = async (
  db: Client,
  key: string,
  value: string,
  note: string,
): Promise<void> => {
  await db.query(
    `insert into public.app_thresholds (key, value, scope, note, effective_from)
     values ($1, $2::jsonb, 'global', $3, now())`,
    [key, value, note],
  );
};

beforeAll(async () => {
  if (!live) return;
  // W1-H: taken before seedFixtures(), which takes the identity lock. One consistent order.
  releaseGlobalThresholds = await acquireGlobalThresholds();
  world = await seedFixtures();
  runId = randomUUID().slice(0, 8);
  brandName = `Chatexa${runId}`;

  await withClient(async (db) => {
    const reviewerId = await makeReviewer(db, world.organisationId);
    reviewer = { id: reviewerId, role: 'admin', territoryId: null, isActive: true };

    // `mr_chat`'s OWN flag. `product_qa` is deliberately left OFF here — one test below proves the
    // two do not share a switch.
    await setThreshold(
      db,
      'ai_feature_enabled:mr_chat',
      'true',
      `W1-I test artefact (${runId}). NOT a product decision: #5 is open and no vendor exists. Reverted in afterAll.`,
    );
    await setThreshold(
      db,
      'ai_daily_requests_per_user',
      '50',
      `W1-I test artefact (${runId}). NOT a product decision. Reverted in afterAll.`,
    );

    // A product in THIS organisation's catalogue, so `mr_chat_scope_terms()` has something to
    // return and the out-of-scope control has something to match.
    productId = randomUUID();
    await db.query(
      `insert into public.products (id, organisation_id, brand_name, generic_name)
       values ($1, $2, $3, $4)`,
      [productId, world.organisationId, brandName, `generic${runId}`],
    );

    // `mr_chat`'s OWN approved prompt, with ITS output schema name.
    promptVersionId = randomUUID();
    await db.query(
      `insert into public.ai_prompt_versions
         (id, organisation_id, feature, version_number, system_prompt, output_schema_name,
          created_by_user_id)
       values ($1, $2, 'mr_chat',
               (select coalesce(max(version_number), 0) + 1 from public.ai_prompt_versions
                 where organisation_id = $2 and feature = 'mr_chat'),
               $3, 'MrChatOutputSchema', $4)`,
      [
        promptVersionId,
        world.organisationId,
        'You help a medical representative use their company app.',
        world.users.admin.id,
      ],
    );
    await asRpcUser(db, world.users.admin, `select public.submit_ai_prompt_version($1)`, [
      promptVersionId,
    ]);
    await asRpcUser(db, reviewer, `select public.approve_ai_prompt_version($1, $2)`, [
      promptVersionId,
      `W1-I: mr_chat prompt for a local test. Stub provider, no vendor.`,
    ]);
  });

  const { accessToken } = await signIn(world.users.puneMr.email, world.users.puneMr.password);
  mrToken = accessToken;
}, 180_000);

afterAll(async () => {
  try {
    if (!live || runId === '') return;
    await withClient(async (db) => {
      await setThreshold(
        db,
        'ai_feature_enabled:mr_chat',
        'false',
        `W1-I revert (${runId}). The flag returns to its shipped state: OFF.`,
      );
      await setThreshold(
        db,
        'ai_daily_requests_per_user',
        'null',
        `W1-I revert (${runId}). Restores the UNSET state: an unlimited allowance is never the default.`,
      );
      // `ai_requests` rows are NOT deleted, and the omission is deliberate.
      //
      // The first version of this teardown copied `ai-gateway.spec.ts`'s
      // `delete from public.ai_requests ...` and it printed, every run:
      //
      //   ai_requests is append-only: DELETE is not permitted by any role
      //
      // The table is an audit trail and refuses deletion by design, so that line can never succeed
      // in any suite. It is caught and warned about, which is worse than absent: a warning that
      // always fires is a warning people learn to skim. The rows are namespaced by `runId` and a
      // `pnpm db:reset` clears them, which is how every other append-only table in this suite is
      // handled. (`ai-gateway.spec.ts` still carries the same dead line -- noted in the W1-I log.)
      try {
        await db.query(`delete from public.products where id = $1`, [productId]);
      } catch (error) {
        console.warn('mr-chat teardown left the product behind:', (error as Error).message);
      }
    });
  } finally {
    await releaseGlobalThresholds?.();
    releaseGlobalThresholds = null;
  }
});

/** POST to the function as the signed-in MR. */
const chat = async (
  message: string,
  opts: { token?: string | null } = {},
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(opts.token === null ? {} : { Authorization: `Bearer ${opts.token ?? mrToken}` }),
    },
    body: JSON.stringify({ feature: 'mr_chat', message }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

const auditRow = async (requestId: string) =>
  withClient(async (db) => {
    const { rows } = await db.query<{
      feature: string;
      status: string;
      model_provider: string | null;
      model_name: string | null;
      input_tokens: number | null;
      output_tokens: number | null;
      flags: string[];
      prompt_version_id: string;
      user_id: string;
      organisation_id: string;
    }>(
      `select feature, status, model_provider, model_name, input_tokens, output_tokens, flags,
              prompt_version_id, user_id, organisation_id
         from public.ai_requests where id = $1`,
      [requestId],
    );
    const row = rows[0];
    if (row === undefined) throw new Error(`no ai_requests row for ${requestId}`);
    return row;
  });

// ---------------------------------------------------------------------------

describe.skipIf(!live)('W1-I B4 — mr_chat end to end through the Edge Function', () => {
  it('an MR reaches the function, the database picks the prompt, and the call is audited', async () => {
    const { status, body } = await chat('how do I file a call report');
    expect(status).toBe(200);

    // The stub answers `inScope: false`, so the flow returns the redirect rather than an answer.
    // That is the stub being honest, not a failure -- and the audit is what this test is about.
    expect(body['kind']).toBe('out_of_scope');
    expect(typeof body['requestId']).toBe('string');

    const row = await auditRow(body['requestId'] as string);
    // The database chose the prompt version; the caller never names one.
    expect(row.prompt_version_id).toBe(promptVersionId);
    expect(row.feature).toBe('mr_chat');
    expect(row.status).toBe('completed');
    // The cost fields, populated by the model call that did happen.
    expect(row.model_provider).toBe('stub');
    expect(row.model_name).not.toBeNull();
    expect(row.input_tokens).not.toBeNull();
    expect(row.output_tokens).not.toBeNull();
    // The request belongs to the signed-in MR, not to whoever the gateway runs as.
    expect(row.user_id).toBe(world.users.puneMr.id);
    expect(row.organisation_id).toBe(world.organisationId);
  });

  it('refuses with no bearer token', async () => {
    const { status } = await chat('how do I file a call report', { token: null });
    expect(status).toBe(401);
  });

  it('refuses an mr_chat call with no message, before any control-plane work', async () => {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${mrToken}` },
      body: JSON.stringify({ feature: 'mr_chat' }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body['code']).toBe('22023');
  });
});

describe.skipIf(!live)('W1-I B2 — the guardrail fires BEFORE any provider call', () => {
  it('a message naming a patient is blocked with NO provider recorded', async () => {
    const { status, body } = await chat('my patient Mr Sharma should take what dose');
    expect(status).toBe(200);
    expect(body['kind']).toBe('patient_specific');

    const row = await auditRow(body['requestId'] as string);
    expect(row.status).toBe('blocked');
    // THE PROOF: the stub always reports `stub`. A null provider is only reachable if it never ran.
    expect(row.model_provider).toBeNull();
    expect(row.input_tokens).toBeNull();
    expect(row.flags).toContain('patient_identifier_detected');
  });

  it('W1-J / BE-W126: a bare "patient <Firstname Lastname>" is blocked, end to end', async () => {
    // The phrase that caught NOTHING before W1-J, now proved through the real RPCs and the real
    // function rather than only in the unit flow. The positive control below still applies.
    const { body } = await chat('patient Meena Kumari, 42, has bladder pain');
    expect(body['kind']).toBe('patient_specific');
    const row = await auditRow(body['requestId'] as string);
    expect(row.status).toBe('blocked');
    expect(row.model_provider, 'NO provider call happened').toBeNull();
    expect(row.input_tokens).toBeNull();
  });

  it('POSITIVE CONTROL: a message WITHOUT patient details does reach the provider', async () => {
    // Without this, the null above could equally mean a broken insert.
    const { body } = await chat('where do I find the beat plan');
    const row = await auditRow(body['requestId'] as string);
    expect(row.model_provider).toBe('stub');
    expect(row.input_tokens).not.toBeNull();
  });
});

describe.skipIf(!live)('W1-I B3 — the catalogue check, through the real RPC', () => {
  it('a question naming a product in THIS catalogue is refused with no provider call', async () => {
    const { body } = await chat(`what is the dose of ${brandName}`);
    expect(body['kind']).toBe('out_of_scope');

    const row = await auditRow(body['requestId'] as string);
    expect(row.status).toBe('blocked');
    // No provider: the redirect was decided from the catalogue, not by asking a model.
    expect(row.model_provider).toBeNull();
  });

  it('the generic name is matched too, not only the brand', async () => {
    const { body } = await chat(`is generic${runId} on the formulary`);
    expect(body['kind']).toBe('out_of_scope');
    const row = await auditRow(body['requestId'] as string);
    expect(row.model_provider).toBeNull();
  });

  it('mr_chat_scope_terms returns this organisation’s catalogue to its own MR', async () => {
    const terms = await withClient(async (db) => {
      await db.query('begin');
      try {
        await asUser(db, world.users.puneMr);
        const { rows } = await db.query<{ result: { terms: string[] } }>(
          'select public.mr_chat_scope_terms() as result',
        );
        return rows[0]?.result.terms ?? [];
      } finally {
        await db.query('rollback');
      }
    });
    expect(terms).toContain(brandName);
    expect(terms).toContain(`generic${runId}`);
  });
});

describe.skipIf(!live)('W1-I B1 — mr_chat has its OWN flag, not product_qa’s', () => {
  it('product_qa being ON does not switch mr_chat on', async () => {
    await withClient(async (db) => {
      await setThreshold(
        db,
        'ai_feature_enabled:mr_chat',
        'false',
        `W1-I (${runId}): mr_chat OFF while product_qa is ON, to prove they do not share a switch.`,
      );
      await setThreshold(
        db,
        'ai_feature_enabled:product_qa',
        'true',
        `W1-I test artefact (${runId}). Reverted below.`,
      );
    });
    try {
      const { status, body } = await chat('how do I file a call report');
      // 45011 -> 403. The feature is off even though a DIFFERENT feature is on.
      expect(status).toBe(403);
      expect(body['code']).toBe('45011');
    } finally {
      await withClient(async (db) => {
        await setThreshold(
          db,
          'ai_feature_enabled:product_qa',
          'false',
          `W1-I revert (${runId}). product_qa returns to OFF.`,
        );
        await setThreshold(
          db,
          'ai_feature_enabled:mr_chat',
          'true',
          `W1-I (${runId}): mr_chat back ON for the remaining tests.`,
        );
      });
    }
  });

  it('45012 arrives as 429 when the allowance is spent', async () => {
    await withClient(async (db) => {
      await setThreshold(
        db,
        'ai_daily_requests_per_user',
        '0',
        `W1-I (${runId}): allowance spent, to prove 45012 maps to 429.`,
      );
    });
    try {
      const { status, body } = await chat('how do I file a call report');
      expect(status).toBe(429);
      expect(body['code']).toBe('45012');
    } finally {
      await withClient(async (db) => {
        await setThreshold(
          db,
          'ai_daily_requests_per_user',
          '50',
          `W1-I (${runId}): allowance restored for the remaining tests.`,
        );
      });
    }
  });
});

describe.skipIf(!live)('W1-I B5 — cross-tenant, two-sided', () => {
  it('a rival organisation’s MR does NOT see this organisation’s catalogue terms', async () => {
    const rivalTerms = await withClient(async (db) => {
      await db.query('begin');
      try {
        await asUser(db, world.users.rivalMr);
        const { rows } = await db.query<{ result: { terms: string[] } }>(
          'select public.mr_chat_scope_terms() as result',
        );
        return rows[0]?.result.terms ?? [];
      } finally {
        await db.query('rollback');
      }
    });
    // The refusal side.
    expect(rivalTerms).not.toContain(brandName);
    expect(rivalTerms).not.toContain(`generic${runId}`);
  });

  it('POSITIVE CONTROL: the same function DOES return their own organisation’s terms', async () => {
    // Without this, an empty array could mean the function is broken for everybody rather than
    // scoped -- which is the difference between a tenant boundary and a dead function.
    const rivalBrand = `Rivalexa${runId}`;
    const rivalProductId = randomUUID();
    await withClient(async (db) => {
      await db.query(
        `insert into public.products (id, organisation_id, brand_name) values ($1, $2, $3)`,
        [rivalProductId, world.rivalOrganisationId, rivalBrand],
      );
    });
    try {
      const rivalTerms = await withClient(async (db) => {
        await db.query('begin');
        try {
          await asUser(db, world.users.rivalMr);
          const { rows } = await db.query<{ result: { terms: string[] } }>(
            'select public.mr_chat_scope_terms() as result',
          );
          return rows[0]?.result.terms ?? [];
        } finally {
          await db.query('rollback');
        }
      });
      expect(rivalTerms).toContain(rivalBrand);
      expect(rivalTerms).not.toContain(brandName);
    } finally {
      await withClient(async (db) => {
        await db.query(`delete from public.products where id = $1`, [rivalProductId]);
      });
    }
  });

  it('anon cannot execute mr_chat_scope_terms at all', async () => {
    const allowed = await withClient(async (db) => {
      const { rows } = await db.query<{ ok: boolean }>(
        `select has_function_privilege('anon', 'public.mr_chat_scope_terms()', 'execute') as ok`,
      );
      return rows[0]?.ok ?? true;
    });
    expect(allowed).toBe(false);
  });
});
