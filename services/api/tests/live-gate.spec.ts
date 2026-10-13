import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { OPENAI_MODEL } from '@fieldforce/core';
import { OPENAI_CHAT_URL } from '../supabase/functions/_shared/openai-provider.ts';
import {
  OPENAI_MODELS_URL,
  describeProviderValue,
  gateTitle,
  isConfiguredModel,
  liveProviderGate,
  parseFunctionsEnv,
} from './live-credential.js';

/**
 * `BE-W203` — the live gate, proved WITHOUT a key, a network or a database: every vendor answer is a
 * fake `fetch`. `pnpm ai:live` cannot test its own gate (it needs the key it is gating), so the gate's
 * every branch is pinned here, where CI runs it.
 *
 * What matters most is the negative: **no reason ever carries the key**, whatever the vendor says and
 * however the file is broken.
 */

const KEY = 'sk-test-THIS-MUST-NEVER-BE-PRINTED';
const MODELS = [...new Set(Object.values(OPENAI_MODEL))];

interface Call {
  url: string;
  method: string;
  authorization: string | undefined;
  body: Record<string, unknown> | null;
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const completion = (): Response =>
  json(200, {
    model: `${OPENAI_MODEL.haiku}-2025-04-14`,
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"ok": true}' } }],
    usage: { prompt_tokens: 12, completion_tokens: 4 },
  });

/** A fake OpenAI. `models` answers each GET; `chat` the one completion. */
const openAi = (
  answer: { models?: (model: string) => Response; chat?: () => Response } = {},
): { fetch: typeof fetch; calls: Call[] } => {
  const calls: Call[] = [];
  const fake = vi.fn((url: string, init?: RequestInit & { body?: string }) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url,
      method: init?.method ?? 'GET',
      authorization: headers['authorization'],
      body: init?.body === undefined ? null : (JSON.parse(init.body) as Record<string, unknown>),
    });
    if (url === OPENAI_CHAT_URL) return Promise.resolve((answer.chat ?? completion)());
    const model = decodeURIComponent(url.slice(OPENAI_MODELS_URL.length + 1));
    return Promise.resolve(
      (answer.models ?? ((m: string) => json(200, { id: m, object: 'model' })))(model),
    );
  });
  return { fetch: fake as unknown as typeof fetch, calls };
};

const live = { AI_PROVIDER: 'openai', OPENAI_API_KEY: KEY };

const expectNoKey = (text: string): void => {
  expect(text).not.toContain(KEY);
  expect(text).not.toContain('sk-');
};

describe('which provider: the same setting the gateway reads', () => {
  it('no .env at all: SKIP, and say what to put in it', async () => {
    const gate = await liveProviderGate(null);
    expect(gate).toMatchObject({ state: 'skip', provider: null });
    expect(gate.reason).toMatch(/AI_PROVIDER=openai and OPENAI_API_KEY/u);
    expect(gateTitle(gate)).toMatch(/^gate: SKIPPING — /u);
  });

  it('AI_PROVIDER unset or unknown: SKIP — the gateway would answer from the stub', async () => {
    for (const env of [{}, { AI_PROVIDER: '' }, { AI_PROVIDER: 'stub' }]) {
      const gate = await liveProviderGate(env);
      expect(gate).toMatchObject({ state: 'skip', provider: null });
      expect(gate.reason).toMatch(/stub/u);
    }
  });

  it('a key glued onto AI_PROVIDER by `echo >>` is NEVER printed', async () => {
    const glued = parseFunctionsEnv(
      `AWS_REGION=ap-south-1\nAI_PROVIDER=openaiOPENAI_API_KEY=${KEY}`,
    );
    const gate = await liveProviderGate(glued);
    expect(gate.state).toBe('skip');
    expectNoKey(gate.reason);
    expect(gate.reason).toMatch(/glued/u);
    expect(describeProviderValue('openai')).toMatch(/openai/u);
  });

  it('AI_PROVIDER=openai with no key: SKIP, naming the missing setting', async () => {
    const net = openAi();
    const gate = await liveProviderGate({ AI_PROVIDER: 'openai', OPENAI_API_KEY: '  ' }, net.fetch);
    expect(gate).toMatchObject({ state: 'skip', provider: 'openai' });
    expect(gate.reason).toMatch(/no OPENAI_API_KEY/u);
    expect(net.calls).toHaveLength(0);
  });

  it('the .env.example placeholder copied as it is: SKIP, and OpenAI is never called', async () => {
    const example = parseFunctionsEnv(
      readFileSync(new URL('../supabase/functions/.env.example', import.meta.url), 'utf8'),
    );
    expect(example['AI_PROVIDER']).toBe('openai');
    const net = openAi();
    const gate = await liveProviderGate(example, net.fetch);
    expect(gate).toMatchObject({ state: 'skip', provider: 'openai' });
    expect(gate.reason).toMatch(/placeholder/u);
    expect(net.calls).toHaveLength(0);
  });

  it('AI_PROVIDER=bedrock with no AWS credential: SKIP, as since W1-V', async () => {
    const gate = await liveProviderGate({ AI_PROVIDER: 'bedrock' });
    expect(gate).toMatchObject({ state: 'skip', provider: 'bedrock' });
    expect(gate.reason).toMatch(/no AWS credential/u);
  });
});

