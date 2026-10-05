/**
 * W1-Z B — the three ways the live AI transports reach the server, as the SIGNED-IN REP.
 *
 * Plain `fetch` against Supabase's own endpoints — PostgREST for table reads and RPCs, the
 * `ai-gateway` Edge Function for the AI features — rather than the `supabase` client object, so the
 * same code runs on the phone and in the API test suite (which drives it against the local stack
 * with a real rep's token). Every call carries the rep's access token; the row rules in Postgres
 * decide what comes back, exactly as they do for the rest of the app.
 *
 * Nothing here imports React Native.
 */
import type { GatewayResponse } from './practice/contract';

export interface LiveConnection {
  /** The Supabase project URL — `appConfig.supabaseUrl` in the app. */
  readonly baseUrl: string;
  /** The project's publishable key — identifies the PROJECT, never the user. */
  readonly apiKey: string;
  /** The signed-in rep's access token, or null when nobody is signed in. */
  readonly accessToken: () => Promise<string | null>;
  readonly fetch?: typeof fetch;
}

/** A refusal from the server, with its SQLSTATE where PostgREST supplied one. */
export class LiveRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'LiveRequestError';
  }
}

const headers = async (c: LiveConnection): Promise<Record<string, string>> => {
  const token = await c.accessToken();
  if (token === null) throw new LiveRequestError(401, '28000', 'not signed in');
  return {
    apikey: c.apiKey,
    Authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
};

const fetchOf = (c: LiveConnection): typeof fetch => c.fetch ?? fetch;

const readJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

const refusal = (status: number, body: unknown): LiveRequestError => {
  const record = (body ?? {}) as { code?: unknown; message?: unknown };
  return new LiveRequestError(
    status,
    typeof record.code === 'string' ? record.code : null,
    typeof record.message === 'string' ? record.message : `HTTP ${String(status)}`,
  );
};

/** POST to the `ai-gateway`. The status and body come back as they are: the screens interpret them. */
export const postGateway = async (c: LiveConnection, body: unknown): Promise<GatewayResponse> => {
  const response = await fetchOf(c)(`${c.baseUrl}/functions/v1/ai-gateway`, {
    method: 'POST',
    headers: await headers(c),
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await readJson(response) };
};

/** A Postgres function, through PostgREST. A refusal throws with its SQLSTATE. */
export const callRpc = async (
  c: LiveConnection,
  fn: string,
  args: Readonly<Record<string, unknown>>,
): Promise<unknown> => {
  const response = await fetchOf(c)(`${c.baseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: await headers(c),
    body: JSON.stringify(args),
  });
  const body = await readJson(response);
  if (!response.ok) throw refusal(response.status, body);
  return body;
};

/** A table read, through PostgREST: `path` is `table?select=...&filter`. Rows the rep may see. */
export const selectRows = async (
  c: LiveConnection,
  path: string,
): Promise<readonly Record<string, unknown>[]> => {
  const response = await fetchOf(c)(`${c.baseUrl}/rest/v1/${path}`, {
    method: 'GET',
    headers: await headers(c),
  });
  const body = await readJson(response);
  if (!response.ok) throw refusal(response.status, body);
  return Array.isArray(body) ? (body as Record<string, unknown>[]) : [];
};
