import { describe, expect, it } from 'vitest';
import { PRODUCT_QA_BENCHMARK } from './benchmarks.js';
import type { ProductQaBenchmarkCase, ScriptedModelBehaviour } from './benchmarks.js';
import { detectPatientSignals } from './guardrails.js';
import { PRODUCT_QA_OUTPUT_SCHEMA_NAME, answerProductQuestion } from './product-qa.js';
import type { ControlPlaneRpc, LlmGenerateRequest, LlmProvider } from './providers.js';

/**
 * AI-D1 — the product_qa flow against a fake control plane and a scripted model.
 *
 * What this file can prove: what the CODE does with every kind of model reply and every kind of
 * question. What it cannot: that the database agrees — `services/api/tests/ai-product-qa.spec.ts`
 * runs the same benchmark against the real RPCs.
 */

const CHUNK_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

interface Recorded {
  calls: { fn: string; args: Record<string, unknown> }[];
  modelRequests: LlmGenerateRequest[];
}

const fakeRpc = (
  knowledge: 'matching' | 'none',
  recorded: Recorded,
  outputSchemaName = PRODUCT_QA_OUTPUT_SCHEMA_NAME,
): ControlPlaneRpc => ({
  call: (fn, args) => {
    recorded.calls.push({ fn, args: { ...args } });
    switch (fn) {
      case 'ai_begin_request':
        return Promise.resolve({
          requestId: REQUEST_ID,
          feature: 'product_qa',
          startedAt: '2026-09-24T10:00:00+00:00',
          promptVersionId: '44444444-4444-4444-8444-444444444444',
          promptVersionNumber: 1,
          systemPrompt: 'You are the approved product information assistant.',
          outputSchemaName,
          modelConfig: { temperature: 0 },
          requestsUsedToday: 1,
          dailyLimit: 50,
        });
      case 'search_approved_knowledge':
        return Promise.resolve(
          knowledge === 'none'
            ? { status: 'not_available', searchedOn: '2026-09-24', results: [] }
            : {
                status: 'found',
                searchedOn: '2026-09-24',
                results: [
                  {
                    chunkId: CHUNK_ID,
                    documentId: '55555555-5555-4555-8555-555555555555',
                    documentTitle: 'Benchmarol label',
                    documentType: 'product_label',
                    documentVersionId: VERSION_ID,
                    versionNumber: 3,
                    marketId: null,
                    productId: null,
                    sourceReference: 'Label v3',
                    heading: 'Storage',
                    position: 1,
                    body: 'Store Benchmarol tablets below 25 degrees.',
                    rank: 0.5,
                  },
                ],
              },
        );
      case 'ai_complete_request':
        return Promise.resolve({ requestId: REQUEST_ID });
      default:
        return Promise.reject(new Error(`unexpected rpc ${fn}`));
    }
  },
});

const reply = (json: unknown) => ({
  text: typeof json === 'string' ? json : JSON.stringify(json),
  usage: { inputTokens: 100, outputTokens: 20 },
  provider: 'scripted',
  model: 'scripted-1',
});

const scriptedProvider = (behaviour: ScriptedModelBehaviour, recorded: Recorded): LlmProvider => ({
  generate: (request) => {
    recorded.modelRequests.push(request);
    switch (behaviour) {
      case 'answers_with_valid_citation':
        return Promise.resolve(
          reply({ supported: true, answer: 'Store below 25 °C.', citedChunkIds: [CHUNK_ID] }),
        );
      case 'cites_unknown_chunk':
        return Promise.resolve(
          reply({
            supported: true,
            answer: 'It cures migraine.',
            citedChunkIds: ['99999999-9999-4999-8999-999999999999'],
          }),
        );
      case 'answers_without_citation':
        return Promise.resolve(
          reply({ supported: true, answer: 'Store below 25 °C.', citedChunkIds: [] }),
        );
      case 'says_unsupported':
        return Promise.resolve(reply({ supported: false, answer: '', citedChunkIds: [] }));
      case 'returns_prose':
        return Promise.resolve(reply('Sure! Benchmarol should be stored somewhere cool.'));
      case 'times_out':
        return new Promise(() => undefined);
      case 'must_not_be_called':
        return Promise.reject(new Error('the model must not be called in this case'));
    }
  },
});

const run = async (c: ProductQaBenchmarkCase) => {
  const recorded: Recorded = { calls: [], modelRequests: [] };
  const result = await answerProductQuestion({
    rpc: fakeRpc(c.knowledge, recorded),
    provider: scriptedProvider(c.model, recorded),
    question: c.question,
    marketId: null,
    productId: null,
    timeoutMs: 50,
  });
  return { result, recorded };
};

