/**
 * W1-V A — the Bedrock adapter: Claude on Amazon Bedrock, India only. Implements `LlmProvider`
 * (`packages/core/src/field/gateway/providers.ts`); nothing in `packages/core` changes.
 *
 * **Everything here is testable without a successful model call**, because the SDK is not imported
 * here: the one thing that talks to AWS is the injected `converse` function, built in
 * `bedrock-client.ts` from the approved SDK. Tests inject a fake one; the gateway injects the real one.
 *
 * ## Region and profile are ASSERTED, not configured (`KEY-DAY-CHECKLIST.md` D1 §3)
 *
 * Mirroring how the stub refuses to exist outside a local target, this refuses to exist for anything
 * that is not India: the region must be `ap-south-1`, and the profile must be one of the two India
 * inference profiles — read from the service on 2 October (`docs/operator-inputs.md`, Q-1, "Measured
 * 2 October"), both routing only to `ap-south-1` and `ap-south-2`. The same account can see `apac.*` and
 * `global.*` profiles that route OUTSIDE India; a deployment configured with one of those would send a
 * doctor's words out of the country, and the only defence that cannot be misconfigured is refusing
 * to construct.
 *
 * ## What it reports (`BE-C64`)
 *
 * * A model that DECLINES is reported as `refused: true` from the vendor's own stop reason — never
 *   guessed from the text — so the log says `model_refused`, not `schema_invalid`.
 * * An answer cut off at a length limit is reported as `truncated: true`, the same way (`BE-C67`), so
 *   the log says `output_truncated`. Every stop reason's meaning: `STOP_REASON_MEANING`.
 * * A failure the vendor NAMES is thrown as `ProviderError(name)` — the name, never the message, which
 *   can echo the request (§52). A failure with no vendor name stays a plain `Error`, which the flows
 *   log as the coarse `provider_error` it always was.
 * * The abort signal reaches the SDK call, so a timed-out request stops being billed when the rep is
 *   told it failed.
 */
import { ProviderError } from './core.ts';
import type { LlmGenerateRequest, LlmProvider, LlmResult } from './core.ts';
// TYPE ONLY: erased at runtime, so this file still never loads the SDK (only `bedrock-client.ts` does).
import type { StopReason } from '@aws-sdk/client-bedrock-runtime';

/** The one region this adapter will run in. */
export const BEDROCK_REGION = 'ap-south-1';

/**
 * The India inference profiles, as the service named them (2 October). Both route only to `ap-south-1`
 * and `ap-south-2`. A profile not in this list is refused, whatever its prefix.
 */
export const INDIA_PROFILES = {
  sonnet: 'in.anthropic.claude-sonnet-5',
  haiku: 'in.anthropic.claude-haiku-4-5-20251001-v1:0',
} as const;
export type IndiaProfileId = (typeof INDIA_PROFILES)[keyof typeof INDIA_PROFILES];

/**
 * W1-W C (`BE-C67`). What every stop reason the vendor can return MEANS here — checked against the
 * SDK's own `StopReason` enum (`@aws-sdk/client-bedrock-runtime` 3.1144.0, `dist-types/models/enums.d.ts`),
 * not against documentation. Keyed on that type, so an SDK that adds a stop reason fails to typecheck
 * until somebody decides what it means.
 *
 * * `refused` — the model or a filter DECLINED (`BE-C64`): logged `model_refused`.
 * * `truncated` — the answer stopped at a LENGTH LIMIT (`BE-C67`): logged `output_truncated`.
 * * `complete` — handed to the flow's own validation, which is the authority on whether it is usable
 *   (§38). `stop_sequence`, `tool_use` and `malformed_tool_use` cannot occur — this adapter sends no
 *   stop sequences and no tools — and `malformed_model_output` is the vendor saying what validation
 *   will then find; all three reach the log as `schema_invalid` if the text does not validate.
 *
 * W1-V's set also held `refusal`. **It is not a Bedrock stop reason** — it was taken from
 * documentation, not from this list — so it is gone.
 */
export const STOP_REASON_MEANING: Readonly<
  Record<StopReason, 'complete' | 'refused' | 'truncated'>
> = {
  end_turn: 'complete',
  stop_sequence: 'complete',
  tool_use: 'complete',
  malformed_tool_use: 'complete',
  malformed_model_output: 'complete',
  content_filtered: 'refused',
  guardrail_intervened: 'refused',
  max_tokens: 'truncated',
  model_context_window_exceeded: 'truncated',
};

