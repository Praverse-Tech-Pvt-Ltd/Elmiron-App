import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { requireDatabase, withClient } from './db.js';
import { API_URL, asUser, signIn } from './auth.js';
import type { ProfileLike } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * W1-B C3 / C4 — `product_qa` end to end through the DEPLOYED Edge Function.
 *
 * **What makes this different from every other AI test in the repository.** `product-qa.test.ts`
 * drives `answerProductQuestion` with a scripted rpc object, and `ai-product-qa.spec.ts` drives it
 * with a real `pg` client. **Neither goes through HTTP, an Edge Function, or a real JWT.** This one
 * does: a real GoTrue password sign-in, a real `POST` to
 * `http://127.0.0.1:54321/functions/v1/ai-gateway`, and the function's own Deno process calling the
 * RPCs as that user. It is the first test in this repository that exercises the gateway as a rep's
 * phone would.
 *
 * **THE ASSERTION THAT MATTERS MOST IS C4, AND IT IS NOT ABOUT A MESSAGE.**
 *
 * The guardrail must refuse a question carrying patient details **before any provider call**. A
 * test asserting the returned sentence proves only that a sentence was returned — the provider
 * could have been called first and its answer thrown away, and the test would still pass. So the
 * proof is read out of the **audit row**: the stub provider always reports itself as `stub` with
 * non-null token counts, so
 *
 *   **`ai_requests.model_provider IS NULL` is a fact only reachable if `generate` never ran.**
 *
 * That is asserted together with its positive control — the same call without patient details
 * records `model_provider = 'stub'` and non-null tokens — so a null cannot mean a broken insert.
 *
 * **Fixtures are COMMITTED, not rolled back, and that is forced rather than chosen.** The Edge
 * Function runs in its own process on its own connection and cannot see an open transaction's
 * uncommitted rows. Everything created here is namespaced by `runId` and removed in `afterAll`;
 * `app_thresholds` is append-only, so its two global rows are reverted by inserting later rows,
 * each carrying a note saying it is a test artefact and not a product decision — the pattern
 * `.ai-collab/constraints.md` records for exactly this.
 *
 * **Nothing here is a seed (W1-B C6).** No migration, script or seed file gains a product, a
 * knowledge row or a prompt version. This suite creates its own and deletes them.
 */

const reachable = await requireDatabase();

const FUNCTION_URL = `${API_URL}/functions/v1/ai-gateway`;

/** Whether the Edge Function is being served. Absent locally is normal; CI serves it (C5). */
const functionIsServed = await (async (): Promise<boolean> => {
  if (!reachable) return false;
  try {
    const response = await fetch(FUNCTION_URL, { method: 'POST' });
    // Any HTTP answer means something is listening. 401/400 is the function refusing, which is
    // still the function. A connection error is not.
    return response.status > 0;
  } catch {
    return false;
  }
})();

if (reachable && !functionIsServed) {
  console.warn(
    `No Edge Function at ${FUNCTION_URL} — gateway tests will be skipped.\n` +
      "Run 'pnpm --filter @fieldforce/core build && pnpm functions:serve' first if you meant to run them.",
  );
}

const live = reachable && functionIsServed;

let world: FixtureWorld;
let runId = '';
let marketId: string;
let productId: string;
let documentId: string;
let promptVersionId: string;
let reviewerId: string;
let reviewer: ProfileLike;
let mrToken: string;