describe('the OpenAI probe', () => {
  it('READY: every configured model looked up (free), then ONE 20-token completion', async () => {
    const net = openAi();
    const gate = await liveProviderGate(live, net.fetch);
    expect(gate).toMatchObject({ state: 'ready', provider: 'openai' });
    expect(gateTitle(gate)).toBe('gate: READY (openai)');
    const gets = net.calls.filter((c) => c.method === 'GET');
    expect(gets.map((c) => c.url)).toEqual(MODELS.map((m) => `${OPENAI_MODELS_URL}/${m}`));
    const posts = net.calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toBe(OPENAI_CHAT_URL);
    expect(posts[0]?.body).toMatchObject({ model: OPENAI_MODEL.haiku, max_completion_tokens: 20 });
    // The key travels in the Authorization header and nowhere else.
    for (const call of net.calls) {
      expect(call.authorization).toBe(`Bearer ${KEY}`);
      expect(call.url).not.toContain(KEY);
      expect(JSON.stringify(call.body)).not.toContain(KEY);
    }
    expectNoKey(gate.reason);
  });

  const refusedBy = async (answer: Parameters<typeof openAi>[0]) => {
    const gate = await liveProviderGate(live, openAi(answer).fetch);
    expect(gate.state).toBe('refused');
    expect(gateTitle(gate)).toMatch(/^gate: REFUSED — /u);
    expectNoKey(gate.reason);
    return gate.reason;
  };

  it('401 invalid_api_key: REFUSED, a bad key — even when the vendor echoes the key back', async () => {
    const reason = await refusedBy({
      models: () =>
        json(401, {
          error: {
            message: `Incorrect API key provided: ${KEY}.`,
            type: 'invalid_request_error',
            code: 'invalid_api_key',
          },
        }),
    });
    expect(reason).toMatch(/HTTP 401 invalid_api_key/u);
    expect(reason).toMatch(/refused the key/u);
  });

  it('404 model_not_found: REFUSED, naming the model the gateway would call', async () => {
    const reason = await refusedBy({
      models: (m) =>
        m === OPENAI_MODEL.sonnet
          ? json(404, {
              error: { message: `The model ${m} does not exist`, code: 'model_not_found' },
            })
          : json(200, { id: m }),
    });
    expect(reason).toContain(`"${OPENAI_MODEL.sonnet}"`);
    expect(reason).toMatch(/HTTP 404 model_not_found/u);
  });

  it('429 insufficient_quota on the completion (the GET passes): REFUSED, no quota', async () => {
    const reason = await refusedBy({
      chat: () =>
        json(429, {
          error: {
            message: 'You exceeded your current quota',
            type: 'insufficient_quota',
            code: 'insufficient_quota',
          },
        }),
    });
    expect(reason).toMatch(/no quota/u);
    expect(reason).toMatch(/insufficient_quota/u);
  });

  it('429 rate_limit_exceeded: REFUSED, rate limited — a different remedy from quota', async () => {
    const reason = await refusedBy({
      chat: () => json(429, { error: { message: 'Slow down', code: 'rate_limit_exceeded' } }),
    });
    expect(reason).toMatch(/rate-limiting/u);
    expect(reason).not.toMatch(/Slow down/u);
  });

  it('the network fails: REFUSED, saying so, carrying nothing from the error', async () => {
    const failing = (() =>
      Promise.reject(new Error(`connect ECONNREFUSED with ${KEY}`))) as unknown as typeof fetch;
    const gate = await liveProviderGate(live, failing);
    expect(gate.state).toBe('refused');
    expect(gate.reason).toMatch(/could not reach api\.openai\.com/u);
    expectNoKey(gate.reason);
  });
});

describe('the model a live row must name', () => {
  it('the configured id, or that id with a dated snapshot — nothing else', () => {
    expect(isConfiguredModel('gpt-4.1', 'gpt-4.1')).toBe(true);
    expect(isConfiguredModel('gpt-4.1-2025-04-14', 'gpt-4.1')).toBe(true);
    expect(isConfiguredModel('gpt-4.1-mini-2025-04-14', 'gpt-4.1')).toBe(false);
    expect(isConfiguredModel('gpt-4.1-mini-2025-04-14', 'gpt-4.1-mini')).toBe(true);
    expect(isConfiguredModel('gpt-4o-2024-08-06', 'gpt-4.1')).toBe(false);
    expect(isConfiguredModel(null, 'gpt-4.1')).toBe(false);
  });
});

describe('the .env is read as functions serve reads it', () => {
  it('CRLF line ends and quoted values', () => {
    expect(parseFunctionsEnv('AI_PROVIDER=openai\r\nOPENAI_API_KEY="abc"\r\n# a note\r\n')).toEqual(
      {
        AI_PROVIDER: 'openai',
        OPENAI_API_KEY: 'abc',
      },
    );
  });
});
