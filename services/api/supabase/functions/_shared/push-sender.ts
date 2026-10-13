/**
 * `BE-W196` — what the `push-sender` Edge Function does, with the outbox, the clock and the network
 * passed in, so every branch is testable under vitest without Deno, Firebase or a database.
 *
 * **The choice: FCM HTTP v1, directly.** The phone registers its native FCM token
 * (`getDevicePushTokenAsync`), and this sends to Firebase with an OAuth token minted from the
 * company's service-account key, held as the Edge Function secret `FCM_SERVICE_ACCOUNT`. The
 * alternative, Expo's push service, would need an Expo account and project id in the app AND the same
 * Firebase key uploaded to Expo -- a second company holding the credential, and every notification
 * passing through it. Direct keeps the key in one place, server-side.
 *
 * **Never throws in a loop, never claims what it cannot send.** No `FCM_SERVICE_ACCOUNT`, a malformed
 * one, or no secret key for the outbox: the answer is "not configured" and NOTHING is claimed, so the
 * notifications wait (and expire after 24 hours, `push_claim_batch`). If Google refuses our OAuth
 * request, nothing is claimed either. If FCM rejects our credentials mid-batch, the rest of the batch
 * goes back as `retry` and the run stops.
 *
 * **Tokens are retired when FCM says so**: `UNREGISTERED` (404), an invalid registration token (400),
 * or a token from another Firebase project (`SENDER_ID_MISMATCH`, 403).
 *
 * Imports nothing: `practice-writer.ts` imports `PushOutbox` from here, and the vitest suite imports
 * this file directly. No token, key or access token is ever put in a report or an error string.
 */

/** The two calls `pushOutboxFromEnv` hands out (`_shared/practice-writer.ts`). */
export interface PushOutbox {
  readonly claim: (limit: number) => Promise<unknown>;
  readonly record: (results: readonly unknown[]) => Promise<unknown>;
}

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export interface ServiceAccount {
  readonly projectId: string;
  readonly clientEmail: string;
  readonly privateKeyPem: string;
  readonly tokenUri: string;
}

export interface Claimed {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly link: string;
  readonly tokens: readonly { readonly id: string; readonly token: string }[];
}

export interface Result {
  readonly id: string;
  readonly outcome: 'sent' | 'retry' | 'failed';
  readonly error: string | null;
  readonly retireTokenIds: string[];
}

export interface SenderReport {
  readonly configured: boolean;
  readonly message: string;
  readonly claimed: number;
  readonly sent: number;
  readonly retried: number;
  readonly failed: number;
  readonly tokensRetired: number;
}

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
export const BATCH_SIZE = 100;

const report = (
  configured: boolean,
  message: string,
  counts: Partial<SenderReport> = {},
): SenderReport => ({
  configured,
  message,
  claimed: 0,
  sent: 0,
  retried: 0,
  failed: 0,
  tokensRetired: 0,
  ...counts,
});

/** The service-account JSON, or null with what is wrong (never a value from it). */
export const parseServiceAccount = (
  raw: string | undefined,
): { account: ServiceAccount } | { problem: string } => {
  if (raw === undefined || raw.trim() === '') return { problem: 'FCM_SERVICE_ACCOUNT is not set' };
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { problem: 'FCM_SERVICE_ACCOUNT is not JSON' };
  }
  const text = (key: string): string | null =>
    typeof json[key] === 'string' && (json[key] as string).length > 0
      ? (json[key] as string)
      : null;
  const projectId = text('project_id');
  const clientEmail = text('client_email');
  const privateKeyPem = text('private_key');
  if (
    json['type'] !== 'service_account' ||
    projectId === null ||
    clientEmail === null ||
    privateKeyPem === null
  ) {
    return {
      problem:
        'FCM_SERVICE_ACCOUNT is not a service-account key (needs type, project_id, client_email, private_key)',
    };
  }
  const tokenUri = text('token_uri') ?? DEFAULT_TOKEN_URI;
  if (!tokenUri.startsWith('https://'))
    return { problem: 'FCM_SERVICE_ACCOUNT token_uri is not https' };
  return { account: { projectId, clientEmail, privateKeyPem, tokenUri } };
};

