import { existsSync, readFileSync } from 'node:fs';
import { OPENAI_MODEL } from '@fieldforce/core';
import {
  INDIA_PROFILES,
  createBedrockProvider,
} from '../supabase/functions/_shared/bedrock-provider.ts';
import { bedrockConverse } from '../supabase/functions/_shared/bedrock-client.ts';
import { createOpenAiProvider } from '../supabase/functions/_shared/openai-provider.ts';

/**
 * The live suites' shared gate (W1-V A5, widened W2-D A3, made provider-agnostic by `BE-W203`).
 * Reads the git-ignored `services/api/supabase/functions/.env` — the same file `functions serve`
 * reads — into THIS process only. **No value from it is ever returned in a reason, printed or
 * thrown**; only the NAME of a setting, the HTTP status and the vendor's error CODE.
 *
 * ## Which provider (`BE-W203`)
 *
 * The gateway builds its provider from `AI_PROVIDER` (`ai-gateway/index.ts`, the construction line):
 * `openai` (`BE-C79`, the pilot's) or `bedrock` (`BE-C26`, kept). The live suite follows the same
 * setting, so `pnpm ai:live` proves whichever vendor the served gateway will actually call. Until
 * `BE-W203` the gate was Bedrock-only: with an OpenAI key in place `pnpm ai:live` printed SKIPPING and
 * proved nothing, on the one day it mattered.
 *
 * ## Three outcomes, not two
 *
 * * `ready`   — the vendor answered the probe; the live tests run.
 * * `skip`    — nothing is configured to test (no file, no `AI_PROVIDER`, no key), or — Bedrock only —
 *               the AWS account owner has not granted model access, which is waiting on a person.
 * * `refused` — `AI_PROVIDER=openai` WITH a key, and OpenAI refuses it (a bad key, no quota, a model
 *               the key cannot use). **That is a red, not a skip.** The file says the day is live; a
 *               green "SKIPPING" would hide the one problem the person who just pasted the key needs to
 *               see (`docs/START-HERE.md` Trap 8: a skipped suite exits 0).
 */

export const ENV_FILE = new URL('../supabase/functions/.env', import.meta.url);
const ENV_FILE_NAME = 'services/api/supabase/functions/.env';

export const readFunctionsEnv = (): Record<string, string> | null => {
  if (!existsSync(ENV_FILE)) return null;
  return parseFunctionsEnv(readFileSync(ENV_FILE, 'utf8'));
};

/** `KEY=value` per line; surrounding quotes removed. Pure, so the gate can be tested on text. */
export const parseFunctionsEnv = (text: string): Record<string, string> =>
  Object.fromEntries(
    text
      .split(/\r?\n/u)
      .map((l) => /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/u.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1], (m[2] ?? '').replace(/^"|"$/gu, '')]),
  ) as Record<string, string>;

export interface Credential {
  readonly accessKeyId: string | undefined;
  readonly secretAccessKey: string | undefined;
  readonly region: string | undefined;
}

export const readCredential = (
  env: Record<string, string> | null = readFunctionsEnv(),
): Credential | null => {
  if (env === null) return null;
  return {
    accessKeyId: env['AWS_ACCESS_KEY_ID'],
    secretAccessKey: env['AWS_SECRET_ACCESS_KEY'],
    region: env['AWS_REGION'],
  };
};

export type LiveProvider = 'openai' | 'bedrock';

export interface LiveGate {
  readonly state: 'ready' | 'skip' | 'refused';
  /** Always non-empty; names the gate that stopped it. Never carries a value from the file. */
  readonly reason: string;
  /** The provider the served gateway will build, or null when it would build the stub. */
  readonly provider: LiveProvider | null;
}

/**
 * OpenAI answers a request for `gpt-4.1` with the snapshot that served it, `gpt-4.1-2025-04-14`, and
 * the adapter records that in `ai_requests.model_name` (more exact for an audit; `openai-provider.spec.ts`
 * pins it). So a live row matches the configured id, or that id plus a `-YYYY-MM-DD` date — and nothing
 * else: `gpt-4.1-mini-2025-04-14` must NOT pass for `gpt-4.1`.
 */
export const isConfiguredModel = (recorded: string | null, configured: string): boolean =>
  recorded === configured ||
  (recorded !== null &&
    recorded.startsWith(`${configured}-`) &&
    /^\d{4}-\d{2}-\d{2}$/u.test(recorded.slice(configured.length + 1)));

