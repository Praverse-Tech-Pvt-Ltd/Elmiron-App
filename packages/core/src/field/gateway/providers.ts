import type { z } from 'zod';

/**
 * Vendor-neutral provider interfaces — master prompt §21 and §37.
 *
 * **Business logic never names a vendor.** Every AI feature is written against these
 * interfaces; a vendor is an adapter that implements one, chosen by D2
 * (`docs/ai-platform/phase-a-recon.md`). No adapter exists yet, on purpose: writing one would
 * choose a vendor.
 *
 * **Runtime-neutral too.** Nothing here imports Node, Deno or React Native APIs beyond `fetch`,
 * `AbortSignal` and timers, which all three have. Whichever runtime D1 picks for the gateway
 * wraps this code; it does not rewrite it.
 */

export interface LlmMessage {
  readonly role: 'system' | 'user';
  readonly content: string;
}

export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface LlmResult {
  readonly text: string;
  readonly usage: LlmUsage;
  /** As the vendor names itself, e.g. for the request log. Never used to branch on. */
  readonly provider: string;
  readonly model: string;
}

export interface LlmGenerateRequest {
  readonly messages: readonly LlmMessage[];
  /** The approved prompt version's `modelConfig`, passed through untouched. */
  readonly modelConfig: Readonly<Record<string, unknown>>;
  /** Asks the model for JSON. An adapter maps this to the vendor's JSON mode, if it has one. */
  readonly json: boolean;
  readonly signal: AbortSignal;
}

export interface LlmProvider {
  generate(request: LlmGenerateRequest): Promise<LlmResult>;
}

/** §37 `embed()`. Interface only: vector retrieval waits on D3 (pgvector). */
export interface EmbeddingProvider {
  embed(texts: readonly string[], signal: AbortSignal): Promise<readonly (readonly number[])[]>;
}

/** §21. Interface only: the speech vendor is `blocked-on-you` 4.2, and must accept deletion terms. */
export interface TranscriptionProvider {
  transcribe(
    audio: Uint8Array,
    options: { readonly languageHint: string | null; readonly signal: AbortSignal },
  ): Promise<{ readonly text: string; readonly confidence: number | null }>;
}

/** §21. Interface only. */
export interface SpeechSynthesisProvider {
  synthesise(
    text: string,
    options: { readonly voice: string; readonly signal: AbortSignal },
  ): Promise<Uint8Array>;
}

/**
 * The control-plane RPCs, as the SIGNED-IN USER. The gateway passes the caller's token through
 * (measured in the D1 spike), so every authorisation decision stays in Postgres.
 *
 * Implemented by `supabase.rpc` in a runtime, and by a `pg` client in the database tests.
 * A refusal must be thrown as an error carrying the SQLSTATE in `code`, which is what both do.
 */
export interface ControlPlaneRpc {
  call(fn: string, args: Readonly<Record<string, unknown>>): Promise<unknown>;
}

export type StructuredResult<T> =
  | { readonly ok: true; readonly value: T; readonly raw: LlmResult }
  | {
      readonly ok: false;
      readonly reason: 'not_json' | 'schema_mismatch';
      readonly raw: LlmResult;
    };

/**
 * §37 `generateStructured()` — provider-independent, because validation is ours, not the
 * vendor's (§38: "Validate model output server-side"). A vendor's JSON mode is a convenience;
 * it is never trusted to have produced the right shape.
 */
export const generateStructured = async <S extends z.ZodType>(
  provider: LlmProvider,
  schema: S,
  request: Omit<LlmGenerateRequest, 'json'>,
): Promise<StructuredResult<z.infer<S>>> => {
  const raw = await provider.generate({ ...request, json: true });
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw.text));
  } catch {
    return { ok: false, reason: 'not_json', raw };
  }
  const result = schema.safeParse(parsed);
  return result.success
    ? { ok: true, value: result.data, raw }
    : { ok: false, reason: 'schema_mismatch', raw };
};

/** Models wrap JSON in a markdown fence often enough that refusing it would be a false failure. */
const stripCodeFence = (text: string): string => {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/.exec(text);
  return fenced?.[1] ?? text;
};

/** Rejects with `'timeout'` if the provider has not answered in time, and aborts the call. */
export const withTimeout = async <T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ProviderTimeoutError(timeoutMs));
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

export class ProviderTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`provider did not answer within ${String(timeoutMs)} ms`);
    this.name = 'ProviderTimeoutError';
  }
}
