import { describe, expect, it } from 'vitest';
import { ProviderError, providerFailure } from '@fieldforce/core';
import type { LlmGenerateRequest } from '@fieldforce/core';
import {
  BedrockConfigurationError,
  INDIA_PROFILES,
  createBedrockProvider,
} from '../supabase/functions/_shared/bedrock-provider.ts';
import type { Converse, ConverseInput } from '../supabase/functions/_shared/bedrock-provider.ts';

/**
 * W1-V A — the Bedrock adapter, proved WITHOUT a successful model call (model access is not granted).
 *
 * Everything the adapter decides is decided here, against a fake `Converse`: whether it will exist at
 * all (India only), what it sends, how it reads the vendor's stop reason and errors, and that the
 * abort signal reaches the SDK. The live call is `bedrock-live.spec.ts`, gated on access.
 */

const request = (signal: AbortSignal = new AbortController().signal): LlmGenerateRequest => ({
  messages: [
    { role: 'system', content: 'You are the in-app assistant.' },
    { role: 'user', content: 'How do I check out?' },
  ],
  modelConfig: { temperature: 0 },
  json: true,
  signal,
});

/** A fake vendor that records what it was sent and answers as told. */
const fake = (answer: () => Promise<unknown>) => {
  const sent: { input: ConverseInput; abortSignal: AbortSignal }[] = [];
  const converse: Converse = (input, { abortSignal }) => {
    sent.push({ input, abortSignal });
    return answer() as ReturnType<Converse>;
  };
  return { converse, sent };
};

const ok = (stopReason = 'end_turn') =>
  Promise.resolve({
    output: { message: { content: [{ text: '{"inScope": true, "answer": "Tap Day end."}' }] } },
    stopReason,
    usage: { inputTokens: 31, outputTokens: 12 },
  });

describe('A2 — it refuses to exist for anything that is not India', () => {
  it('a region other than ap-south-1 is REFUSED at construction', () => {
    for (const region of ['us-east-1', 'ap-south-2', undefined]) {
      expect(() =>
        createBedrockProvider({
          region,
          profileId: INDIA_PROFILES.sonnet,
          converse: fake(ok).converse,
        }),
      ).toThrow(BedrockConfigurationError);
    }
  });

  it('a profile that is not an India one is REFUSED at construction — including ones that route abroad', () => {
    for (const profileId of [
      'global.anthropic.claude-sonnet-5',
      'apac.anthropic.claude-sonnet-4-20250514-v1:0',
      'anthropic.claude-sonnet-5',
      'in.anthropic.claude-opus-5',
    ]) {
      expect(() =>
        createBedrockProvider({ region: 'ap-south-1', profileId, converse: fake(ok).converse }),
      ).toThrow(BedrockConfigurationError);
    }
  });

  it('POSITIVE CONTROL: both India profiles in ap-south-1 construct, and the call goes to that profile', async () => {
    for (const profileId of Object.values(INDIA_PROFILES)) {
      const vendor = fake(ok);
      const provider = createBedrockProvider({
        region: 'ap-south-1',
        profileId,
        converse: vendor.converse,
      });
      const result = await provider.generate(request());
      expect(vendor.sent[0]?.input.modelId).toBe(profileId);
      expect(result).toMatchObject({
        provider: 'bedrock',
        model: profileId,
        usage: { inputTokens: 31, outputTokens: 12 },
      });
    }
  });
});

describe('A3 — what the vendor reports is mapped, and its message never leaves', () => {
  const sonnet = (converse: Converse) =>
    createBedrockProvider({ region: 'ap-south-1', profileId: INDIA_PROFILES.sonnet, converse });

  it('a refusal STOP REASON becomes refused: true', async () => {
    const result = await sonnet(fake(() => ok('content_filtered')).converse).generate(request());
    expect(result.refused).toBe(true);
  });

  it('an ordinary stop reason is NOT a refusal', async () => {
    const result = await sonnet(fake(() => ok('end_turn')).converse).generate(request());
    expect(result.refused).toBeUndefined();
  });

  it('a NAMED vendor error keeps its name and never its message', async () => {
    const vendorError = Object.assign(new Error('Rate exceeded for prompt: how do I check out'), {
      name: 'ThrottlingException',
      $metadata: { httpStatusCode: 429 },
    });
    const error = await sonnet(fake(() => Promise.reject(vendorError)).converse)
      .generate(request())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(providerFailure(error)).toEqual({
      flags: ['provider_error'],
      errorCode: 'provider_throttling_exception',
    });
    expect((error as Error).message).not.toContain('check out');
  });

  it('an UNNAMED failure stays the coarse provider_error it always was', async () => {
    const error = await sonnet(fake(() => Promise.reject(new Error('socket hang up'))).converse)
      .generate(request())
      .catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(ProviderError);
    expect(providerFailure(error)).toEqual({
      flags: ['provider_error'],
      errorCode: 'provider_error',
    });
  });
});

describe('A4 — the abort signal reaches the SDK call', () => {
  it("the request's signal is the one the vendor call receives, and aborting it reaches the call", async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const converse: Converse = (_input, { abortSignal }) => {
      seen = abortSignal;
      return new Promise((_resolve, reject) => {
        abortSignal.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    };
    const pending = createBedrockProvider({
      region: 'ap-south-1',
      profileId: INDIA_PROFILES.haiku,
      converse,
    })
      .generate(request(controller.signal))
      .catch((e: unknown) => e);
    controller.abort();
    await pending;
    expect(seen).toBe(controller.signal);
    expect(seen?.aborted).toBe(true);
  });
});
