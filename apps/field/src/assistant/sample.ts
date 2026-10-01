import type { ChatRequestBody, GatewayResponse } from './contract';

/**
 * FE-D15 — the assistant's SAMPLE fixture. Added, not changed from anything existing.
 *
 * **This is not the assistant.** No request leaves the phone. Each reply below is shaped like
 * the gateway's answer on `worktree-ai-platform-phase-a` (see `contract.ts`), so the screen runs
 * through the same `outcomeFromGateway` it will use against the real gateway once FE-CR-7 lands.
 * The screen labels every sample reply "Sample data", and the one "answer" here says it is a
 * sample in its first words.
 *
 * It lives in the app rather than `services/mock` because that service is outside this work's
 * boundary. It is only reachable when `EXPO_PUBLIC_ASSISTANT_SAMPLE=true` (`src/features.ts`).
 *
 * A word in the rep's message picks the state, so each state can be shown on purpose:
 */
export const SAMPLE_ANSWER =
  'Sample answer. In the real assistant, the reply to your question appears here. No AI model is connected to this build.';

const OUT_OF_SCOPE =
  'That looks like a product question. Use Product Q&A, which answers only from your company’s approved material and shows you where each answer came from.';

/** The sample's figures for FE-CR-6's proposed `allowance`. Sample data, labelled on screen. */
const SAMPLE_RESETS_AT = '2026-10-01T18:30:00.000Z';

export const SAMPLE_SCRIPT: readonly { readonly ask: string; readonly shows: string }[] = [
  { ask: 'How do I end my day?', shows: 'a sample answer' },
  { ask: 'What is the dose of this product?', shows: 'a refusal (product question)' },
  { ask: 'warn: how do I add a doctor?', shows: 'an answer with the 80% warning' },
  { ask: 'limit', shows: 'the daily limit reached' },
  { ask: 'unavailable', shows: 'no model connected: "not available yet"' },
  { ask: 'offline', shows: 'no connection' },
  { ask: 'error', shows: 'a server error, with retry' },
];

const has = (message: string, word: string): boolean => message.toLowerCase().includes(word);

export const sampleTransport = (request: ChatRequestBody): Promise<GatewayResponse> => {
  const message = request.message;
  if (has(message, 'offline')) {
    return Promise.reject(new TypeError('Network request failed'));
  }
  if (has(message, 'unavailable')) {
    return Promise.resolve({
      status: 503,
      body: { code: 'no_provider', message: 'No AI provider is configured.' },
    });
  }
  if (has(message, 'limit')) {
    return Promise.resolve({
      status: 429,
      body: { code: '45012', message: 'ai daily limit reached', resetsAt: SAMPLE_RESETS_AT },
    });
  }
  if (has(message, 'error')) {
    return Promise.resolve({ status: 500, body: { code: 'gateway_error' } });
  }
  if (has(message, 'product') || has(message, 'dose')) {
    return Promise.resolve({
      status: 200,
      body: { kind: 'out_of_scope', requestId: 'sample', message: OUT_OF_SCOPE },
    });
  }
  return Promise.resolve({
    status: 200,
    body: {
      kind: 'answered',
      requestId: 'sample',
      answer: SAMPLE_ANSWER,
      ...(has(message, 'warn')
        ? {
            allowance: {
              warning: true,
              requestsUsedToday: 80,
              dailyLimit: 100,
              resetsAt: SAMPLE_RESETS_AT,
            },
          }
        : {}),
    },
  });
};
