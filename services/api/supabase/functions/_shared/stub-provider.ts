import type { LlmGenerateRequest, LlmProvider, LlmResult } from './core.ts';

/**
 * W1-B C2 — the ONE adapter that ships, and it is a stub that says so.
 *
 * **`#5` / `D2` is open (`C31`): no vendor is chosen, and this repository still names none.** The
 * brief for this session asked for an adapter that is *explicit about being a stub and can never be
 * enabled outside a local target*. Both halves are load-bearing:
 *
 * * **Explicit**, because a stub that returns plausible text is the most dangerous object in an AI
 *   codebase. Someone demonstrates the feature, it answers, and nobody discovers there was no model
 *   until a rep repeats the answer to a doctor. So every answer this thing produces is **visibly
 *   not an answer**: it sets `supported: false`, which `answerProductQuestion` turns into the
 *   "approved information not available" sentence, and it names itself `stub` in the request log's
 *   `model_provider` column so the audit trail records that no model ran.
 * * **Cannot be enabled outside a local target**, because the alternative is a deployment serving
 *   refusals that look like a model declining. It THROWS on construction rather than returning a
 *   quiet `null`, for the same reason `loadAppConfig` throws on `APP_RECORDING_ENABLED` against a
 *   deployment (`packages/core/src/shared/config.ts:79-92`): silently ignoring the request leaves
 *   whoever set it believing the feature is on.
 *
 * **The real adapter is one file next to this one**, added the day `#5` is answered. It implements
 * the same `LlmProvider` interface, and nothing in `answerProductQuestion` changes.
 */

export const stubProviderRefusal =
  'No AI provider is configured. Decision #5 (which provider, and may data leave India) is open, ' +
  'so this build has no model adapter. The stub provider runs only against a local Supabase.';

/**
 * The same host set `packages/core/src/shared/config.ts` uses and for the same reason: a rule about
 * "is this a deployment" must be ONE rule. Duplicated here rather than imported because that module
 * pulls in zod and the app config schema, which an Edge Function has no use for — the list is three
 * strings and the comment is the thing that keeps them aligned.
 */
const LOCAL_HOSTS: readonly string[] = ['127.0.0.1', 'localhost', 'host.docker.internal', 'kong'];

export const isLocalTarget = (rawUrl: string | undefined): boolean => {
  if (rawUrl === undefined || rawUrl === '') return false;
  try {
    return LOCAL_HOSTS.includes(new URL(rawUrl).hostname);
  } catch {
    // An unparseable URL is NOT treated as local. Erring toward denial is the standing rule
    // (`constraints.md`: "Err toward denial when evidence is missing").
    return false;
  }
};

/** What the stub claims to be, in the audit trail. Asserted by a test, so it cannot drift. */
export const STUB_PROVIDER_NAME = 'stub';
export const STUB_MODEL_NAME = 'no-model-configured';

/**
 * Counts calls, so a test can prove the guardrail refused BEFORE any provider call (W1-B C4).
 * Module-scoped on purpose: the assertion that matters is "the provider was never reached", and
 * that can only be made by something the provider itself increments.
 */
let callCount = 0;
export const stubProviderCallCount = (): number => callCount;
export const resetStubProviderCallCount = (): void => {
  callCount = 0;
};

export const createStubProvider = (): LlmProvider => {
  if (!isLocalTarget(Deno.env.get('SUPABASE_URL'))) {
    throw new Error(stubProviderRefusal);
  }
  return {
    generate: (request: LlmGenerateRequest): Promise<LlmResult> => {
      callCount += 1;
      // `supported: false` is the whole design. It is the one reply that cannot be mistaken for an
      // answer: `answerProductQuestion` maps it to KNOWLEDGE_NOT_AVAILABLE_MESSAGE, verbatim.
      const text = JSON.stringify({ supported: false, answer: '', citedChunkIds: [] });
      return Promise.resolve({
        text,
        usage: {
          // Honest, cheap token counts so the cost columns are exercised end to end rather than
          // left null -- W1-B C3 asks that the result be audited WITH its cost fields.
          inputTokens: request.messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0),
          outputTokens: Math.ceil(text.length / 4),
        },
        provider: STUB_PROVIDER_NAME,
        model: STUB_MODEL_NAME,
      });
    },
  };
};
