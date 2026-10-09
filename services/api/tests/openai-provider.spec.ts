import { describe, expect, it, vi } from 'vitest';
import {
  BENCHMARK_MATCHING_QUESTION,
  GATEWAY_MODEL,
  GATEWAY_MODEL_LABEL,
  MrChatOutputSchema,
  OPENAI_MODEL,
  PATIENT_SPECIFIC_REFUSAL_MESSAGE,
  PRODUCT_QA_OUTPUT_SCHEMA_NAME,
  ProviderError,
  ProviderTimeoutError,
  SIM_DOCTOR_TURN_OUTPUT_SCHEMA_NAME,
  analyseSimSession,
  answerProductQuestion,
  generateStructured,
  invalidOutput,
  providerFailure,
  takeDoctorTurn,
  withTimeout,
} from '@fieldforce/core';
import type { ControlPlaneRpc, LlmGenerateRequest } from '@fieldforce/core';
import {
  OPENAI_CHAT_URL,
  OpenAiConfigurationError,
  createOpenAiProvider,
} from '../supabase/functions/_shared/openai-provider.ts';

/**
 * `BE-W178` / `BE-C79` — the OpenAI adapter, proved against a MOCKED network. No call reaches OpenAI:
 * every test injects `fetch`. **IMPLEMENTED, NOT LIVE VERIFIED.**
 *
 * Two layers: what the adapter sends and how it reads every kind of reply; then the real flows from
 * `@fieldforce/core` run on top of it, to show the rules that live in the flows -- approved sources
 * only, patient data never sent, practice-only simulation, the audit row -- hold with this vendor.
 */

const KEY = 'sk-test-THIS-MUST-NEVER-BE-PRINTED';

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  signal: AbortSignal | undefined;
}

/** A fake network: records each request and answers with `respond`. */
const network = (respond: (sent: Sent) => Promise<Response> | Response) => {
  const sent: Sent[] = [];
  // The adapter always sends a string URL and a string body; the fake is typed to say so.
  const fetch = vi.fn((url: string, init?: RequestInit & { body?: string }) => {
    const record: Sent = {
      url,
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(init?.body ?? 'null') as Record<string, unknown>,
      signal: init?.signal ?? undefined,
    };
    sent.push(record);
    return Promise.resolve(respond(record));
  }) as unknown as typeof globalThis.fetch;
  return { fetch, sent };
};

/** The one request a test expects; fails the test, rather than asserting, when there is none. */
const first = (sent: readonly Sent[]): Sent => {
  const only = sent[0];
  if (only === undefined) throw new Error('no request was sent');
  return only;
};

const reply = (
  content: string | null,
  extra: { finish_reason?: string; refusal?: string; usage?: unknown; status?: number } = {},
): Response =>
  new Response(
    JSON.stringify({
      id: 'chatcmpl-1',
      model: 'gpt-4.1-2025-04-14',
      choices: [
        {
          index: 0,
          finish_reason: extra.finish_reason ?? 'stop',
          message: {
            role: 'assistant',
            content,
            ...(extra.refusal !== undefined ? { refusal: extra.refusal } : {}),
          },
        },
      ],
      usage:
        'usage' in extra
          ? extra.usage
          : { prompt_tokens: 31, completion_tokens: 12, total_tokens: 43 },
    }),
    { status: extra.status ?? 200, headers: { 'content-type': 'application/json' } },
  );

const request = (
  overrides: Partial<LlmGenerateRequest> = {},
  signal: AbortSignal = new AbortController().signal,
): LlmGenerateRequest => ({
  messages: [
    { role: 'system', content: 'You are the in-app assistant. Reply with JSON only.' },
    { role: 'user', content: 'How do I check out?' },
  ],
  modelConfig: { temperature: 0, maxTokens: 400 },
  json: true,
  signal,
  ...overrides,
});

const provider = (fetch: typeof globalThis.fetch, model = OPENAI_MODEL.haiku) =>
  createOpenAiProvider({ apiKey: KEY, model, fetch });

