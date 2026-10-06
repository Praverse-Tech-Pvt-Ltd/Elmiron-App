import { existsSync, readFileSync } from 'node:fs';
import {
  INDIA_PROFILES,
  createBedrockProvider,
} from '../supabase/functions/_shared/bedrock-provider.ts';
import { bedrockConverse } from '../supabase/functions/_shared/bedrock-client.ts';

/**
 * The live suites' shared gate (W1-V A5, widened W2-D A3). Reads the git-ignored
 * `services/api/supabase/functions/.env` — the same file `functions serve` reads — into THIS process
 * only. **No value from it is ever returned in a reason, printed or thrown**; only a vendor error NAME.
 */

const ENV_FILE = new URL('../supabase/functions/.env', import.meta.url);

export const readFunctionsEnv = (): Record<string, string> | null => {
  if (!existsSync(ENV_FILE)) return null;
  return Object.fromEntries(
    readFileSync(ENV_FILE, 'utf8')
      .split(/\r?\n/u)
      .map((l) => /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/u.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1], (m[2] ?? '').replace(/^"|"$/gu, '')]),
  ) as Record<string, string>;
};

export interface Credential {
  readonly accessKeyId: string | undefined;
  readonly secretAccessKey: string | undefined;
  readonly region: string | undefined;
}

export const readCredential = (): Credential | null => {
  const env = readFunctionsEnv();
  if (env === null) return null;
  return {
    accessKeyId: env['AWS_ACCESS_KEY_ID'],
    secretAccessKey: env['AWS_SECRET_ACCESS_KEY'],
    region: env['AWS_REGION'],
  };
};

/**
 * Gates 1 and 2: a credential, then one minimal probe call to the Haiku profile. `ready: false` always
 * carries a reason that says which gate stopped it.
 */
export const modelAccessGate = async (): Promise<{ ready: boolean; reason: string }> => {
  const credential = readCredential();
  if (credential === null || !credential.accessKeyId || !credential.secretAccessKey) {
    return {
      ready: false,
      reason: 'no credential (services/api/supabase/functions/.env absent or incomplete)',
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
    return { ready: true, reason: 'model access granted' };
  } catch (error) {
    const name =
      (error as { vendorCode?: string; name?: string }).vendorCode ?? (error as Error).name;
    return name === 'AccessDeniedException' || name === 'ValidationException'
      ? { ready: false, reason: `model access not granted (${name})` }
      : { ready: false, reason: `probe failed (${name})` };
  }
};
