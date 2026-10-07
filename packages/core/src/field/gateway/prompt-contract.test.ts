import { describe, expect, it } from 'vitest';
import { analyseSimSession, takeDoctorTurn } from './sim-doctor.js';
import { answerLessonQuestion } from './lms-tutor.js';
import { answerMrChat } from './mr-chat.js';
import { answerProductQuestion } from './product-qa.js';
import { GATEWAY_FEATURES, PromptModelConfigSchema, promptDraftRow } from './prompt-contract.js';
import type { GatewayFeature } from './prompt-contract.js';
import type { ControlPlaneRpc, LlmGenerateRequest, LlmProvider } from './providers.js';

/**
 * W2-E A (`BE-W164`) — the row the console writes, run through the five REAL flows.
 *
 * Not "the map equals the constants" (that would be the map tested against itself). Each flow's own
 * `prompt_schema_mismatch` check is executed against `promptDraftRow`'s output, for every feature
 * the console offers. Two-sided: the same flow with the column the console used to leave null must
 * still refuse, before the model — the gateway's refusal stays; only the screen loses the ability
 * to produce it.
 *
 * The fake control plane answers `ai_begin_request` with the row as `ai_begin_request` would return
 * it, and the session context the two sim flows read first. Every other call is recorded and then
 * fails: this file is about the gate, not what lies past it.
 */

const SESSION_ID = '77777777-7777-4777-8777-777777777777';

interface Recorded {
  /** `via` says which connection made the call: the rep's (`rpc`) or the gateway's `writer`. */
  calls: { fn: string; args: Record<string, unknown>; via: 'rpc' | 'writer' }[];
  modelRequests: LlmGenerateRequest[];
}

const PAST_THE_GATE = 'past the schema check';

/**
 * W2-E C (`BE-W146`). The gateway's writer: the only connection the database lets close a request.
 * Anything else asked of it is a flow reaching for the service role where it should not.
 */
const fakeWriter = (recorded: Recorded): ControlPlaneRpc => ({
  call: (fn, args) => {
    recorded.calls.push({ fn, args: { ...args }, via: 'writer' });
    if (fn === 'ai_gateway_complete_request') {
      return Promise.resolve({ requestId: '33333333-3333-4333-8333-333333333333' });
    }
    return Promise.reject(new Error(PAST_THE_GATE));
  },
});

const fakeRpc = (
  recorded: Recorded,
  feature: GatewayFeature,
  row: { output_schema_name: string | null; model_config: Record<string, unknown> },
): ControlPlaneRpc => ({
  call: (fn, args) => {
    recorded.calls.push({ fn, args: { ...args }, via: 'rpc' });
    switch (fn) {
      case 'sim_session_context':
        return Promise.resolve({
          sessionId: SESSION_ID,
          state: feature === 'ai_coach' ? 'ended' : 'open',
          personaBrief: 'A busy urologist.',
          personaStance: 'sceptical',
          objective: 'Explain storage',
          objection: 'No room in my fridge',
          turns: [{ turnIndex: 1, role: 'rep', text: 'It keeps below 25 degrees.' }],
        });
      case 'ai_begin_request':
        return Promise.resolve({
          requestId: '33333333-3333-4333-8333-333333333333',
          feature,
          startedAt: '2026-10-07T10:00:00+00:00',
          promptVersionId: '55555555-5555-4555-8555-555555555555',
          promptVersionNumber: 1,
          systemPrompt: 'Approved through the console.',
          outputSchemaName: row.output_schema_name,
          modelConfig: row.model_config,
          requestsUsedToday: 1,
          dailyLimit: 100,
          allowanceWarning: false,
          allowanceResetsAt: '2026-10-07T18:30:00+00:00',
        });
      // The rep's connection cannot close: the database grants the close to the service role only.
      case 'ai_gateway_complete_request':
        return Promise.reject(Object.assign(new Error('permission denied'), { code: '42501' }));
      default:
        return Promise.reject(new Error(PAST_THE_GATE));
    }
  },
});

const recordingProvider = (recorded: Recorded): LlmProvider => ({
  generate: (request) => {
    recorded.modelRequests.push(request);
    return Promise.reject(new Error(PAST_THE_GATE));
  },
});

/** Run one feature's real flow; a throw from past the gate is expected and swallowed. */
const runFlow = async (
  feature: GatewayFeature,
  row: { output_schema_name: string | null; model_config: Record<string, unknown> },
): Promise<Recorded> => {
  const recorded: Recorded = { calls: [], modelRequests: [] };
  const rpc = fakeRpc(recorded, feature, row);
  const writer = fakeWriter(recorded);
  const provider = recordingProvider(recorded);
  const flows: Record<GatewayFeature, () => Promise<unknown>> = {
    product_qa: () =>
      answerProductQuestion({
        rpc,
        writer,
        provider,
        question: 'How should it be stored?',
        marketId: null,
        productId: null,
      }),
    mr_chat: () => answerMrChat({ rpc, writer, provider, message: 'How do I plan a cold call?' }),
    lms_tutor: () =>
      answerLessonQuestion({
        rpc,
        writer,
        provider,
        lessonId: '66666666-6666-4666-8666-666666666666',
        question: 'What does this lesson say about storage?',
      }),
    ai_doctor: () =>
      takeDoctorTurn({ rpc, writer, provider, sessionId: SESSION_ID, repText: 'Good morning.' }),
    ai_coach: () => analyseSimSession({ rpc, writer, provider, sessionId: SESSION_ID }),
  };
  try {
    await flows[feature]();
  } catch (error) {
    if (!(error instanceof Error) || error.message !== PAST_THE_GATE) throw error;
  }
  return recorded;
};