describe('construction and selection', () => {
  it('refuses to exist without a key, and says so without any value', () => {
    for (const apiKey of [undefined, '', '   ']) {
      expect(() => createOpenAiProvider({ apiKey, model: 'gpt-4.1' })).toThrow(
        OpenAiConfigurationError,
      );
    }
  });

  it('every feature maps to an OpenAI model, and the screen label names that model, not Claude', () => {
    for (const tier of Object.values(GATEWAY_MODEL)) {
      expect(OPENAI_MODEL[tier]).toMatch(/^gpt-/u);
      expect(GATEWAY_MODEL_LABEL[tier]).toBe(`OpenAI ${OPENAI_MODEL[tier]}`);
      expect(GATEWAY_MODEL_LABEL[tier]).not.toMatch(/Claude|Sonnet|Haiku|Bedrock/u);
    }
  });
});

describe('normal generation', () => {
  it('sends the approved messages unchanged, to OpenAI only, with the key in the header only', async () => {
    const net = network(() => reply('{"inScope": true, "answer": "Tap Check out."}'));
    const result = await provider(net.fetch).generate(request());

    expect(net.sent).toHaveLength(1);
    const sent = first(net.sent);
    expect(sent.url).toBe(OPENAI_CHAT_URL);
    expect(sent.headers['authorization']).toBe(`Bearer ${KEY}`);
    expect(sent.body).toEqual({
      model: OPENAI_MODEL.haiku,
      messages: request().messages,
      temperature: 0,
      max_completion_tokens: 400,
      response_format: { type: 'json_object' },
    });
    expect(JSON.stringify(sent.body)).not.toContain(KEY);
    expect(result.text).toBe('{"inScope": true, "answer": "Tap Check out."}');
    expect(result.provider).toBe('openai');
    expect(result.refused).toBeUndefined();
    expect(result.truncated).toBeUndefined();
  });

  it('plain text: no JSON mode is asked for, and nothing is added to the prompt', async () => {
    const net = network(() => reply('Tap Check out.'));
    const messages = [{ role: 'user' as const, content: 'How do I check out?' }];
    await provider(net.fetch).generate(request({ json: false, messages, modelConfig: {} }));
    expect(first(net.sent).body).toEqual({ model: OPENAI_MODEL.haiku, messages });
  });

  it('JSON wanted but the prompt never says JSON: JSON mode is not forced (OpenAI would 400)', async () => {
    const net = network(() => reply('{}'));
    await provider(net.fetch).generate(
      request({ messages: [{ role: 'user', content: 'How do I check out?' }] }),
    );
    expect(first(net.sent).body).not.toHaveProperty('response_format');
  });
});

describe('structured output', () => {
  it('a valid JSON reply is parsed and validated by the flow, not trusted from the vendor', async () => {
    const good = network(() => reply('{"inScope": true, "answer": "Tap Check out."}'));
    const ok = await generateStructured(provider(good.fetch), MrChatOutputSchema, request());
    expect(ok.ok).toBe(true);

    const wrongShape = network(() => reply('{"answer": 3}'));
    const bad = await generateStructured(provider(wrongShape.fetch), MrChatOutputSchema, request());
    expect(bad).toMatchObject({ ok: false, reason: 'schema_mismatch' });
  });

  it('a length-limited reply is TRUNCATED, logged output_truncated, not schema_invalid', async () => {
    const net = network(() => reply('{"inScope": true, "ans', { finish_reason: 'length' }));
    const result = await generateStructured(provider(net.fetch), MrChatOutputSchema, request());
    expect(result).toMatchObject({ ok: false, reason: 'truncated' });
    expect(invalidOutput('truncated').flags).toEqual(['output_truncated']);
  });
});

describe('refusal', () => {
  it('message.refusal is REFUSED, read from the vendor field, and logged model_refused', async () => {
    const net = network(() => reply(null, { refusal: 'I can’t help with that.' }));
    const raw = await provider(net.fetch).generate(request());
    expect(raw.refused).toBe(true);
    const result = await generateStructured(provider(net.fetch), MrChatOutputSchema, request());
    expect(result).toMatchObject({ ok: false, reason: 'refused' });
  });

  it('finish_reason content_filter is REFUSED too', async () => {
    const net = network(() => reply('', { finish_reason: 'content_filter' }));
    expect((await provider(net.fetch).generate(request())).refused).toBe(true);
  });
});

