import { describe, expect, it } from 'vitest';
import type { LlmGenerateRequest } from '@fieldforce/core';
import {
  INDIA_PROFILES,
  createBedrockProvider,
} from '../supabase/functions/_shared/bedrock-provider.ts';
import { bedrockConverse } from '../supabase/functions/_shared/bedrock-client.ts';
import { modelAccessGate, readCredential } from './live-credential.js';

/**
 * W1-V A5 — the LIVE Bedrock calls, gated so they SKIP with a stated reason rather than fail.
 *
 * The gate, in order:
 *   1. no credential file (`services/api/supabase/functions/.env`, git-ignored) → skip: "no credential";
 *      this is every CI run, by design — CI never holds the key;
 *   2. a credential, but one minimal probe call is refused (`AccessDeniedException`,
 *      `ValidationException`) → skip: "model access not granted", naming the vendor's error;
 *   3. the probe answers → the live tests run.
 *
 * The reason is the title of the first test, so every run SAYS why it skipped. The credential is
 * read into this process only; it is never printed, and only the vendor's error NAME is reported.
 */

/** Unreachable: the live tests run only when the gate built a client. */
const never = (): never => {
  throw new Error('the gate was ready but built no client');
};

const request = (text: string, signal = AbortSignal.timeout(30_000)): LlmGenerateRequest => ({
  messages: [
    { role: 'system', content: 'Reply with JSON only: {"ok": true}.' },
    { role: 'user', content: text },
  ],
  modelConfig: { temperature: 0, maxTokens: 20 },
  json: true,
  signal,
});

const gate = await modelAccessGate();

describe('W1-V A5 — live Bedrock, gated', () => {
  it(`gate: ${gate.ready ? 'READY' : `SKIPPING — ${gate.reason}`}`, () => {
    expect(gate.reason.length).toBeGreaterThan(0);
  });

  describe.skipIf(!gate.ready)('the two India profiles answer for real', () => {
    const credential = readCredential();
    const converse = gate.ready
      ? bedrockConverse({
          accessKeyId: credential?.accessKeyId,
          secretAccessKey: credential?.secretAccessKey,
        })
      : undefined;

    for (const [name, profileId] of Object.entries(INDIA_PROFILES)) {
      it(`${name}: ${profileId} answers, with real token counts and its own model id`, async () => {
        const started = Date.now();
        const result = await createBedrockProvider({
          region: credential?.region,
          profileId,
          converse: converse ?? never(),
        }).generate(request('Return the JSON now.'));
        const latencyMs = Date.now() - started;
        expect(result.text.length).toBeGreaterThan(0);
        expect(result.usage.inputTokens).toBeGreaterThan(0);
        expect(result.usage.outputTokens).toBeGreaterThan(0);
        expect(result).toMatchObject({ provider: 'bedrock', model: profileId });
        expect(latencyMs).toBeLessThan(30_000);
      }, 35_000);
    }
  });
});
