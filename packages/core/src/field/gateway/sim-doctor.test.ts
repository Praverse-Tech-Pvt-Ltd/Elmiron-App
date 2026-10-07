import { describe, expect, it } from 'vitest';
import { SIM_COACH_DIMENSIONS, SIM_COACH_OUTPUT_SCHEMA_NAME } from '../simulation.js';
import { analyseSimSession } from './sim-doctor.js';
import type { ControlPlaneRpc, LlmGenerateRequest, LlmProvider } from './providers.js';

/**
 * W1-M Part C — the `ai_coach` flow against a fake control plane and a scripted model.
 *
 * **`analyseSimSession` had no unit test before W1-M.** Its only cover was one HTTP test in
 * `services/api/tests/sim-gateway.spec.ts`, which runs against the stub — and the stub returns a
 * fixed, valid reply, so no invalid model output ever reached this code under test.
 *
 * What this file proves: the model is offered the database's module list and nothing else, a
 * suggestion outside that list is refused before the database is asked to store it, and an
 * analysis missing one of the seven scores never reaches `record_sim_coach_analysis`.
 *
 * What it cannot prove: that the database agrees. `sim-gateway.spec.ts` W1-M runs the same
 * refusals against the real RPC.
 */

const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '77777777-7777-4777-8777-777777777777';
const MODULE_A = '6f1c2b8e-1d0a-4c4e-9b8f-0a1b2c3d4e5f';
const MODULE_ELSEWHERE = '0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e';

interface Recorded {
  /** `via` says which connection made the call: the rep's (`rpc`) or the gateway's `writer`. */
  calls: { fn: string; args: Record<string, unknown>; via: 'rpc' | 'writer' }[];
  modelRequests: LlmGenerateRequest[];
}

const fakeRpc = (recorded: Recorded): ControlPlaneRpc => ({
  call: (fn, args) => {
    recorded.calls.push({ fn, args: { ...args }, via: 'rpc' });
    switch (fn) {
      case 'ai_begin_request':
        return Promise.resolve({
          requestId: REQUEST_ID,
          feature: 'ai_coach',
          startedAt: '2026-10-01T10:00:00+00:00',
          promptVersionId: '55555555-5555-4555-8555-555555555555',
          promptVersionNumber: 1,
          systemPrompt: 'You are the practice coach.',
          outputSchemaName: SIM_COACH_OUTPUT_SCHEMA_NAME,
          modelConfig: { temperature: 0 },
          requestsUsedToday: 1,
          dailyLimit: 100,
          allowanceWarning: false,
          allowanceResetsAt: '2026-10-01T18:30:00+00:00',
        });
      case 'sim_session_context':
        return Promise.resolve({
          sessionId: SESSION_ID,
          state: 'ended',
          personaBrief: 'A busy urologist.',
          personaStance: 'skeptical',
          objective: 'Explain storage',
          objection: 'No room in my fridge',
          turns: [{ turnIndex: 1, role: 'rep', text: 'It keeps below 25 degrees.' }],
        });
      case 'sim_coach_module_candidates':
        return Promise.resolve([
          {
            moduleId: MODULE_A,
            moduleTitle: 'Storage and handling',
            courseTitle: 'Product basics',
          },
        ]);
      // W1-Z A (`BE-C69`): NOT here. A score written through the rep's connection is now an error:
      // the database grants `record_sim_coach_analysis` to the service role only.
      case 'ai_complete_request':
        return Promise.resolve({ requestId: REQUEST_ID, status: 'recorded' });
      default:
        throw new Error(`unexpected rpc ${fn}`);
    }
  },
});

/** The gateway's writer: the only connection that may store a score (W1-Z A, `BE-C69`). */
const fakeWriter = (
  recorded: Recorded,
  opts: { recordRefuses?: string } = {},
): ControlPlaneRpc => ({
  call: (fn, args) => {
    recorded.calls.push({ fn, args: { ...args }, via: 'writer' });
    if (fn !== 'record_sim_coach_analysis') throw new Error(`unexpected writer call ${fn}`);
    if (opts.recordRefuses !== undefined) {
      const refusal = new Error('refused by the database') as Error & { code?: string };
      refusal.code = opts.recordRefuses;
      return Promise.reject(refusal);
    }
    return Promise.resolve({ analysisId: '88888888-8888-4888-8888-888888888888' });
  },
});

const scripted = (body: unknown, recorded: Recorded): LlmProvider => ({
  generate: (request) => {
    recorded.modelRequests.push(request);
    return Promise.resolve({
      provider: 'scripted',
      model: 'scripted-coach-1',
      text: JSON.stringify(body),
      usage: { inputTokens: 40, outputTokens: 20 },
    });
  },
});

const allScores = Object.fromEntries(SIM_COACH_DIMENSIONS.map((d) => [d, 60]));