/** A stop reason this SDK does not list is read as `complete`: validation still decides. */
const meaningOf = (stopReason: string | undefined): 'complete' | 'refused' | 'truncated' =>
  stopReason !== undefined && Object.hasOwn(STOP_REASON_MEANING, stopReason)
    ? STOP_REASON_MEANING[stopReason as StopReason]
    : 'complete';

/** The subset of the Converse request this adapter sends. */
export interface ConverseInput {
  readonly modelId: string;
  readonly system?: readonly { readonly text: string }[];
  readonly messages: readonly {
    readonly role: 'user';
    readonly content: readonly { readonly text: string }[];
  }[];
  readonly inferenceConfig?: { readonly temperature?: number; readonly maxTokens?: number };
}

/** The subset of the Converse response this adapter reads. */
export interface ConverseOutput {
  readonly output?:
    | {
        readonly message?:
          | { readonly content?: readonly { readonly text?: string | undefined }[] | undefined }
          | undefined;
      }
    | undefined;
  readonly stopReason?: string | undefined;
  readonly usage?:
    | { readonly inputTokens?: number | undefined; readonly outputTokens?: number | undefined }
    | undefined;
}

/** One Converse call. The real one is `client.send(new ConverseCommand(input), { abortSignal })`. */
export type Converse = (
  input: ConverseInput,
  options: { readonly abortSignal: AbortSignal },
) => Promise<ConverseOutput>;

/** A deployment-shaped refusal: the adapter will not exist in this configuration. */
export class BedrockConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BedrockConfigurationError';
  }
}

const KNOWN_PROFILES: ReadonlySet<string> = new Set(Object.values(INDIA_PROFILES));

/** A vendor error carries a name AND the SDK's metadata; a bare object or plain Error does not. */
const vendorErrorName = (error: unknown): string | null => {
  if (typeof error !== 'object' || error === null) return null;
  const e = error as { name?: unknown; $metadata?: unknown; $fault?: unknown };
  if (typeof e.name !== 'string' || e.name.length === 0) return null;
  return e.$metadata !== undefined || e.$fault !== undefined ? e.name : null;
};

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export const createBedrockProvider = (config: {
  readonly region: string | undefined;
  readonly profileId: string;
  readonly converse: Converse;
}): LlmProvider => {
  if (config.region !== BEDROCK_REGION) {
    throw new BedrockConfigurationError(
      `the Bedrock adapter runs only in ${BEDROCK_REGION}; refusing region ${String(config.region)}`,
    );
  }
  if (!KNOWN_PROFILES.has(config.profileId)) {
    throw new BedrockConfigurationError(
      `the Bedrock adapter calls only the India inference profiles; refusing ${config.profileId}`,
    );
  }

  return {
    generate: async (request: LlmGenerateRequest): Promise<LlmResult> => {
      const system = request.messages
        .filter((m) => m.role === 'system')
        .map((m) => ({ text: m.content }));
      const user = request.messages.filter((m) => m.role === 'user');
      const temperature = request.modelConfig['temperature'];
      const maxTokens = request.modelConfig['maxTokens'];

      let out: ConverseOutput;
      try {
        out = await config.converse(
          {
            modelId: config.profileId,
            ...(system.length > 0 ? { system } : {}),
            messages: user.map((m) => ({ role: 'user' as const, content: [{ text: m.content }] })),
            inferenceConfig: {
              ...(typeof temperature === 'number' ? { temperature } : {}),
              ...(typeof maxTokens === 'number' ? { maxTokens } : {}),
            },
          },
          { abortSignal: request.signal },
        );
      } catch (error) {
        const name = vendorErrorName(error);
        // The vendor's NAME only — its message can echo the request and never leaves this function.
        if (name !== null) throw new ProviderError(name, 'the Bedrock call failed');
        throw new Error('the Bedrock call failed');
      }

      const meaning = meaningOf(out.stopReason);
      const text = (out.output?.message?.content ?? []).map((part) => part.text ?? '').join('');
      return {
        text,
        usage: {
          inputTokens: numberOr(out.usage?.inputTokens, 0),
          outputTokens: numberOr(out.usage?.outputTokens, 0),
        },
        provider: 'bedrock',
        model: config.profileId,
        ...(meaning === 'refused' ? { refused: true } : {}),
        ...(meaning === 'truncated' ? { truncated: true } : {}),
      };
    },
  };
};