const base64url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
};

const pemToDer = (pem: string): Uint8Array<ArrayBuffer> => {
  const body = pem
    .replace(/-----BEGIN [A-Z ]+-----/u, '')
    .replace(/-----END [A-Z ]+-----/u, '')
    .replace(/\\n/gu, '')
    .replace(/\s+/gu, '');
  const binary = atob(body);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
};

/** A signed RS256 assertion for Google's token endpoint (RFC 7523), valid one hour. */
export const signedAssertion = async (
  account: ServiceAccount,
  nowSeconds: number,
): Promise<string> => {
  const encoder = new TextEncoder();
  const header = base64url(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = base64url(
    encoder.encode(
      JSON.stringify({
        iss: account.clientEmail,
        scope: FCM_SCOPE,
        aud: account.tokenUri,
        iat: nowSeconds,
        exp: nowSeconds + 3600,
      }),
    ),
  );
  const key = await globalThis.crypto.subtle.importKey(
    'pkcs8',
    pemToDer(account.privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await globalThis.crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    encoder.encode(`${header}.${claims}`),
  );
  return `${header}.${claims}.${base64url(new Uint8Array(signature))}`;
};

/** An OAuth access token for FCM, or the reason there is none (status only, never a body). */
export const accessToken = async (
  account: ServiceAccount,
  fetchFn: Fetch,
  nowSeconds: number,
): Promise<{ token: string } | { problem: string }> => {
  let assertion: string;
  try {
    assertion = await signedAssertion(account, nowSeconds);
  } catch {
    return { problem: 'FCM_SERVICE_ACCOUNT private_key could not be used to sign' };
  }
  try {
    const response = await fetchFn(account.tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });
    if (!response.ok)
      return { problem: `Google refused the service account (HTTP ${String(response.status)})` };
    const json = (await response.json()) as { access_token?: unknown };
    return typeof json.access_token === 'string' && json.access_token.length > 0
      ? { token: json.access_token }
      : { problem: 'Google answered without an access token' };
  } catch {
    return { problem: 'Google’s token endpoint could not be reached' };
  }
};

/** What one send to one token came to. */
export type Delivery = 'delivered' | 'retire' | 'retry' | 'failed' | 'credentials';

/** Classify an FCM v1 answer. Exported for its tests. */
export const classify = (status: number, errorBody: unknown): Delivery => {
  if (status >= 200 && status < 300) return 'delivered';
  const error = (
    errorBody as { error?: { status?: unknown; message?: unknown; details?: unknown } } | null
  )?.error;
  const details = Array.isArray(error?.details) ? (error.details as { errorCode?: unknown }[]) : [];
  const codes = new Set(
    [error?.status, ...details.map((d) => d.errorCode)].filter(
      (c): c is string => typeof c === 'string',
    ),
  );
  if (status === 404 || codes.has('UNREGISTERED')) return 'retire';
  if (codes.has('SENDER_ID_MISMATCH')) return 'retire';
  if (status === 400) {
    const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
    return message.includes('registration token') ? 'retire' : 'failed';
  }
  if (status === 401 || status === 403) return 'credentials';
  if (status === 429 || status >= 500) return 'retry';
  return 'failed';
};

const send = async (
  fetchFn: Fetch,
  account: ServiceAccount,
  bearer: string,
  token: string,
  n: Claimed,
): Promise<Delivery> => {
  try {
    const response = await fetchFn(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.projectId)}/messages:send`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: n.title, body: n.body },
            // Where the app opens when it is tapped; read by `apps/field/src/push`.
            data: { link: n.link, kind: n.kind, notificationId: n.id },
            android: { priority: 'NORMAL', notification: { channel_id: 'default' } },
          },
        }),
      },
    );
    let body: unknown = null;
    if (!response.ok) {
      try {
        body = await response.json();
      } catch {
        body = null;
      }
    }
    return classify(response.status, body);
  } catch {
    return 'retry';
  }
};

const isClaimed = (value: unknown): value is Claimed => {
  const v = value as Partial<Claimed> | null;
  return (
    typeof v?.id === 'string' &&
    typeof v.title === 'string' &&
    typeof v.body === 'string' &&
    typeof v.link === 'string' &&
    typeof v.kind === 'string' &&
    Array.isArray(v.tokens)
  );
};

export interface RunInput {
  readonly serviceAccountJson: string | undefined;
  readonly outbox: PushOutbox | null;
  readonly fetch: Fetch;
  readonly nowSeconds: number;
  readonly batchSize?: number;
}

/** One run: authenticate, claim one batch, send it, record every outcome. */
export const runPushSender = async (input: RunInput): Promise<SenderReport> => {
  const parsed = parseServiceAccount(input.serviceAccountJson);
  if ('problem' in parsed) return report(false, `not configured: ${parsed.problem}`);
  if (input.outbox === null) {
    return report(
      false,
      'not configured: the platform gave this function no secret key for the outbox',
    );
  }
  const account = parsed.account;

  const auth = await accessToken(account, input.fetch, input.nowSeconds);
  if ('problem' in auth) return report(true, `nothing sent: ${auth.problem}`);

  const raw = await input.outbox.claim(input.batchSize ?? BATCH_SIZE);
  const batch = Array.isArray(raw) ? raw.filter(isClaimed) : [];
  if (batch.length === 0) return report(true, 'nothing to send');

  const results: Result[] = [];
  let credentialsRefused = false;
  for (const n of batch) {
    if (credentialsRefused) {
      results.push({
        id: n.id,
        outcome: 'retry',
        error: 'FCM refused our credentials',
        retireTokenIds: [],
      });
      continue;
    }
    const retire: string[] = [];
    let delivered = false;
    let retry = false;
    let failed = false;
    for (const t of n.tokens) {
      const outcome = await send(input.fetch, account, auth.token, t.token, n);
      if (outcome === 'delivered') delivered = true;
      else if (outcome === 'retire') retire.push(t.id);
      else if (outcome === 'retry') retry = true;
      else if (outcome === 'failed') failed = true;
      else {
        credentialsRefused = true;
        retry = true;
        break;
      }
    }
    if (delivered) results.push({ id: n.id, outcome: 'sent', error: null, retireTokenIds: retire });
    else if (retry)
      results.push({
        id: n.id,
        outcome: 'retry',
        error: credentialsRefused ? 'FCM refused our credentials' : 'FCM busy or unreachable',
        retireTokenIds: retire,
      });
    else
      results.push({
        id: n.id,
        outcome: 'failed',
        error:
          n.tokens.length === 0 || (!failed && retire.length === n.tokens.length)
            ? 'no valid device'
            : 'FCM refused the message',
        retireTokenIds: retire,
      });
  }

  const recorded = (await input.outbox.record(results)) as Partial<Record<string, unknown>> | null;
  const count = (key: string): number =>
    typeof recorded?.[key] === 'number' ? (recorded[key] as number) : 0;
  return report(
    true,
    credentialsRefused
      ? 'stopped: FCM refused our credentials; the rest will be retried'
      : 'batch sent',
    {
      claimed: batch.length,
      sent: count('sent'),
      retried: count('retry'),
      failed: count('failed'),
      tokensRetired: count('tokensRetired'),
    },
  );
};

/** Constant-time comparison for the scheduled caller's shared secret. */
export const sameSecret = (given: string | null, expected: string | undefined): boolean => {
  if (given === null || expected === undefined || expected.length < 32) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i += 1) diff |= (a[i % Math.max(a.length, 1)] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
};