const refusedForSchema = (recorded: Recorded): boolean =>
  recorded.calls.some(
    (c) =>
      c.fn === 'ai_gateway_complete_request' && c.args['p_error_code'] === 'prompt_schema_mismatch',
  );

const CONFIG = { temperature: 0.2, maxTokens: 640 };

describe('a prompt the console writes is one the gateway runs (BE-W164)', () => {
  it.each(GATEWAY_FEATURES)(
    '%s — the console row passes the flow’s own schema check',
    async (f) => {
      const row = promptDraftRow({
        feature: f,
        systemPrompt: 'Approved text.',
        modelConfig: CONFIG,
      });
      const recorded = await runFlow(f, row);
      expect(refusedForSchema(recorded)).toBe(false);
      // Positive evidence it went further: something past the gate was asked for.
      const afterBegin = recorded.calls.slice(
        recorded.calls.findIndex((c) => c.fn === 'ai_begin_request') + 1,
      );
      expect(
        afterBegin.some((c) => c.fn !== 'ai_gateway_complete_request') ||
          recorded.modelRequests.length > 0,
      ).toBe(true);
      // And when the model is reached, the limits the approver saw are the limits it is sent.
      for (const request of recorded.modelRequests) expect(request.modelConfig).toEqual(CONFIG);
    },
  );

  it.each(GATEWAY_FEATURES)(
    '%s — the row the console used to write is still refused',
    async (f) => {
      const recorded = await runFlow(f, { output_schema_name: null, model_config: {} });
      expect(refusedForSchema(recorded)).toBe(true);
      expect(recorded.modelRequests).toHaveLength(0);
    },
  );

  it('a feature’s schema name is not interchangeable with another’s', async () => {
    const wrong = promptDraftRow({ feature: 'ai_doctor', systemPrompt: 'x', modelConfig: CONFIG });
    const recorded = await runFlow('ai_coach', wrong);
    expect(refusedForSchema(recorded)).toBe(true);
  });
});

describe('the request is closed by the gateway, never by the rep (W2-E C, BE-W146)', () => {
  it.each(GATEWAY_FEATURES)(
    '%s — a failed request closes, as failed, through the writer',
    async (f) => {
      const recorded = await runFlow(f, { output_schema_name: null, model_config: {} });
      const closes = recorded.calls.filter((c) => c.fn === 'ai_gateway_complete_request');
      expect(closes.map((c) => [c.via, c.args['p_status']])).toEqual([['writer', 'failed']]);
      // The rep's connection opened the request and was never asked to close it.
      expect(recorded.calls.filter((c) => c.via === 'rpc').map((c) => c.fn)).not.toContain(
        'ai_gateway_complete_request',
      );
    },
  );
});

describe('the limits a prompt carries', () => {
  it('both are required — a version cannot run on defaults nobody approved', () => {
    expect(PromptModelConfigSchema.safeParse({}).success).toBe(false);
    expect(PromptModelConfigSchema.safeParse({ temperature: 0 }).success).toBe(false);
    expect(PromptModelConfigSchema.safeParse({ maxTokens: 800 }).success).toBe(false);
    expect(PromptModelConfigSchema.safeParse({ temperature: 0, maxTokens: 800 }).success).toBe(
      true,
    );
  });

  it('out of range, fractional or unknown keys are refused', () => {
    expect(PromptModelConfigSchema.safeParse({ temperature: 1.01, maxTokens: 800 }).success).toBe(
      false,
    );
    expect(PromptModelConfigSchema.safeParse({ temperature: -0.1, maxTokens: 800 }).success).toBe(
      false,
    );
    expect(PromptModelConfigSchema.safeParse({ temperature: 0, maxTokens: 0 }).success).toBe(false);
    expect(PromptModelConfigSchema.safeParse({ temperature: 0, maxTokens: 8193 }).success).toBe(
      false,
    );
    expect(PromptModelConfigSchema.safeParse({ temperature: 0, maxTokens: 80.5 }).success).toBe(
      false,
    );
    expect(
      PromptModelConfigSchema.safeParse({ temperature: 0, maxTokens: 800, model: 'x' }).success,
    ).toBe(false);
    expect(PromptModelConfigSchema.safeParse({ temperature: 1, maxTokens: 8192 }).success).toBe(
      true,
    );
  });

  it('the row builder will not write limits the schema refuses', () => {
    expect(() =>
      promptDraftRow({
        feature: 'product_qa',
        systemPrompt: 'x',
        modelConfig: { temperature: 2, maxTokens: 800 },
      }),
    ).toThrow();
  });
});
