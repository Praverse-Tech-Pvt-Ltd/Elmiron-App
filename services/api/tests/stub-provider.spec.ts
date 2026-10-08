import { afterEach, describe, expect, it } from 'vitest';
import {
  createStubProvider,
  isLocalTarget,
  stubProviderRefusal,
} from '../supabase/functions/_shared/stub-provider.ts';

/**
 * W2-H C (`BE-W166`) — what the stub says for `mr_chat`, and where it is allowed to exist at all.
 *
 * The stub file has only a TYPE import, so it loads here; `Deno.env` is the one runtime thing it
 * touches, and is stood in for per test.
 */
const withSupabaseUrl = (url: string | undefined): void => {
  (globalThis as { Deno?: unknown }).Deno = {
    env: { get: (k: string) => (k === 'SUPABASE_URL' ? url : undefined) },
  };
};
afterEach(() => {
  delete (globalThis as { Deno?: unknown }).Deno;
});

const ask = async (message: string): Promise<Record<string, unknown>> => {
  withSupabaseUrl('http://127.0.0.1:54321');
  const provider = createStubProvider('mr_chat');
  const result = await provider.generate({
    messages: [
      { role: 'system', content: 'You help a rep use the app.' },
      { role: 'user', content: message },
    ],
    modelConfig: {},
  } as never);
  return JSON.parse(result.text) as Record<string, unknown>;
};

describe('W2-H C — the stub’s mr_chat reply', () => {
  it('BY DEFAULT: in scope, and the answer IS the marker — so a local assistant reads "not available", not a refusal', async () => {
    const reply = await ask('How do I end my day?');
    expect(reply['inScope']).toBe(true);
    expect(String(reply['answer'])).toMatch(/^\[PRACTICE STUB/u);
  });

  it('the model’s own "out of scope" is still reachable, on purpose, by directive', async () => {
    expect(await ask('How do I end my day? [STUB:out-of-scope]')).toEqual({
      inScope: false,
      answer: '',
    });
  });

  it('the existing directives are unchanged', async () => {
    expect((await ask('x [STUB:in-scope]'))['inScope']).toBe(true);
    expect(String((await ask('x [STUB:in-scope-clinical]'))['answer'])).toMatch(/400mg/u);
  });
});

describe('W2-H C3 — production cannot move: off a local target the stub refuses to exist', () => {
  it.each(['https://abcdefgh.supabase.co', '', 'not a url'])('SUPABASE_URL %j: refused', (url) => {
    withSupabaseUrl(url);
    expect(() => createStubProvider('mr_chat')).toThrow(stubProviderRefusal);
  });

  it('POSITIVE CONTROL: the local addresses are allowed', () => {
    expect(isLocalTarget('http://127.0.0.1:54321')).toBe(true);
    expect(isLocalTarget('http://localhost:54321')).toBe(true);
    expect(isLocalTarget('https://abcdefgh.supabase.co')).toBe(false);
    expect(isLocalTarget(undefined)).toBe(false);
  });
});
