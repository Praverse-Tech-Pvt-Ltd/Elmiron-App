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
  calls: { fn: string; args: Record<string, unknown> }[];
  modelRequests: LlmGenerateRequest[];
}

const fakeRpc = (recorded: Recorded): ControlPlaneRpc => ({
  call: (fn, args) => {
    recorded.calls.push({ fn, args: { ...args } });
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
        });
      case 'sim_coach_module_candidates':
        return Promise.resolve([
          {
            moduleId: MODULE_A,
            moduleTitle: 'Storage and handling',
            courseTitle: 'Product basics',
          },
        ]);
      case 'record_sim_coach_analysis':
        return Promise.resolve({ analysisId: '88888888-8888-4888-8888-888888888888' });
      case 'ai_complete_request':
        return Promise.resolve({ requestId: REQUEST_ID, status: 'recorded' });
      default:
        throw new Error(`unexpected rpc ${fn}`);
    }
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
    provider: scripted(body, recorded),
    sessionId: SESSION_ID,
    objective: 'Explain storage',
    objection: 'No room in my fridge',
    turns: [{ turnIndex: 1, role: 'rep', text: 'It keeps below 25 degrees.' }],
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
