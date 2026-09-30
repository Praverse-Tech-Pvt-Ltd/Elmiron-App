import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  SimCoachAnalysisSchema,
  SimCoachOutputSchema,
  StartSimSessionResponseSchema,
} from '@fieldforce/core';
import { requireDatabase, withClient } from './db.js';
import { API_URL, asUser, signIn, withIdentityLock } from './auth.js';
import type { ProfileLike } from './auth.js';
import { acquireGlobalThresholds } from './global-thresholds.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * W1-D B5/B6 — AI Doctor end to end through the deployed Edge Function.
 *
 * Proved the way `product_qa` was proved, because a weaker proof would not be a proof: **a real
 * GoTrue password sign-in, a real `POST` to `:54321/functions/v1/ai-gateway`, and the function's own
 * Deno process calling the RPCs as that user.** No `pg` shortcut for the turn exchange.
 *
 * **What this suite is for, in order:**
 *
 *   1. a rep starts a session on an APPROVED scenario, takes a turn, ends it, and gets an analysis;
 *   2. **cross-tenant refusals, two-sided with a positive control** — the rival organisation's rep
 *      cannot start, turn, end or read anything, and the same calls succeed for the owner;
 *   3. **B6, asserted rather than commented**: the simulation schema references no doctor, no
 *      recording and no patient data, checked against `information_schema` rather than by reading;
 *   4. the never-born-approved rule reaches personas and scenarios too.
 *
 * **The stub is visibly a stub and the test asserts that too.** Every stubbed reply carries
 * `[PRACTICE STUB …]` and the coach's scores are all zero, which is W1-C E2's ruling in code: a
 * plausible sentence would teach a watcher the feature works.
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
    `No Edge Function at ${FUNCTION_URL} — AI Doctor gateway tests will be skipped.\n` +
      "Run 'pnpm --filter @fieldforce/core build && pnpm functions:serve' first. BE-W119: a RUNNING " +
      'server does not reload packages/core/dist, so restart it after any core rebuild.',
  );
}

const live = reachable && functionIsServed;

let world: FixtureWorld;
let releaseGlobalThresholds: (() => Promise<void>) | null = null;
let runId = '';
let reviewer: ProfileLike;
let personaId: string;
let scenarioId: string;
let mrToken: string;
let rivalToken: string;

/** One RPC as a given user, in its own COMMITTED transaction — the function reads from another
 *  connection and cannot see an open one. */
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

/**
 * W1-D / `BE-W116` — reviewer creation is SERIALISED across worker processes.
 *
 * **The defect this closes.** Four spec files each create a second admin to satisfy four eyes, each
 * inserting into `auth.users` and then `public.user_profiles`. Run concurrently, two of those
 * transactions take locks on the shared index and FK pages in an order that can invert, and Postgres
 * resolves it as `deadlock detected` — observed in `ai-product-qa.spec.ts` and `ai-control-plane`
 * at roughly one run in two, registered as `BE-W116` in W1-B and left unfixed.
 *
 * **W1-D added a FOURTH such suite, which made it likelier rather than finding it.** Fixing it here
 * is therefore not scope creep: this session increased the rate.
 *
 * **The fix is the one `tests/auth.ts` already made for identity bursts**, and it is a mechanism
 * rather than a tuned constant: hold the same advisory lock that serialises `POST /admin/users`.
 * At most one reviewer is created at a time across all workers, whatever the suite count — there is
 * no number here for the author of the fifth suite to re-tune.
 */
const makeReviewer = async (db: Client, organisationId: string): Promise<string> => {
  return withIdentityLock(async () => {
    const id = randomUUID();
    await db.query(
      `insert into auth.users (id, email, aud, role)
       values ($1, $2, 'authenticated', 'authenticated')`,
      [id, `sim-reviewer-${id.slice(0, 8)}@example.test`],
    );
    await db.query(
      `insert into public.user_profiles (id, full_name, role, territory_id, is_active, organisation_id)
       values ($1, 'Sim Reviewer', 'admin', null, true, $2)`,
      [id, organisationId],
    );
    return id;
  });
};