const analysis = (suggestedModules: unknown[], scores: Record<string, number> = allScores) => ({
  overallScore: 60,
  dimensionScores: scores,
  strengths: [{ dimension: 'opening', title: 'Clear open', detail: 'd', turnIndex: 1 }],
  improvements: [
    { dimension: 'scientific_accuracy', title: 'Storage claim', detail: 'd', turnIndex: 1 },
  ],
  suggestedModules,
  summary: 'A fair first attempt.',
});

const run = (body: unknown, recorded: Recorded) =>
  analyseSimSession({
    rpc: fakeRpc(recorded),
    writer: fakeWriter(recorded),
    provider: scripted(body, recorded),
    sessionId: SESSION_ID,
  });

const fresh = (): Recorded => ({ calls: [], modelRequests: [] });
const completionOf = (r: Recorded): Record<string, unknown> =>
  r.calls.filter((c) => c.fn === 'ai_complete_request').at(-1)?.args ?? {};
const stored = (r: Recorded) => r.calls.filter((c) => c.fn === 'record_sim_coach_analysis');

describe('ai_coach — nine items, and a suggestion is only ever a real module (W1-M C)', () => {
  it('the module list is fetched BEFORE the model and the model is shown it', async () => {
    const r = fresh();
    await run(analysis([]), r);
    const order = r.calls.map((c) => c.fn);
    expect(order.indexOf('sim_coach_module_candidates')).toBeGreaterThan(-1);
    expect(order.indexOf('sim_coach_module_candidates')).toBeLessThan(
      order.indexOf('record_sim_coach_analysis'),
    );
    const prompt = r.modelRequests[0]?.messages.map((m) => m.content).join('\n') ?? '';
    expect(prompt).toContain(MODULE_A);
    // The model is told the seven scores by name, from the contract's list rather than a copy.
    for (const d of SIM_COACH_DIMENSIONS) expect(prompt).toContain(d);
  });

  it('POSITIVE CONTROL: a suggestion from the list is stored, as given', async () => {
    const r = fresh();
    const suggestion = { moduleId: MODULE_A, dimension: 'scientific_accuracy', reason: 'Label.' };
    const out = await run(analysis([suggestion]), r);
    expect(out.kind).toBe('analysed');
    expect(stored(r)[0]?.args['p_suggested_modules']).toEqual([suggestion]);
    expect(completionOf(r)['p_status']).toBe('completed');
  });

  it('a suggestion NOT on the list is refused before the database is asked to store it', async () => {
    const r = fresh();
    const out = await run(
      analysis([{ moduleId: MODULE_ELSEWHERE, dimension: 'closing', reason: 'Invented.' }]),
      r,
    );
    expect(out.kind).toBe('failed');
    expect(stored(r)).toEqual([]);
    expect(completionOf(r)['p_status']).toBe('failed');
    expect(completionOf(r)['p_error_code']).toBe('unknown_learning_module');
    expect(completionOf(r)['p_flags']).toEqual(['schema_invalid']);
  });

  it('an analysis missing scientific_accuracy never reaches the database', async () => {
    const r = fresh();
    const sixScores = Object.fromEntries(
      Object.entries(allScores).filter(([k]) => k !== 'scientific_accuracy'),
    );
    const out = await run(analysis([], sixScores), r);
    expect(out.kind).toBe('failed');
    expect(stored(r)).toEqual([]);
    expect(completionOf(r)['p_flags']).toEqual(['schema_invalid']);
  });

  it('the model that answered is what is recorded — on the analysis AND the request', async () => {
    // B3's property, for the coach: the model name comes from the provider's own result, never from
    // configuration, so a routing mistake shows up in the audit row instead of being papered over.
    const r = fresh();
    await run(analysis([]), r);
    expect(stored(r)[0]?.args['p_model_name']).toBe('scripted-coach-1');
    expect(completionOf(r)['p_model_name']).toBe('scripted-coach-1');
    expect(completionOf(r)['p_input_tokens']).toBe(40);
  });
});