describe('timeout', () => {
  it('the abort signal reaches fetch, and the flow’s timeout aborts it', async () => {
    let seen: AbortSignal | undefined;
    const fetch = ((_url: string, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    }) as unknown as typeof globalThis.fetch;
    const p = provider(fetch);
    const failure = await withTimeout(20, (signal) => p.generate(request({}, signal))).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(ProviderTimeoutError);
    expect(seen?.aborted).toBe(true);
    expect(providerFailure(failure)).toEqual({
      flags: ['provider_timeout'],
      errorCode: 'provider_timeout',
    });
  });
});

describe('malformed response and HTTP errors', () => {
  it('a body that is not JSON, or has no message, is ProviderError(malformed_response)', async () => {
    for (const body of [
      '<html>gateway</html>',
      '{"choices": []}',
      '{"choices":[{"message":{}}]}',
    ]) {
      const net = network(() => new Response(body, { status: 200 }));
      const e = await provider(net.fetch)
        .generate(request())
        .catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ProviderError);
      expect(providerFailure(e).errorCode).toBe('provider_malformed_response');
    }
  });

  it('an HTTP error is the vendor’s CODE, never its message', async () => {
    const cases: [number, unknown, string][] = [
      [
        401,
        { error: { message: `Incorrect API key provided: ${KEY}`, code: 'invalid_api_key' } },
        'provider_invalid_api_key',
      ],
      [
        429,
        { error: { message: 'Slow down', type: 'rate_limit_exceeded' } },
        'provider_rate_limit_exceeded',
      ],
      [500, 'not json', 'provider_http_500'],
    ];
    for (const [status, body, code] of cases) {
      const net = network(
        () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
      );
      const e = (await provider(net.fetch)
        .generate(request())
        .catch((x: unknown) => x)) as Error;
      expect(providerFailure(e)).toEqual({ flags: ['provider_error'], errorCode: code });
      expect(e.message).not.toContain(KEY);
      expect(e.message).not.toContain('Slow down');
    }
  });

  it('a network failure is a plain provider_error that carries nothing from the request', async () => {
    const fetch = (() =>
      Promise.reject(
        new Error(`connect failed with ${KEY}`),
      )) as unknown as typeof globalThis.fetch;
    const e = (await provider(fetch)
      .generate(request())
      .catch((x: unknown) => x)) as Error;
    expect(providerFailure(e).errorCode).toBe('provider_error');
    expect(e.message).not.toContain(KEY);
  });
});