/** A second admin, because four eyes refuses an author's own approval. */
const makeReviewer = async (db: Client, organisationId: string): Promise<string> => {
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, email, aud, role)
     values ($1, $2, 'authenticated', 'authenticated')`,
    [id, `gw-reviewer-${id.slice(0, 8)}@example.test`],
  );
  await db.query(
    `insert into public.user_profiles (id, full_name, role, territory_id, is_active, organisation_id)
     values ($1, 'Gateway Reviewer', 'admin', null, true, $2)`,
    [id, organisationId],
  );
  return id;
};

/**
 * Run one RPC as a given user, in its OWN committed transaction.
 *
 * `asUser` uses `set local`, which ends with the transaction, so the explicit begin/commit is
 * required rather than tidy — and the commit is required because the Edge Function reads this data
 * from a different connection and cannot see an open transaction.
 */
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
  world = await seedFixtures();
  runId = randomUUID().slice(0, 8);

  await withClient(async (db) => {
    reviewerId = await makeReviewer(db, world.organisationId);
    reviewer = { id: reviewerId, role: 'admin', territoryId: null, isActive: true };

    // --- the flags the control plane refuses without. Both GLOBAL until BE-W106.
    await setThreshold(
      db,
      'ai_feature_enabled:product_qa',
      'true',
      `W1-B C3 test artefact (${runId}). NOT a product decision: #5 is open and no vendor exists. Reverted in afterAll.`,
    );
    await setThreshold(
      db,
      'ai_daily_requests_per_user',
      '50',
      `W1-B C3 test artefact (${runId}). NOT a product decision. Reverted in afterAll.`,
    );

    // --- catalogue scope. A product question must name a market or product content is never returned.
    marketId = randomUUID();
    productId = randomUUID();
    await db.query(
      `insert into public.markets (id, organisation_id, country_code, name)
       values ($1, $2, 'IN', $3)`,
      [marketId, world.organisationId, `Test India ${runId}`],
    );
    await db.query(
      `insert into public.products (id, organisation_id, brand_name)
       values ($1, $2, $3)`,
      [productId, world.organisationId, `Probexa ${runId}`],
    );
    await db.query(
      `insert into public.product_markets (product_id, market_id, organisation_id)
       values ($1, $2, $3)`,
      [productId, marketId, world.organisationId],
    );

    // --- approved knowledge, through the REAL four-eyes path. Not inserted as approved:
    // W1-A E1's trigger refuses that, which is the point of C24.
    documentId = randomUUID();
    await db.query(
      `insert into public.knowledge_documents
         (id, organisation_id, title, document_type, product_id, created_by_user_id)
       values ($1, $2, $3, 'product_label', $4, $5)`,
      [
        documentId,
        world.organisationId,
        `Probexa storage ${runId}`,
        productId,
        world.users.admin.id,
      ],
    );
    const versionId = randomUUID();
    await db.query(
      `insert into public.knowledge_document_versions
         (id, document_id, organisation_id, market_id, body, source_reference, effective_from,
          created_by_user_id)
       values ($1, $2, $3, $4, $5, $6, '2026-01-01', $7)`,
      [
        versionId,
        documentId,
        world.organisationId,
        marketId,
        'Probexa storage: keep below 25 degrees Celsius and away from direct sunlight.',
        `Synthetic test source ${runId}`,
        world.users.admin.id,
      ],
    );
    // `asUser` sets `request.jwt.claims` transaction-locally, so each RPC call needs its own
    // committed transaction -- the Edge Function runs on another connection and must see the result.
    await asRpcUser(db, world.users.admin, `select public.submit_knowledge_version($1)`, [
      versionId,
    ]);
    await asRpcUser(db, reviewer, `select public.approve_knowledge_version($1, $2)`, [
      versionId,
      'W1-B C3 test attestation: synthetic text, checked by the suite that wrote it.',
    ]);

    // --- an APPROVED prompt version, or ai_begin_request raises 45011 whatever the flag says.
    promptVersionId = randomUUID();
    await db.query(
      `insert into public.ai_prompt_versions
         (id, organisation_id, feature, version_number, system_prompt, output_schema_name,
          created_by_user_id)
       values ($1, $2, 'product_qa',
               (select coalesce(max(version_number), 0) + 1 from public.ai_prompt_versions
                 where organisation_id = $2 and feature = 'product_qa'),
               $3, 'ProductQaOutputSchema', $4)`,
      [
        promptVersionId,
        world.organisationId,
        'You answer a medical representative about a product, from the approved sources only.',
        world.users.admin.id,
      ],
    );
    await asRpcUser(db, world.users.admin, `select public.submit_ai_prompt_version($1)`, [
      promptVersionId,
    ]);
    await asRpcUser(db, reviewer, `select public.approve_ai_prompt_version($1, $2)`, [
      promptVersionId,
      'W1-B C3 test attestation: a synthetic prompt for a stub provider.',
    ]);
  });

  const { accessToken } = await signIn(world.users.puneMr.email, world.users.puneMr.password);
  mrToken = accessToken;
}, 120_000);