/** The first test's title in every live suite: the reason is ON the run, not in a log. */
export const gateTitle = (gate: LiveGate): string =>
  gate.state === 'ready'
    ? `gate: READY (${String(gate.provider)})`
    : gate.state === 'refused'
      ? `gate: REFUSED — ${gate.reason}`
      : `gate: SKIPPING — ${gate.reason}`;

/**
 * Gates 1 and 2 for Bedrock: a credential, then one minimal probe call to the Haiku profile. Unchanged
 * in behaviour since W1-V: a refused probe is a SKIP, because model access is the AWS account owner's
 * step, not engineering's (`docs/ai-platform/DAY-ONE.md`).
 */
export const bedrockAccessGate = async (
  env: Record<string, string> | null = readFunctionsEnv(),
): Promise<LiveGate> => {
  const credential = readCredential(env);
  if (credential === null || !credential.accessKeyId || !credential.secretAccessKey) {
    return {
      state: 'skip',
      provider: 'bedrock',
      reason: `no AWS credential (${ENV_FILE_NAME} absent or incomplete)`,
    };
  }
  try {
    await createBedrockProvider({
      region: credential.region,
      profileId: INDIA_PROFILES.haiku,
      converse: bedrockConverse({
        accessKeyId: credential.accessKeyId,
        secretAccessKey: credential.secretAccessKey,
      }),
    }).generate({
      messages: [
        { role: 'system', content: 'Reply with JSON only: {"ok": true}.' },
        { role: 'user', content: 'Say OK.' },
      ],
      modelConfig: { temperature: 0, maxTokens: 20 },
      json: true,
      signal: AbortSignal.timeout(30_000),
    });
    return { state: 'ready', provider: 'bedrock', reason: 'model access granted' };
  } catch (error) {
    const name =
      (error as { vendorCode?: string; name?: string }).vendorCode ?? (error as Error).name;
    return name === 'AccessDeniedException' || name === 'ValidationException'
      ? { state: 'skip', provider: 'bedrock', reason: `model access not granted (${name})` }
      : { state: 'skip', provider: 'bedrock', reason: `probe failed (${name})` };
  }
};

/** The placeholder `functions/.env.example` ships (`BE-W204`): a copied file with no key pasted in. */
export const isPlaceholderKey = (key: string): boolean => /REPLACE-ME/u.test(key);

/** OpenAI's model-lookup endpoint. A GET is free: it proves the key and the model, and bills nothing. */
export const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';

/** Only a bounded identifier from the vendor's body; never its message, which can echo the request. */
const openAiCode = (body: unknown): string | null => {
  const error = (body as { error?: { code?: unknown; type?: unknown } } | null)?.error;
  for (const candidate of [error?.code, error?.type]) {
    if (typeof candidate === 'string' && /^[A-Za-z0-9_.-]{1,48}$/u.test(candidate))
      return candidate;
  }
  return null;
};

/**
 * What an OpenAI refusal MEANS, in the words the person holding the key needs. The status and the
 * vendor's code are named so the remedy can be looked up; the key is never part of either.
 */
export const describeOpenAiRefusal = (
  status: number,
  code: string | null,
  model: string,
): string => {
  const named = `HTTP ${String(status)}${code === null ? '' : ` ${code}`}`;
  if (status === 401)
    return `OpenAI refused the key (${named}): OPENAI_API_KEY in ${ENV_FILE_NAME} is wrong, revoked, or for another organisation — paste it again in an editor`;
  if (status === 429 && code === 'insufficient_quota')
    return `OpenAI says the account has no quota (${named}): add billing or credit to the OpenAI organisation the key belongs to`;
  if (status === 429)
    return `OpenAI is rate-limiting this key (${named}): wait a minute and run again`;
  if (status === 404 || code === 'model_not_found')
    return `OpenAI says model "${model}" is not available to this key (${named}): the project may not have access to it, or it has been shut down — OPENAI_MODEL in packages/core (prompt-contract.ts)`;
  if (status === 403)
    return `OpenAI refused this key for this request (${named}): the project's permissions or region do not allow it`;
  return `OpenAI refused the probe (${named})`;
};

/**
 * Gates 1 and 2 for OpenAI, pure apart from `fetchImpl`: a key, then (a) a GET of every model the
 * gateway will call — the key and the model, free — and (b) ONE minimal completion on the smaller
 * model through the gateway's own adapter, which is the only way to see a 429 `insufficient_quota`
 * (an account with no credit answers the GET happily). The completion asks for at most 20 tokens.
 */
