/**
 * `BE-W178` / `BE-C79` — the OpenAI adapter. Implements `LlmProvider`
 * (`packages/core/src/field/gateway/providers.ts`); nothing in the flows changes, so every contract,
 * guardrail, approved-content and audit rule that holds for the stub and for Bedrock holds here: the
 * flows decide, this file only carries messages to the vendor and reads its answer.
 *
 * **IMPLEMENTED, NOT LIVE VERIFIED.** Every branch below is proved against a mocked `fetch`
 * (`services/api/tests/openai-provider.spec.ts`); no call has been made to OpenAI from this code.
 *
 * ## The key
 *
 * `OPENAI_API_KEY` is an Edge Function SECRET, read by the gateway and handed in here. It is used in
 * exactly one place -- the `Authorization` header of the request -- and is never logged, returned,
 * put in an error, or sent anywhere but `OPENAI_CHAT_URL`. It never reaches the phone, the console,
 * an `EXPO_PUBLIC_*`/`NEXT_PUBLIC_*` value or the repository.
 *
 * ## What it reports (the same rules as Bedrock: `BE-C64`, `BE-C67`)
 *
 * * A model that DECLINES -- `message.refusal`, or `finish_reason: content_filter` -- is
 *   `refused: true`, read from the vendor's fields, never guessed from the text.
 * * An answer cut off at the length limit (`finish_reason: length`) is `truncated: true`.
 * * An HTTP failure is `ProviderError(<the vendor's error code or type>)` -- a bounded identifier,
 *   never the message, which can echo the request (§52). No code: `http_<status>`.
 * * A body that is not the expected shape is `ProviderError('malformed_response')`.
 * * The abort signal reaches `fetch`, so a timed-out request stops being billed when the rep is told.
 *
 * ## What it does NOT do
 *
 * It does not add to, reword or wrap the approved prompt. JSON mode (`response_format: json_object`)
 * is asked for only when the flow wants JSON AND the messages already say "JSON" (OpenAI refuses JSON
 * mode otherwise); either way the flow validates the reply itself (§38).
 */
import { ProviderError } from './core.ts';
import type { LlmGenerateRequest, LlmProvider, LlmResult } from './core.ts';

export const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

/** A deployment-shaped refusal: the adapter will not exist in this configuration. */
export class OpenAiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenAiConfigurationError';
  }
}

/** The subset of the Chat Completions response this adapter reads. */
interface ChatCompletion {
  readonly model?: unknown;
  readonly choices?: readonly {
    readonly finish_reason?: unknown;
    readonly message?: { readonly content?: unknown; readonly refusal?: unknown };
  }[];
  readonly usage?: { readonly prompt_tokens?: unknown; readonly completion_tokens?: unknown };
}

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** The vendor's error code or type, if it is a short identifier; never its message. */
const vendorCode = (body: unknown, status: number): string => {
  const error = (body as { error?: { code?: unknown; type?: unknown } } | null)?.error;
  for (const candidate of [error?.code, error?.type]) {
    if (typeof candidate === 'string' && /^[A-Za-z0-9_.-]{1,48}$/u.test(candidate))
      return candidate;
  }
  return `http_${String(status)}`;
};

export const createOpenAiProvider = (config: {
  readonly apiKey: string | undefined;
  readonly model: string;
  /** Injected for tests; the gateway passes the runtime's own `fetch`. */
  readonly fetch?: typeof fetch;
}): LlmProvider => {
  const apiKey = config.apiKey?.trim() ?? '';
  if (apiKey === '') {
    throw new OpenAiConfigurationError('no OPENAI_API_KEY is configured for the OpenAI adapter');
  }
  if (config.model.trim() === '') {
    throw new OpenAiConfigurationError('the OpenAI adapter needs a model');
  }
  const send = config.fetch ?? fetch;

  return {
    generate: async (request: LlmGenerateRequest): Promise<LlmResult> => {
      const temperature = request.modelConfig['temperature'];
      const maxTokens = request.modelConfig['maxTokens'];
      const saysJson = request.messages.some((m) => /json/iu.test(m.content));

      let response: Response;
      try {
        response = await send(OPENAI_CHAT_URL, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: config.model,
            messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
            ...(typeof temperature === 'number' ? { temperature } : {}),
            ...(typeof maxTokens === 'number' ? { max_completion_tokens: maxTokens } : {}),
            ...(request.json && saysJson ? { response_format: { type: 'json_object' } } : {}),
          }),
          signal: request.signal,
        });
      } catch {
        // A network failure or an abort. Nothing from it is passed on: it can carry the URL and more.
        throw new Error('the OpenAI call failed');
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (!response.ok)
        throw new ProviderError(vendorCode(body, response.status), 'the OpenAI call failed');

      const completion = body as ChatCompletion | null;
      const choice = completion?.choices?.[0];
      const content = choice?.message?.content;
      const refusal = choice?.message?.refusal;
      if (choice === undefined || (typeof content !== 'string' && typeof refusal !== 'string')) {
        throw new ProviderError('malformed_response', 'the OpenAI reply had no message');
      }

      const refused = typeof refusal === 'string' || choice.finish_reason === 'content_filter';
      const truncated = choice.finish_reason === 'length';
      return {
        text: typeof content === 'string' ? content : '',
        usage: {
          inputTokens: numberOr(completion?.usage?.prompt_tokens, 0),
          outputTokens: numberOr(completion?.usage?.completion_tokens, 0),
        },
        provider: 'openai',
        model: typeof completion?.model === 'string' ? completion.model : config.model,
        ...(refused ? { refused: true } : {}),
        ...(truncated && !refused ? { truncated: true } : {}),
      };
    },
  };
};