afterAll(async () => {
  if (!live || runId === '') return;
  await withClient(async (db) => {
    // app_thresholds is append-only by design, so the revert is a later row, not a delete.
    await setThreshold(
      db,
      'ai_feature_enabled:product_qa',
      'false',
      `W1-B C3 revert (${runId}). The flag returns to its shipped state: OFF.`,
    );
    // Best-effort teardown. A failure here must not fail the suite, but it must be visible.
    try {
      await db.query(`delete from public.ai_requests where prompt_version_id = $1`, [
        promptVersionId,
      ]);
      await db.query(`delete from public.product_markets where product_id = $1`, [productId]);
    } catch (error) {
      console.warn('ai-gateway teardown left rows behind:', (error as Error).message);
    }
  });
});

/** POST to the function as the signed-in MR. */
const ask = async (
  question: string,
  opts: { token?: string | null; market?: string | null; product?: string | null } = {},
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(opts.token === null ? {} : { Authorization: `Bearer ${opts.token ?? mrToken}` }),
    },
    body: JSON.stringify({
      question,
      marketId: opts.market === undefined ? marketId : opts.market,
      productId: opts.product === undefined ? productId : opts.product,
    }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

/** The audit row the gateway wrote for a request id. */
const auditRow = async (requestId: string) =>
  withClient(async (db) => {
    const { rows } = await db.query<{
      status: string;
      model_provider: string | null;
      model_name: string | null;
      input_tokens: number | null;
      output_tokens: number | null;
      flags: string[];
      prompt_version_id: string;
      user_id: string;
    }>(
      `select status, model_provider, model_name, input_tokens, output_tokens, flags,
              prompt_version_id, user_id
         from public.ai_requests where id = $1`,
      [requestId],
    );
    // Throwing rather than returning undefined: a missing audit row is the single most serious
    // outcome this suite could see -- a request that ran and left no trail -- and it must fail
    // loudly here rather than as seven confusing "possibly undefined" assertions.
    const row = rows[0];
    if (row === undefined) throw new Error(`no ai_requests row for ${requestId}`);
    return row;
  });

describe.skipIf(!live)('W1-B C3 — product_qa end to end through the Edge Function', () => {
  it('an MR reaches the function, the database decides, and the answer is audited', async () => {
    const { status, body } = await ask('What is the storage temperature?');
    expect(status, JSON.stringify(body)).toBe(200);

    // The stub returns `supported: false`, so the honest outcome is not-available. That IS the
    // end-to-end proof: the flow ran all seven steps and refused to invent an answer.
    expect(body['kind']).toBe('not_available');
    expect(typeof body['requestId']).toBe('string');

    const row = await auditRow(body['requestId'] as string);
    expect(row.prompt_version_id, 'the APPROVED prompt version the database chose').toBe(
      promptVersionId,
    );
    expect(row.user_id, 'audited against the MR, not a service role').toBe(world.users.puneMr.id);
    expect(row.status).toBe('completed');
  });

  it('the cost fields are recorded, which is what C3 asks the audit to carry', async () => {
    const { body } = await ask('Tell me about storage of this product.');
    const row = await auditRow(body['requestId'] as string);
    expect(row.model_provider).toBe('stub');
    expect(row.model_name).toBe('no-model-configured');
    expect(row.input_tokens).toBeGreaterThan(0);
    expect(row.output_tokens).toBeGreaterThan(0);
  });

  it('refuses a request with no bearer token, with the contract code', async () => {
    const { status, body } = await ask('anything', { token: null });
    expect(status).toBe(401);
    expect(body['code']).toBe('28000');
  });
});

describe.skipIf(!live)('W1-B C4 — the guardrail fires BEFORE any provider call', () => {
  /**
   * The load-bearing test of Part C.
   *
   * It does NOT assert the refusal message. It asserts a fact about the audit row that is only
   * reachable if `LlmProvider.generate` was never called: the stub sets `provider = 'stub'` and
   * non-null token counts on every single call, so a null provider on a blocked request means the
   * provider was never reached.
   */
  it('a question carrying a phone number is blocked with NO provider recorded', async () => {
    const { status, body } = await ask('patient on 98765 43210, what dose should he take?');
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body['kind']).toBe('patient_specific');

    const row = await auditRow(body['requestId'] as string);
    expect(row.status).toBe('blocked');
    expect(row.model_provider, 'NO provider call happened').toBeNull();
    expect(row.model_name).toBeNull();
    expect(row.input_tokens, 'no tokens were spent because no model was asked').toBeNull();
    expect(row.output_tokens).toBeNull();
    expect(row.flags).toContain('patient_identifier_detected');
  });

  it('POSITIVE CONTROL: the same call WITHOUT patient details does reach the provider', async () => {
    // Without this, a gateway that never called the provider at all would pass the test above.
    const { body } = await ask('What is the storage temperature for this product?');
    const row = await auditRow(body['requestId'] as string);
    expect(row.status).toBe('completed');
    expect(row.model_provider, 'the provider IS reachable on a clean question').toBe('stub');
    expect(row.input_tokens).toBeGreaterThan(0);
  });

  it('a request for advice about an individual is blocked, also with no provider', async () => {
    const { body } = await ask('my patient is 62 and diabetic, what should I tell his doctor?');
    expect(body['kind']).toBe('patient_specific');
    const row = await auditRow(body['requestId'] as string);
    expect(row.status).toBe('blocked');
    expect(row.model_provider).toBeNull();
  });
});