export const openAiAccessGate = async (
  env: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<LiveGate> => {
  const key = (env['OPENAI_API_KEY'] ?? '').trim();
  if (key === '') {
    return {
      state: 'skip',
      provider: 'openai',
      reason: `AI_PROVIDER=openai but no OPENAI_API_KEY in ${ENV_FILE_NAME} — the gateway would refuse every request (503 no_provider)`,
    };
  }
  if (isPlaceholderKey(key)) {
    return {
      state: 'skip',
      provider: 'openai',
      reason: `OPENAI_API_KEY in ${ENV_FILE_NAME} is still the .env.example placeholder — paste the real key in an editor`,
    };
  }
  const refused = (reason: string): LiveGate => ({ state: 'refused', provider: 'openai', reason });

  for (const model of [...new Set(Object.values(OPENAI_MODEL))]) {
    let response: Response;
    try {
      response = await fetchImpl(`${OPENAI_MODELS_URL}/${encodeURIComponent(model)}`, {
        headers: { authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      // Nothing from the error is passed on: it can carry the URL and more.
      return refused('could not reach api.openai.com (network error) — check the connection');
    }
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      return refused(describeOpenAiRefusal(response.status, openAiCode(body), model));
    }
  }

  try {
    await createOpenAiProvider({
      apiKey: key,
      model: OPENAI_MODEL.haiku,
      fetch: fetchImpl,
    }).generate({
      messages: [
        { role: 'system', content: 'Reply with JSON only: {"ok": true}.' },
        { role: 'user', content: 'Say OK.' },
      ],
      modelConfig: { temperature: 0, maxTokens: 20 },
      json: true,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    const code = (error as { vendorCode?: unknown }).vendorCode;
    if (typeof code !== 'string') {
      return refused(
        'the probe completion failed before OpenAI answered (network error or timeout)',
      );
    }
    // The adapter's code is the vendor's (or `http_<status>`); the status is not kept, so it is
    // inferred only where the code is unambiguous.
    const status =
      code === 'invalid_api_key'
        ? 401
        : code === 'insufficient_quota' || code === 'rate_limit_exceeded'
          ? 429
          : code === 'model_not_found'
            ? 404
            : Number(/^http_(\d{3})$/u.exec(code)?.[1] ?? 0);
    return refused(
      describeOpenAiRefusal(status, code.startsWith('http_') ? null : code, OPENAI_MODEL.haiku),
    );
  }
  return {
    state: 'ready',
    provider: 'openai',
    reason: `OpenAI answered (${[...new Set(Object.values(OPENAI_MODEL))].join(', ')})`,
  };
};

/**
 * The gate `ai-live.spec.ts` uses: the provider the served gateway will build, then that vendor's
 * probe. `AI_PROVIDER` unset or anything else means the gateway answers from the STUB, and a green
 * run would prove nothing about any model — so it skips and says how to set it.
 */
export const liveProviderGate = async (
  env: Record<string, string> | null = readFunctionsEnv(),
  fetchImpl: typeof fetch = fetch,
): Promise<LiveGate> => {
  if (env === null) {
    return {
      state: 'skip',
      provider: null,
      reason: `no ${ENV_FILE_NAME} — put AI_PROVIDER=openai and OPENAI_API_KEY in it with an editor (docs/KEY-DAY.md)`,
    };
  }
  const provider = env['AI_PROVIDER'];
  if (provider === 'openai') return openAiAccessGate(env, fetchImpl);
  if (provider === 'bedrock') return bedrockAccessGate(env);
  return {
    state: 'skip',
    provider: null,
    reason: `AI_PROVIDER is ${describeProviderValue(provider)} in ${ENV_FILE_NAME} — the gateway would answer from the stub (docs/KEY-DAY.md)`,
  };
};

/**
 * The value of `AI_PROVIDER`, for a reason — and NEVER when it could hold a secret. A line written with
 * `echo >>` onto a file with no final newline reads `AI_PROVIDER=openaiOPENAI_API_KEY=sk-…`: the
 * "value" is then the key (`docs/START-HERE.md` Trap 4). Only a short lowercase word is printed.
 */
export const describeProviderValue = (value: string | undefined): string => {
  if (value === undefined || value.trim() === '') return 'not set';
  if (/^[a-z][a-z0-9_-]{0,19}$/u.test(value)) return `"${value}", neither openai nor bedrock,`;
  return 'set to something that is not a provider name (not printed — two settings glued on one line by `echo >>` look like this; fix the file in an editor)';
};