describe('AI-D1 — the product_qa benchmark, guardrail cases', () => {
  const runnable = PRODUCT_QA_BENCHMARK.filter((c) => !c.requiresRealModel);
  const skipped = PRODUCT_QA_BENCHMARK.filter((c) => c.requiresRealModel);

  it.each(runnable.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    const { result, recorded } = await run(c);
    expect(result.kind).toBe(c.expected.kind);
    expect(recorded.modelRequests.length > 0, 'model called').toBe(c.expected.modelCalled);

    const completes = recorded.calls.filter((x) => x.fn === 'ai_complete_request');
    expect(completes, 'the request is closed exactly once').toHaveLength(1);
    const completion = completes[0]?.args ?? {};
    expect(completion['p_status']).toBe(c.expected.requestStatus);
    expect(completion['p_flags']).toEqual(c.expected.flags);

    // §52: the log never receives the question — nor, for that matter, the answer.
    expect(JSON.stringify(completes)).not.toContain(c.question);
    if (result.kind === 'answered') expect(JSON.stringify(completes)).not.toContain(result.answer);
  });

  it.skip.each(skipped.map((c) => [c.id] as const))(
    '%s — needs a real model (D2)',
    () => undefined,
  );
});

describe('AI-D1 — what the model is and is not shown', () => {
  it('only the approved sources and the question, and it must name what it used', async () => {
    const c = PRODUCT_QA_BENCHMARK.find((x) => x.id === 'correct-answer');
    if (c === undefined) throw new Error('missing case');
    const { result, recorded } = await run(c);
    const messages = recorded.modelRequests[0]?.messages ?? [];
    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(messages[1]?.content).toContain(`id=${CHUNK_ID}`);
    expect(messages[0]?.content).toContain('Answer ONLY from the numbered sources');
    expect(recorded.modelRequests[0]?.json).toBe(true);

    expect(result).toMatchObject({
      kind: 'answered',
      citations: [{ chunkId: CHUNK_ID, documentVersionId: VERSION_ID, heading: 'Storage' }],
    });
    const completion = recorded.calls.find((x) => x.fn === 'ai_complete_request')?.args ?? {};
    expect(
      completion['p_knowledge_version_ids'],
      'the log names the version the answer rests on',
    ).toEqual([VERSION_ID]);
    expect(completion).toMatchObject({
      p_input_tokens: 100,
      p_output_tokens: 20,
      p_model_provider: 'scripted',
    });
  });

  it('a patient-specific question never reaches search, let alone the model', async () => {
    const c = PRODUCT_QA_BENCHMARK.find((x) => x.id === 'patient-phone-number');
    if (c === undefined) throw new Error('missing case');
    const { recorded } = await run(c);
    expect(recorded.calls.map((x) => x.fn)).toEqual(['ai_begin_request', 'ai_complete_request']);
  });

  it('a prompt approved for a different output shape is refused, not guessed at', async () => {
    const recorded: Recorded = { calls: [], modelRequests: [] };
    const result = await answerProductQuestion({
      rpc: fakeRpc('matching', recorded, 'SomeOtherSchema'),
      provider: scriptedProvider('must_not_be_called', recorded),
      question: 'How should Benchmarol be stored?',
      marketId: null,
      productId: null,
    });
    expect(result.kind).toBe('failed');
    expect(recorded.modelRequests).toHaveLength(0);
    expect(recorded.calls.find((x) => x.fn === 'ai_complete_request')?.args).toMatchObject({
      p_status: 'failed',
      p_error_code: 'prompt_schema_mismatch',
    });
  });

  it('a refusal from the control plane is thrown with its SQLSTATE, before anything else happens', async () => {
    const recorded: Recorded = { calls: [], modelRequests: [] };
    const refusing: ControlPlaneRpc = {
      call: () => Promise.reject(Object.assign(new Error('switched off'), { code: '45011' })),
    };
    await expect(
      answerProductQuestion({
        rpc: refusing,
        provider: scriptedProvider('must_not_be_called', recorded),
        question: 'How should Benchmarol be stored?',
        marketId: null,
        productId: null,
      }),
    ).rejects.toMatchObject({ code: '45011' });
    expect(recorded.modelRequests).toHaveLength(0);
  });
});

describe('AI-D1 — patient guardrails', () => {
  it.each([
    ['phone, spaced', 'Call the patient on 98765 43210', 'phone_number'],
    ['phone, +91', 'number is +91-9876543210', 'phone_number'],
    ['phone, leading 0', 'on 09876543210 today', 'phone_number'],
    ['aadhaar-shaped', 'ID 1234 5678 9012', 'national_id_number'],
    ['email', 'mail rao.k@example.com', 'email_address'],
    ['named', 'my patient Mrs Iyer', 'patient_named'],
    ['named, "called"', 'a patient called Suresh', 'patient_named'],
    ['date of birth', 'DOB 12/03/1961', 'date_of_birth'],
    ['advice', 'what should this patient take for pain', 'patient_specific_advice'],
    ['advice, inverted', 'should I prescribe it to her patient', 'patient_specific_advice'],
  ])('%s', (_label, text, signal) => {
    expect(detectPatientSignals(text)).toContain(signal);
  });

  it.each([
    'What is the storage temperature for Benchmarol 500 mg tablets?',
    'How many tablets are in a strip of 30?',
    'Summarise the 2024 phase 3 study of 1,250 participants.',
    'What are the contraindications listed on the label?',
    'How do I handle a doctor who says patients prefer the competitor?',
    'Give me a 30-second pitch for Benchmarol.',
  ])('an ordinary product question is not refused: %s', (text) => {
    expect(detectPatientSignals(text)).toEqual([]);
  });
});