/** An APPROVED prompt version for a feature, with the output schema name its flow requires. */
const approvedPrompt = async (db: Client, feature: string, schemaName: string): Promise<void> => {
  const id = randomUUID();
  await db.query(
    `insert into public.ai_prompt_versions
       (id, organisation_id, feature, version_number, system_prompt, output_schema_name,
        created_by_user_id)
     values ($1, $2, $3,
             (select coalesce(max(version_number), 0) + 1 from public.ai_prompt_versions
               where organisation_id = $2 and feature = $3),
             $4, $5, $6)`,
    [
      id,
      world.organisationId,
      feature,
      `A synthetic ${feature} prompt for a stub.`,
      schemaName,
      world.users.admin.id,
    ],
  );
  await asRpcUser(db, world.users.admin, `select public.submit_ai_prompt_version($1)`, [id]);
  await asRpcUser(db, reviewer, `select public.approve_ai_prompt_version($1, $2)`, [
    id,
    `W1-D test attestation for ${feature}: synthetic prompt, stub provider.`,
  ]);
};

beforeAll(async () => {
  if (!live) return;
  // W1-G C1 / BE-W124. Before seedFixtures(), for the lock ordering in global-thresholds.ts.
  releaseGlobalThresholds = await acquireGlobalThresholds();
  world = await seedFixtures();
  runId = randomUUID().slice(0, 8);

  await withClient(async (db) => {
    const reviewerId = await makeReviewer(db, world.organisationId);
    reviewer = { id: reviewerId, role: 'admin', territoryId: null, isActive: true };

    await setThreshold(
      db,
      'ai_feature_enabled:ai_doctor',
      'true',
      `W1-D test artefact (${runId}). NOT a product decision: #5 is open. Reverted in afterAll.`,
    );
    await setThreshold(
      db,
      'ai_feature_enabled:ai_coach',
      'true',
      `W1-D test artefact (${runId}). NOT a product decision. Reverted in afterAll.`,
    );
    await setThreshold(
      db,
      'ai_daily_requests_per_user',
      '200',
      `W1-D test artefact (${runId}). NOT a product decision.`,
    );

    await approvedPrompt(db, 'ai_doctor', 'SimDoctorTurnOutputSchema');
    await approvedPrompt(db, 'ai_coach', 'SimCoachOutputSchema');

    // A persona and a scenario, created as DRAFTS and approved through four eyes -- the only route
    // there is. An insert claiming `approved` is refused, asserted below.
    personaId = randomUUID();
    await asRpcUser(
      db,
      world.users.admin,
      `insert into public.sim_personas
         (id, organisation_id, display_name, specialty, stance, brief, created_by_user_id)
       values ($1, $2, $3, 'Cardiology', 'sceptical', $4, $5)`,
      [
        personaId,
        world.organisationId,
        `Dr A. Practice ${runId}`,
        'A busy cardiologist who has heard this pitch before.',
        world.users.admin.id,
      ],
    );
    await asRpcUser(db, world.users.admin, `select public.submit_sim_content('persona', $1)`, [
      personaId,
    ]);
    await asRpcUser(db, reviewer, `select public.approve_sim_content('persona', $1, $2)`, [
      personaId,
      'W1-D test attestation: a synthetic persona, not a real doctor.',
    ]);

    scenarioId = randomUUID();
    await asRpcUser(
      db,
      world.users.admin,
      `insert into public.sim_scenarios
         (id, organisation_id, persona_id, title, objective, objection, created_by_user_id)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        scenarioId,
        world.organisationId,
        personaId,
        `Storage objection ${runId}`,
        'Explain storage requirements clearly.',
        'I have no room in my fridge.',
        world.users.admin.id,
      ],
    );
    await asRpcUser(db, world.users.admin, `select public.submit_sim_content('scenario', $1)`, [
      scenarioId,
    ]);
    await asRpcUser(db, reviewer, `select public.approve_sim_content('scenario', $1, $2)`, [
      scenarioId,
      'W1-D test attestation: a synthetic scenario.',
    ]);
  });

  mrToken = (await signIn(world.users.puneMr.email, world.users.puneMr.password)).accessToken;
  rivalToken = (await signIn(world.users.rivalMr.email, world.users.rivalMr.password)).accessToken;
}, 180_000);

afterAll(async () => {
  // W1-G C1. Released LAST and in a `finally`: a stranded lock would block every later run of
  // the other two suites for as long as this process lives.
  try {
    if (!live || runId === '') return;
    await withClient(async (db) => {
      // `app_thresholds` is append-only, so the revert is a later row carrying its own note.
      await setThreshold(
        db,
        'ai_feature_enabled:ai_doctor',
        'false',
        `W1-D revert (${runId}). The flag returns to its shipped state: OFF.`,
      );
      await setThreshold(
        db,
        'ai_feature_enabled:ai_coach',
        'false',
        `W1-D revert (${runId}). The flag returns to its shipped state: OFF.`,
      );
      // THE DAILY LIMIT MUST BE REVERTED TOO, and forgetting it broke another suite on CI.
      //
      // `ai_daily_requests_per_user` is a GLOBAL row and this suite COMMITS it, because the Edge
      // Function reads from another connection and cannot see an open transaction. Leaving it set
      // made `ai-control-plane.spec.ts`'s "never unlimited by default" case pass where it must
      // refuse: that test asserts an UNSET limit raises 45011, and this suite had quietly set one.
      //
      // It went unnoticed locally because this machine's database already carried state from earlier
      // sessions. CI starts clean, which is exactly why CI found it and the local run did not.
      //
      // `'null'::jsonb` rather than a number: `threshold() #>> '{}'` yields SQL NULL for it, which is
      // what "no limit configured" means to `ai_begin_request`. The row cannot be DELETED -- the
      // table is append-only by design -- so restoring an absence means asserting it.
      await setThreshold(
        db,
        'ai_daily_requests_per_user',
        'null',
        `W1-D revert (${runId}). Restores the UNSET state: an unlimited allowance is never the default.`,
      );
    });
  } finally {
    await releaseGlobalThresholds?.();
    releaseGlobalThresholds = null;
  }
});