describe('ai_coach — a refused analysis CLOSES its request (W1-P D2)', () => {
  const runWith = (recorded: Recorded, opts: { recordRefuses?: string }) =>
    analyseSimSession({
      rpc: fakeRpc(recorded),
      writer: fakeWriter(recorded, opts),
      provider: scripted(analysis([]), recorded),
      sessionId: SESSION_ID,
    });

  it('the database refusing the analysis (23514) is the failure sentence, closed as analysis_refused', async () => {
    // The turn list comes from the client, so the database stays the authority: it can refuse what
    // the flow's own check let through. Found by the stub's `[STUB:cite-missing-turn]` branch, where
    // the refusal used to reach the rep raw and leave the request `started` for ever.
    const r = fresh();
    const out = await runWith(r, { recordRefuses: '23514' });
    expect(out.kind).toBe('failed');
    expect(completionOf(r)['p_status']).toBe('failed');
    expect(completionOf(r)['p_error_code']).toBe('analysis_refused');
  });

  it('a WRITER refusal (42501) closes the request too — REVERSED in W1-Z', async () => {
    // **This test once asserted the opposite**: "an identity refusal (42501) is NOT swallowed — it
    // still propagates". That was right while the score was written AS THE REP, where 42501 meant
    // "not your session". Since W1-Z (`BE-C69`) the score goes through the gateway's writer, the
    // rep's identity was already checked through `rpc`, and a 42501 here means the database refused
    // the REQUEST BINDING — so the model has answered and been paid for, and leaving the request
    // `started` is exactly `BE-W145`. Closed, with the SQLSTATE in the code.
    const r = fresh();
    const out = await runWith(r, { recordRefuses: '42501' });
    expect(out.kind).toBe('failed');
    expect(completionOf(r)['p_status']).toBe('failed');
    expect(completionOf(r)['p_error_code']).toBe('write_refused_42501');
  });

  it('W1-Z BE-W145: an analysis already stored (23505) closes the request; it used to leave it open', async () => {
    const r = fresh();
    const out = await runWith(r, { recordRefuses: '23505' });
    expect(out.kind).toBe('failed');
    expect(completionOf(r)['p_status']).toBe('failed');
    expect(completionOf(r)['p_error_code']).toBe('write_refused_23505');
    expect(completionOf(r)['p_flags']).toEqual([]);
  });
});

describe('ai_coach — the score is written by the gateway, never as the rep (W1-Z A, BE-C69)', () => {
  it('the score goes through the WRITER, bound to the request the rep began', async () => {
    const r = fresh();
    const out = await run(analysis([]), r);
    expect(out.kind).toBe('analysed');
    const writes = r.calls.filter((c) => c.fn === 'record_sim_coach_analysis');
    expect(writes.map((c) => c.via)).toEqual(['writer']);
    expect(writes[0]?.args['p_ai_request_id']).toBe(REQUEST_ID);
  });

  it('POSITIVE CONTROL: everything else still goes through the rep’s connection', async () => {
    const r = fresh();
    await run(analysis([]), r);
    const viaRep = r.calls.filter((c) => c.via === 'rpc').map((c) => c.fn);
    expect(viaRep).toEqual(
      expect.arrayContaining(['sim_session_context', 'ai_begin_request', 'ai_complete_request']),
    );
    expect(r.calls.filter((c) => c.via === 'writer').map((c) => c.fn)).toEqual([
      'record_sim_coach_analysis',
    ]);
  });
});

describe('ai_coach — the model is told the shape it is held to (W2-E B, BE-W163)', () => {
  it('the system message the model receives spells out the JSON, keys and nesting', async () => {
    const r = fresh();
    await run(analysis([]), r);
    const system = r.modelRequests[0]?.messages.find((m) => m.role === 'system')?.content ?? '';
    // The shape a model would copy, not just a list of words somewhere in the text.
    expect(system).toContain('"dimensionScores": {"opening": integer');
    expect(system).toContain(
      '"strengths": [{"dimension": a dimension name, "title": string, "detail": string, "turnIndex": integer}]',
    );
    expect(system).toContain(
      '"suggestedModules": [{"moduleId": string, "dimension": a dimension name, "reason": string}]',
    );
  });

  it('POSITIVE: an answer in exactly that shape is analysed and stored', async () => {
    const r = fresh();
    const out = await run(analysis([]), r);
    expect(out.kind).toBe('analysed');
    expect(stored(r)).toHaveLength(1);
    expect(completionOf(r)['p_status']).toBe('completed');
  });

  it('NEGATIVE: the plausible snake_case answer a model invents unprompted fails as schema_mismatch', async () => {
    const r = fresh();
    const out = await run(
      {
        overall_score: 60,
        dimension_scores: allScores,
        strengths: [{ dimension: 'opening', title: 'Clear open', detail: 'd', turn_index: 1 }],
        areas_for_improvement: [
          { dimension: 'closing', title: 'No next step', detail: 'd', turn_index: 1 },
        ],
        suggested_modules: [],
        summary: 'A fair first attempt.',
      },
      r,
    );
    expect(out.kind).toBe('failed');
    expect(stored(r)).toEqual([]);
    expect(completionOf(r)).toMatchObject({
      p_status: 'failed',
      p_flags: ['schema_invalid'],
      p_error_code: 'schema_mismatch',
    });
  });

  it('NEGATIVE: findings as bare sentences — the right keys, the wrong nesting — fail the same way', async () => {
    const r = fresh();
    const out = await run(
      { ...analysis([]), strengths: ['Clear opening'], improvements: ['No next step agreed'] },
      r,
    );
    expect(out.kind).toBe('failed');
    expect(stored(r)).toEqual([]);
    expect(completionOf(r)['p_error_code']).toBe('schema_mismatch');
  });
});