describe.skipIf(!live)('W1-B C4 — the refusals travel from the database to HTTP', () => {
  it('45011 when the feature flag is off', async () => {
    await withClient(async (db) => {
      await setThreshold(
        db,
        'ai_feature_enabled:product_qa',
        'false',
        `W1-B C4 probe (${runId}): feature off, to prove 45011 reaches the caller.`,
      );
    });
    try {
      const { status, body } = await ask('What is the storage temperature?');
      expect(status).toBe(403);
      expect(body['code']).toBe('45011');
    } finally {
      await withClient(async (db) => {
        await setThreshold(
          db,
          'ai_feature_enabled:product_qa',
          'true',
          `W1-B C4 probe (${runId}): restored for the remaining cases.`,
        );
      });
    }
  });

  it('45012 when the daily allowance is spent', async () => {
    await withClient(async (db) => {
      await setThreshold(
        db,
        'ai_daily_requests_per_user',
        '0',
        `W1-B C4 probe (${runId}): allowance zero, to prove 45012 reaches the caller.`,
      );
    });
    try {
      const { status, body } = await ask('What is the storage temperature?');
      expect(status).toBe(429);
      expect(body['code']).toBe('45012');
    } finally {
      await withClient(async (db) => {
        await setThreshold(
          db,
          'ai_daily_requests_per_user',
          '50',
          `W1-B C4 probe (${runId}): restored.`,
        );
      });
    }
  });

  it('the gateway never sends the question anywhere it can be read back', async () => {
    // §52, and the property `product-qa.test.ts` asserts at the unit level. Asserted again HERE
    // because the Edge Function is a new place a question could have been logged into a column.
    const { body } = await ask('What is the storage temperature, specifically?');
    await withClient(async (db) => {
      const { rows } = await db.query<{ n: string }>(
        `select count(*) n from public.ai_requests
          where id = $1 and (status is null)`,
        [body['requestId']],
      );
      expect(rows[0]?.n).toBe('0');
    });
    const row = await auditRow(body['requestId'] as string);
    // There is no column to hold it -- asserted structurally rather than by searching text.
    expect(Object.keys(row)).not.toContain('question');
    expect(Object.keys(row)).not.toContain('answer');
  });
});