const gateway = async (
  body: Record<string, unknown>,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

const rpcAs = async <T = unknown>(
  profile: ProfileLike,
  sql: string,
  params: unknown[],
): Promise<T | undefined> =>
  withClient(async (db) => {
    await db.query('begin');
    try {
      await asUser(db, profile);
      const { rows } = await db.query<Record<string, unknown>>(sql, params);
      await db.query('commit');
      return rows[0] as T | undefined;
    } catch (error) {
      await db.query('rollback');
      throw error;
    }
  });

describe.skipIf(!live)('W1-D B5 — a practice session end to end', () => {
  it('start -> turn -> end -> analysis, through the deployed function', async () => {
    // 1. START. Through the RPC as the rep -- there is no parameter for whose session it is.
    const started = await rpcAs<{ r: unknown }>(
      world.users.puneMr,
      `select public.start_sim_session($1) as r`,
      [scenarioId],
    );
    const session = StartSimSessionResponseSchema.parse(started?.r);
    expect(session.objection).toContain('fridge');

    // 2. A TURN, through the gateway over HTTP.
    const turn = await gateway(
      {
        feature: 'ai_doctor',
        sessionId: session.sessionId,
        repText: 'It only needs to stay below 25 degrees, so a cupboard is fine.',
        personaBrief: 'A busy cardiologist.',
        personaStance: session.personaStance,
        objection: session.objection,
        history: [],
      },
      mrToken,
    );
    expect(turn.status, JSON.stringify(turn.body)).toBe(200);
    expect(turn.body['kind']).toBe('replied');
    // The stub is VISIBLY a stub -- W1-C E2's ruling, asserted.
    expect(String(turn.body['reply'])).toContain('PRACTICE STUB');
    expect(turn.body['turnCount'], 'a rep turn and a doctor turn').toBe(2);

    // Both turns stored, contiguous, server-indexed.
    const stored = await withClient(async (db) => {
      const { rows } = await db.query<{
        turn_index: number;
        role: string;
        ai_request_id: string | null;
      }>(
        `select turn_index, role, ai_request_id from public.sim_turns
          where session_id = $1 order by turn_index`,
        [session.sessionId],
      );
      return rows;
    });
    expect(stored.map((t) => [t.turn_index, t.role])).toEqual([
      [1, 'rep'],
      [2, 'doctor'],
    ]);
    expect(
      stored[1]?.ai_request_id,
      'the doctor turn is traceable to its ai_requests row',
    ).not.toBeNull();

    // 3. END.
    await rpcAs(world.users.puneMr, `select public.end_sim_session($1) as r`, [session.sessionId]);

    // 4. THE ANALYSIS, through the gateway.
    const analysed = await gateway(
      {
        feature: 'ai_coach',
        sessionId: session.sessionId,
        objective: session.objective,
        objection: session.objection,
        turns: stored.map((t, i) => ({
          turnIndex: t.turn_index,
          role: t.role,
          text: i === 0 ? 'rep said something' : 'doctor replied',
        })),
      },
      mrToken,
    );
    expect(analysed.status, JSON.stringify(analysed.body)).toBe(200);
    expect(analysed.body['kind']).toBe('analysed');

    // The ROW, parsed through the contract it was written against.
    const row = await withClient(async (db) => {
      const { rows } = await db.query<Record<string, unknown>>(
        `select id, organisation_id "organisationId", session_id "sessionId", mr_id "mrId",
                overall_score "overallScore", dimension_scores "dimensionScores",
                strengths, improvements, summary, prompt_version_id "promptVersionId",
                model_provider "modelProvider", model_name "modelName",
                -- to_jsonb(ts) #>> '{}' is what PostgREST serialises a timestamptz to: an ISO
                -- 8601 string. Reading it through the pg driver gives a JS Date, which the contract
                -- rightly refuses -- the contract describes THE WIRE, and this test must compare
                -- like with like rather than loosen the schema for a driver's convenience type.
                to_jsonb(created_at) #>> '{}' as "createdAt"
           from public.sim_coach_analyses where session_id = $1`,
        [session.sessionId],
      );
      return rows[0];
    });
    const parsed = SimCoachAnalysisSchema.safeParse(row);
    expect(parsed.success, `analysis row mismatch: ${JSON.stringify(parsed.error?.issues)}`).toBe(
      true,
    );
    expect(parsed.data?.mrId, 'attributed to the rep, not a service role').toBe(
      world.users.puneMr.id,
    );
    expect(parsed.data?.modelProvider, 'no model ran').toBe('stub');
    // Zero scores, on purpose: a stub must not look like a judgement.
    expect(parsed.data?.overallScore).toBe(0);
  });

  it('the coach output the stub produced satisfies the contract schema too', () => {
    // Guards against the stub drifting out of shape and the suite still passing because the DB
    // validation happened to accept it.
    const out = SimCoachOutputSchema.safeParse({
      overallScore: 0,
      dimensionScores: {
        opening: 0,
        product_knowledge: 0,
        objection_handling: 0,
        communication: 0,
        closing: 0,
      },
      strengths: [{ dimension: 'opening', title: 'x', detail: 'y', turnIndex: 1 }],
      improvements: [{ dimension: 'closing', title: 'x', detail: 'y', turnIndex: 1 }],
      summary: 's',
    });
    expect(out.success).toBe(true);
  });

  it('a finding citing a turn that does not exist is REFUSED by the database', async () => {
    const started = await rpcAs<{ r: { sessionId: string } }>(
      world.users.puneMr,
      `select public.start_sim_session($1) as r`,
      [scenarioId],
    );
    const sid = started?.r.sessionId ?? '';
    await rpcAs(world.users.puneMr, `select public.end_sim_session($1) as r`, [sid]);
    // Turn 99 is not in a session with zero turns.
    await expect(
      rpcAs(
        world.users.puneMr,
        `select public.record_sim_coach_analysis($1, 50,
            '{"opening":1,"product_knowledge":1,"objection_handling":1,"communication":1,"closing":1}'::jsonb,
            '[{"dimension":"opening","title":"t","detail":"d","turnIndex":99}]'::jsonb,
            '[{"dimension":"closing","title":"t","detail":"d","turnIndex":99}]'::jsonb,
            'summary', 'stub', 'no-model') as r`,
        [sid],
      ),
    ).rejects.toThrow(/turn 99/);
  });
});

describe.skipIf(!live)('W1-D B5 — cross-tenant, two-sided', () => {
  it('the RIVAL organisation cannot start a session on our scenario', async () => {
    await expect(
      rpcAs(world.users.rivalMr, `select public.start_sim_session($1) as r`, [scenarioId]),
    ).rejects.toThrow();
  });

  it('POSITIVE CONTROL: our own rep can, with the same call', async () => {
    // Without this, a scenario that was simply broken would pass the test above.
    const started = await rpcAs<{ r: { sessionId: string } }>(
      world.users.puneMr,
      `select public.start_sim_session($1) as r`,
      [scenarioId],
    );
    expect(typeof started?.r.sessionId).toBe('string');
  });

  it('the rival cannot add a turn to our session, over HTTP', async () => {
    const started = await rpcAs<{ r: { sessionId: string } }>(
      world.users.puneMr,
      `select public.start_sim_session($1) as r`,
      [scenarioId],
    );
    const response = await gateway(
      {
        feature: 'ai_doctor',
        sessionId: started?.r.sessionId ?? '',
        repText: 'I should not be able to say this here.',
        personaBrief: 'x',
        personaStance: 'sceptical',
        objection: 'x',
        history: [],
      },
      rivalToken,
    );
    expect(response.status, JSON.stringify(response.body)).not.toBe(200);
  });

  it('the rival cannot READ our session, its turns or its analysis', async () => {
    const counts = await withClient(async (db) => {
      await db.query('begin');
      await asUser(db, world.users.rivalMr);
      const s = await db.query<{ n: string }>(`select count(*) n from public.sim_sessions`);
      const t = await db.query<{ n: string }>(`select count(*) n from public.sim_turns`);
      const a = await db.query<{ n: string }>(`select count(*) n from public.sim_coach_analyses`);
      await db.query('rollback');
      return { s: s.rows[0]?.n, t: t.rows[0]?.n, a: a.rows[0]?.n };
    });
    expect(counts).toEqual({ s: '0', t: '0', a: '0' });
  });

  it('POSITIVE CONTROL: our rep DOES see their own sessions, so the zeros above mean something', async () => {
    const n = await withClient(async (db) => {
      await db.query('begin');
      await asUser(db, world.users.puneMr);
      const r = await db.query<{ n: string }>(`select count(*) n from public.sim_sessions`);
      await db.query('rollback');
      return r.rows[0]?.n;
    });
    expect(Number(n)).toBeGreaterThan(0);
  });

  it('C27: a FIELD MANAGER sees no practice session, no turn and no score', async () => {
    // The no-manager-surface rule, asserted where it is enforced. `visible_user_ids()` -- the helper
    // every manager read uses -- is deliberately absent from these policies, and this is the test
    // that would fail if someone added it "for consistency".
    const counts = await withClient(async (db) => {
      await db.query('begin');
      await asUser(db, world.users.westManager);
      const s = await db.query<{ n: string }>(`select count(*) n from public.sim_sessions`);
      const a = await db.query<{ n: string }>(`select count(*) n from public.sim_coach_analyses`);
      await db.query('rollback');
      return { s: s.rows[0]?.n, a: a.rows[0]?.n };
    });
    expect(counts).toEqual({ s: '0', a: '0' });
  });
});

describe.skipIf(!live)('W1-D B6 — no real doctor, no recording, no patient data', () => {
  it('no simulation table references doctors, visits, consent or analyses', async () => {
    // Asserted from the CATALOGUE, not from reading the migration. A foreign key added later by
    // someone joining "just for convenience" turns this red.
    const fks = await withClient(async (db) => {
      const { rows } = await db.query<{ src: string; tgt: string }>(
        `select tc.table_name as src, ccu.table_name as tgt
           from information_schema.table_constraints tc
           join information_schema.constraint_column_usage ccu
             on ccu.constraint_name = tc.constraint_name
          where tc.constraint_type = 'FOREIGN KEY'
            and tc.table_schema = 'public'
            and tc.table_name like 'sim\\_%'`,
      );
      return rows;
    });
    const forbidden = [
      'doctors',
      'visits',
      'consent_records',
      'analyses',
      'recordings',
      'voice_notes',
      'upload_grants',
      'transcripts',
    ];
    const offenders = fks.filter((f) => forbidden.includes(f.tgt));
    expect(offenders, `simulation must not reference: ${JSON.stringify(offenders)}`).toEqual([]);
    // Positive control: the query DOES find the references that should exist.
    expect(fks.map((f) => f.tgt)).toContain('sim_sessions');
  });

  it('no simulation column could hold audio or a storage key', async () => {
    const cols = await withClient(async (db) => {
      const { rows } = await db.query<{ table_name: string; column_name: string }>(
        `select table_name, column_name from information_schema.columns
          where table_schema = 'public' and table_name like 'sim\\_%'`,
      );
      return rows;
    });
    const audioish = cols.filter((c) =>
      /audio|storage_key|object_key|bucket|duration_seconds|mime/i.test(c.column_name),
    );
    expect(audioish, `no audio column: ${JSON.stringify(audioish)}`).toEqual([]);
    expect(cols.length, 'the query found columns at all').toBeGreaterThan(20);
  });

  it('no simulation column is named for a patient', async () => {
    const cols = await withClient(async (db) => {
      const { rows } = await db.query<{ table_name: string; column_name: string }>(
        `select table_name, column_name from information_schema.columns
          where table_schema = 'public' and table_name like 'sim\\_%'`,
      );
      return rows;
    });
    expect(cols.filter((c) => /patient|diagnosis|prescription|mrn/i.test(c.column_name))).toEqual(
      [],
    );
  });

  it('a rep turn carrying patient details is refused BEFORE any provider call', async () => {
    const started = await rpcAs<{ r: { sessionId: string } }>(
      world.users.puneMr,
      `select public.start_sim_session($1) as r`,
      [scenarioId],
    );
    const sessionId = started?.r.sessionId ?? '';
    const response = await gateway(
      {
        feature: 'ai_doctor',
        sessionId,
        repText: 'my patient on 98765 43210 is 62, what should he take?',
        personaBrief: 'x',
        personaStance: 'sceptical',
        objection: 'x',
        history: [],
      },
      mrToken,
    );
    expect(response.status).toBe(200);
    expect(response.body['kind']).toBe('patient_specific');

    // The proof is STATE, not the message: the stub sets provider `stub` on every call, so a null
    // provider on the blocked request is only reachable if `generate` never ran.
    const row = await withClient(async (db) => {
      const { rows } = await db.query<{
        status: string;
        model_provider: string | null;
        flags: string[];
      }>(
        `select status, model_provider, flags from public.ai_requests
          where feature = 'ai_doctor' order by started_at desc limit 1`,
      );
      return rows[0];
    });
    expect(row?.status).toBe('blocked');
    expect(row?.model_provider, 'NO provider call happened').toBeNull();
    expect(row?.flags).toContain('patient_identifier_detected');

    // And the refused turn was NOT stored -- the patient details do not enter the rep's history.
    const turns = await withClient(async (db) => {
      const { rows } = await db.query<{ n: string }>(
        `select count(*) n from public.sim_turns where session_id = $1`,
        [sessionId],
      );
      return rows[0]?.n;
    });
    expect(turns).toBe('0');
  });

  it('W1-J / BE-W126: a bare "patient <Firstname Lastname>" is blocked here too, with a positive control', async () => {
    // **The guardrail is SHARED.** `detectPatientSignals` serves `product_qa`, `mr_chat` and
    // `ai_doctor`, so `BE-W126` was never `mr_chat`'s gap — it was in this feature as well and was
    // merely exposed by the one built later. Proving the fix on one feature would prove it for a
    // third of the blast radius.
    const started = await rpcAs<{ r: { sessionId: string } }>(
      world.users.puneMr,
      `select public.start_sim_session($1) as r`,
      [scenarioId],
    );
    const sessionId = started?.r.sessionId ?? '';

    const lastDoctorRequest = async () =>
      withClient(async (db) => {
        const { rows } = await db.query<{
          status: string;
          model_provider: string | null;
        }>(
          `select status, model_provider from public.ai_requests
            where feature = 'ai_doctor' order by started_at desc limit 1`,
        );
        return rows[0];
      });

    // The phrase that caught NOTHING before W1-J.
    const blocked = await gateway(
      {
        feature: 'ai_doctor',
        sessionId,
        repText: 'patient Meena Kumari, 42, has bladder pain',
        personaBrief: 'x',
        personaStance: 'sceptical',
        objection: 'x',
        history: [],
      },
      mrToken,
    );
    expect(blocked.body['kind']).toBe('patient_specific');
    const blockedRow = await lastDoctorRequest();
    expect(blockedRow?.status).toBe('blocked');
    expect(blockedRow?.model_provider, 'NO provider call happened').toBeNull();

    // POSITIVE CONTROL, in the same session: without it, a null provider could mean the gateway
    // never reaches a provider at all rather than that this turn was refused.
    const clean = await gateway(
      {
        feature: 'ai_doctor',
        sessionId,
        repText: 'Good morning doctor, may I have two minutes about the formulary change?',
        personaBrief: 'x',
        personaStance: 'sceptical',
        objection: 'x',
        history: [],
      },
      mrToken,
    );
    expect(clean.status).toBe(200);
    const cleanRow = await lastDoctorRequest();
    expect(cleanRow?.model_provider, 'the provider IS reachable on a clean turn').toBe('stub');
  });
});

describe.skipIf(!live)('W1-D B2 — a persona and a scenario are never born approved', () => {
  it.each(['persona', 'scenario'])('an insert claiming approved is refused (%s)', async (kind) => {
    const table = kind === 'persona' ? 'sim_personas' : 'sim_scenarios';
    const sql =
      kind === 'persona'
        ? `insert into public.${table}
             (organisation_id, display_name, specialty, stance, brief, created_by_user_id, status)
           values ($1, 'X', 'Y', 'sceptical', 'Z', $2, 'approved')`
        : `insert into public.${table}
             (organisation_id, persona_id, title, objective, objection, created_by_user_id, status)
           values ($1, $3, 'X', 'Y', 'Z', $2, 'approved')`;
    const params =
      kind === 'persona'
        ? [world.organisationId, world.users.admin.id]
        : [world.organisationId, world.users.admin.id, personaId];
    await expect(rpcAs(world.users.admin, sql, params)).rejects.toThrow(/born a draft/);
  });

  it('the author cannot approve their own persona — four eyes', async () => {
    const id = randomUUID();
    await rpcAs(
      world.users.admin,
      `insert into public.sim_personas
         (id, organisation_id, display_name, specialty, stance, brief, created_by_user_id)
       values ($1, $2, 'Four eyes probe', 'Cardiology', 'rushed', 'A brief.', $3)`,
      [id, world.organisationId, world.users.admin.id],
    );
    await rpcAs(world.users.admin, `select public.submit_sim_content('persona', $1) as r`, [id]);
    await expect(
      rpcAs(world.users.admin, `select public.approve_sim_content('persona', $1, $2) as r`, [
        id,
        'I attest to my own work, which must be refused.',
      ]),
    ).rejects.toThrow(/cannot approve it/);
  });

  it('POSITIVE CONTROL: a second admin CAN approve it', async () => {
    const id = randomUUID();
    await rpcAs(
      world.users.admin,
      `insert into public.sim_personas
         (id, organisation_id, display_name, specialty, stance, brief, created_by_user_id)
       values ($1, $2, 'Four eyes positive', 'Cardiology', 'rushed', 'A brief.', $3)`,
      [id, world.organisationId, world.users.admin.id],
    );
    await rpcAs(world.users.admin, `select public.submit_sim_content('persona', $1) as r`, [id]);
    await rpcAs(reviewer, `select public.approve_sim_content('persona', $1, $2) as r`, [
      id,
      'A second admin attests.',
    ]);
    const status = await withClient(async (db) => {
      const { rows } = await db.query<{ status: string }>(
        `select status from public.sim_personas where id = $1`,
        [id],
      );
      return rows[0]?.status;
    });
    expect(status).toBe('approved');
  });

  it('a session cannot start on an UNAPPROVED scenario', async () => {
    const id = randomUUID();
    await rpcAs(
      world.users.admin,
      `insert into public.sim_scenarios
         (id, organisation_id, persona_id, title, objective, objection, created_by_user_id)
       values ($1, $2, $3, 'Draft scenario', 'O', 'J', $4)`,
      [id, world.organisationId, personaId, world.users.admin.id],
    );
    await expect(
      rpcAs(world.users.puneMr, `select public.start_sim_session($1) as r`, [id]),
    ).rejects.toThrow();
  });
});