describe('token usage', () => {
  it('reads prompt and completion tokens; absent usage is zero, not a crash', async () => {
    const counted = await provider(network(() => reply('{}')).fetch).generate(request());
    expect(counted.usage).toEqual({ inputTokens: 31, outputTokens: 12 });
    const none = await provider(network(() => reply('{}', { usage: null })).fetch).generate(
      request(),
    );
    expect(none.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});

describe('no secret in logs', () => {
  it('nothing the adapter does writes the key to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    try {
      await provider(network(() => reply('{}')).fetch).generate(request());
      await provider(network(() => new Response('{}', { status: 401 })).fetch)
        .generate(request())
        .catch(() => undefined);
      for (const spy of spies) {
        for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(KEY);
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The flows on top of the adapter. These rules live in `@fieldforce/core`, not in the adapter; the
// point is that they hold, unchanged, with OpenAI underneath.
// ---------------------------------------------------------------------------------------------

const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const CHUNK_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '77777777-7777-4777-8777-777777777777';

interface Calls {
  list: { fn: string; args: Record<string, unknown> }[];
}

const begun = (feature: string, outputSchemaName: string) => ({
  requestId: REQUEST_ID,
  feature,
  startedAt: '2026-10-09T10:00:00+00:00',
  promptVersionId: '44444444-4444-4444-8444-444444444444',
  promptVersionNumber: 1,
  systemPrompt: 'The APPROVED prompt.',
  outputSchemaName,
  modelConfig: { temperature: 0, maxTokens: 400 },
  requestsUsedToday: 1,
  dailyLimit: 50,
  allowanceWarning: false,
  allowanceResetsAt: '2026-10-09T18:30:00+00:00',
});

const productQaRpc = (calls: Calls): ControlPlaneRpc => ({
  call: (fn, args) => {
    calls.list.push({ fn, args: { ...args } });
    if (fn === 'ai_begin_request')
      return Promise.resolve(begun('product_qa', PRODUCT_QA_OUTPUT_SCHEMA_NAME));
    if (fn === 'search_approved_knowledge')
      return Promise.resolve({
        status: 'found',
        searchedOn: '2026-10-09',
        results: [
          {
            chunkId: CHUNK_ID,
            documentId: '55555555-5555-4555-8555-555555555555',
            documentTitle: 'Benchmarol label',
            documentType: 'product_label',
            documentVersionId: '22222222-2222-4222-8222-222222222222',
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
      });
    if (fn === 'ai_gateway_complete_request') return Promise.resolve({ requestId: REQUEST_ID });
    return Promise.reject(new Error(`unexpected rpc ${fn}`));
  },
});

const completion = (calls: Calls) =>
  calls.list.filter((c) => c.fn === 'ai_gateway_complete_request').at(-1)?.args ?? {};

describe('Q&A — approved sources only, with OpenAI underneath', () => {
  it('the model sees the approved prompt and chunk; a cited answer is returned and AUDITED', async () => {
    const calls: Calls = { list: [] };
    const net = network(() =>
      reply(JSON.stringify({ supported: true, answer: 'Below 25 °C.', citedChunkIds: [CHUNK_ID] })),
    );
    const rpc = productQaRpc(calls);
    const result = await answerProductQuestion({
      rpc,
      writer: rpc,
      provider: provider(net.fetch, OPENAI_MODEL.sonnet),
      question: BENCHMARK_MATCHING_QUESTION,
      marketId: null,
      productId: null,
    });

    expect(result.kind).toBe('answered');
    const prompt = JSON.stringify(first(net.sent).body['messages']);
    expect(prompt).toContain('The APPROVED prompt.');
    expect(prompt).toContain('Store Benchmarol tablets below 25 degrees.');
    // The audit row: vendor, model, tokens. Latency is the database's (`ai_gateway_complete_request`
    // computes latency_ms from the row's started_at), so the gateway cannot misreport it.
    expect(completion(calls)).toMatchObject({
      p_status: 'completed',
      p_model_provider: 'openai',
      p_model_name: 'gpt-4.1-2025-04-14',
      p_input_tokens: 31,
      p_output_tokens: 12,
      p_knowledge_version_ids: ['22222222-2222-4222-8222-222222222222'],
    });
    expect(JSON.stringify(calls.list)).not.toContain(KEY);
  });

  it('an answer citing a chunk it was NOT given is refused, not shown', async () => {
    const calls: Calls = { list: [] };
    const net = network(() =>
      reply(
        JSON.stringify({
          supported: true,
          answer: 'It cures migraine.',
          citedChunkIds: ['99999999-9999-4999-8999-999999999999'],
        }),
      ),
    );
    const rpc = productQaRpc(calls);
    const result = await answerProductQuestion({
      rpc,
      writer: rpc,
      provider: provider(net.fetch),
      question: BENCHMARK_MATCHING_QUESTION,
      marketId: null,
      productId: null,
    });
    expect(result.kind).not.toBe('answered');
  });

  it('patient data: a patient-specific question NEVER reaches OpenAI', async () => {
    const calls: Calls = { list: [] };
    const net = network(() => reply('{}'));
    const rpc = productQaRpc(calls);
    const result = await answerProductQuestion({
      rpc,
      writer: rpc,
      provider: provider(net.fetch),
      question: 'What dose should my patient Ramesh Kumar, age 54, take?',
      marketId: null,
      productId: null,
    });
    expect(result).toMatchObject({
      kind: 'patient_specific',
      message: PATIENT_SPECIFIC_REFUSAL_MESSAGE,
    });
    expect(net.sent).toHaveLength(0);
    expect(completion(calls)).toMatchObject({ p_status: 'blocked' });
  });
});

const simRpc = (calls: Calls, feature: 'ai_doctor' | 'ai_coach', sessionRefusal?: string) => ({
  call: (fn: string, args: Record<string, unknown>) => {
    calls.list.push({ fn, args: { ...args } });
    if (fn === 'sim_session_context') {
      if (sessionRefusal !== undefined) {
        const e = new Error('not your practice session') as Error & { code?: string };
        e.code = sessionRefusal;
        return Promise.reject(e);
      }
      return Promise.resolve({
        sessionId: SESSION_ID,
        state: feature === 'ai_coach' ? 'ended' : 'open',
        personaBrief: 'A FICTIONAL busy urologist.',
        personaStance: 'skeptical',
        objective: 'Explain storage',
        objection: 'No room in my fridge',
        turns: [{ turnIndex: 1, role: 'rep', text: 'It keeps below 25 degrees.' }],
      });
    }
    if (fn === 'ai_begin_request')
      return Promise.resolve(
        begun(
          feature,
          feature === 'ai_doctor' ? SIM_DOCTOR_TURN_OUTPUT_SCHEMA_NAME : 'SimCoachOutputSchema',
        ),
      );
    if (fn === 'sim_coach_module_candidates') return Promise.resolve([]);
    if (fn === 'record_sim_turn') return Promise.resolve({ turnCount: 2 });
    if (fn === 'ai_gateway_complete_request') return Promise.resolve({ requestId: REQUEST_ID });
    return Promise.reject(new Error(`unexpected rpc ${fn}`));
  },
});

describe('AI Doctor and coaching — practice only, with OpenAI underneath', () => {
  it('AI Doctor: the model is given the STORED fictional persona, and the turn is stored', async () => {
    const calls: Calls = { list: [] };
    const net = network(() =>
      reply('{"reply": "Why should I care?", "objectionAddressed": false}'),
    );
    const rpc = simRpc(calls, 'ai_doctor');
    const result = await takeDoctorTurn({
      rpc,
      writer: rpc,
      provider: provider(net.fetch, OPENAI_MODEL.sonnet),
      sessionId: SESSION_ID,
      repText: 'It keeps at room temperature.',
    });
    expect(result.kind).toBe('replied');
    expect(JSON.stringify(first(net.sent).body['messages'])).toContain(
      'A FICTIONAL busy urologist.',
    );
    expect(completion(calls)).toMatchObject({ p_status: 'completed', p_model_provider: 'openai' });
  });

  it('AI Doctor: no practice session of the rep’s, no model call at all', async () => {
    const calls: Calls = { list: [] };
    const net = network(() => reply('{}'));
    const rpc = simRpc(calls, 'ai_doctor', '42501');
    await expect(
      takeDoctorTurn({
        rpc,
        writer: rpc,
        provider: provider(net.fetch),
        sessionId: SESSION_ID,
        repText: 'Hello doctor.',
      }),
    ).rejects.toMatchObject({ code: '42501' });
    expect(net.sent).toHaveLength(0);
  });

  it('AI Doctor: a patient’s details in the rep’s turn never reach OpenAI', async () => {
    const calls: Calls = { list: [] };
    const net = network(() => reply('{}'));
    const rpc = simRpc(calls, 'ai_doctor');
    const result = await takeDoctorTurn({
      rpc,
      writer: rpc,
      provider: provider(net.fetch),
      sessionId: SESSION_ID,
      repText: 'My patient Ramesh Kumar, age 54, has kidney stones. What dose?',
    });
    expect(result.kind).toBe('patient_specific');
    expect(net.sent).toHaveLength(0);
  });

  it('coaching: no practice session of the rep’s, no model call at all', async () => {
    const calls: Calls = { list: [] };
    const net = network(() => reply('{}'));
    const rpc = simRpc(calls, 'ai_coach', '42501');
    await expect(
      analyseSimSession({ rpc, writer: rpc, provider: provider(net.fetch), sessionId: SESSION_ID }),
    ).rejects.toMatchObject({ code: '42501' });
    expect(net.sent).toHaveLength(0);
  });

  it('coaching: only the STORED practice conversation is sent to the model', async () => {
    const calls: Calls = { list: [] };
    const net = network(() => reply('not json'));
    const rpc = simRpc(calls, 'ai_coach');
    await analyseSimSession({
      rpc,
      writer: rpc,
      provider: provider(net.fetch, OPENAI_MODEL.sonnet),
      sessionId: SESSION_ID,
    });
    expect(net.sent).toHaveLength(1);
    expect(JSON.stringify(first(net.sent).body['messages'])).toContain(
      'It keeps below 25 degrees.',
    );
    // An unusable reply is logged as such and nothing is stored.
    expect(calls.list.some((c) => c.fn === 'record_sim_coach_analysis')).toBe(false);
    expect(completion(calls)).toMatchObject({ p_status: 'failed', p_model_provider: 'openai' });
  });
});
