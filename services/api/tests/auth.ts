import { createHmac } from 'node:crypto';
import type { Client } from 'pg';

/**
 * Acting as a real user, two ways.
 *
 * `inRolledBackTransaction` connects as `postgres`, which holds the BYPASSRLS
 * attribute — measured, not assumed. An RLS test written against that connection
 * passes no matter what the policies say. Everything in this file exists to stop
 * that happening.
 *
 * FAST PATH — `asUser(client, ...)`: SET LOCAL ROLE authenticated plus the JWT
 * claims GUC. RLS is evaluated against `current_user`, so switching role genuinely
 * subjects the session to policy. Cheap enough to run hundreds of cases.
 *
 * FAITHFUL PATH — `rest(...)`: a JWT signed with the local secret, sent to
 * PostgREST over HTTP. Slower, and it is the only path that proves the fast path's
 * assumption about what claims PostgREST actually installs.
 *
 * Both build their claims through `buildAppClaims`. That shared function is what
 * `rls.spec.ts` pins against a real GoTrue sign-in — if the auth hook ever changes
 * shape, one test fails loudly instead of the whole suite quietly testing a
 * fiction it invented.
 */

export const API_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321';

/**
 * Local-stack defaults. These are the well-known fixed values every local Supabase
 * install prints; they are not secrets and never reach a deployed environment.
 * CI and any non-default stack override them through the environment.
 */
export const JWT_SECRET =
  process.env['SUPABASE_JWT_SECRET'] ?? 'super-secret-jwt-token-with-at-least-32-characters-long';

export const ANON_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

export const SERVICE_ROLE_KEY =
  process.env['SUPABASE_SERVICE_ROLE_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

export type AppRole = 'mr' | 'field_manager' | 'admin';

export interface ProfileLike {
  id: string;
  role: AppRole;
  territoryId: string | null;
  isActive: boolean;
}

/** Exactly the claims public.custom_access_token_hook adds. Nothing invented. */
export interface AppClaims {
  app_role: AppRole;
  app_is_active: boolean;
  app_territory_id?: string;
}

export const buildAppClaims = (profile: ProfileLike): AppClaims => {
  const claims: AppClaims = {
    app_role: profile.role,
    app_is_active: profile.isActive,
  };
  if (profile.territoryId !== null) {
    claims.app_territory_id = profile.territoryId;
  }
  return claims;
};

const b64url = (value: Buffer | string): string =>
  Buffer.from(value).toString('base64url').replace(/=+$/, '');

/** HS256, hand-rolled on node:crypto so the suite carries no JWT dependency. */
export const mintAccessToken = (profile: ProfileLike, ttlSeconds = 3600): string => {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      iss: `${API_URL}/auth/v1`,
      sub: profile.id,
      aud: 'authenticated',
      role: 'authenticated',
      iat: issuedAt,
      exp: issuedAt + ttlSeconds,
      session_id: '00000000-0000-4000-8000-000000000000',
      ...buildAppClaims(profile),
    }),
  );
  const signature = createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url')
    .replace(/=+$/, '');
  return `${header}.${payload}.${signature}`;
};

export const decodeJwtPayload = (token: string): Record<string, unknown> => {
  const segment = token.split('.')[1];
  if (segment === undefined) throw new Error('token has no payload segment');
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
};

/**
 * Fast path. Inside an open transaction, become `authenticated` and install the
 * claims PostgREST would have installed.
 *
 * SET LOCAL and set_config(..., true) are both transaction-scoped, so the rollback
 * that ends the transaction also undoes the role switch. No connection is ever
 * handed back to a later test still wearing a role.
 */
export const asUser = async (client: Client, profile: ProfileLike): Promise<void> => {
  const claims = {
    sub: profile.id,
    role: 'authenticated',
    aud: 'authenticated',
    ...buildAppClaims(profile),
  };
  await client.query('select set_config($1, $2, true)', [
    'request.jwt.claims',
    JSON.stringify(claims),
  ]);
  await client.query('set local role authenticated');
};

/** Become a bare database role with no user identity. Used for the attacker cases. */
export const asDatabaseRole = async (
  client: Client,
  role: 'authenticated' | 'anon' | 'service_role',
): Promise<void> => {
  await client.query(`set local role ${role}`);
};

export interface RestResponse {
  status: number;
  body: unknown;
  text: string;
}

/** Faithful path. Real HTTP, real PostgREST, real JWT verification. */
export const rest = async (
  path: string,
  options: {
    token?: string;
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<RestResponse> => {
  const token = options.token ?? ANON_KEY;
  const headers: Record<string, string> = {
    apikey: ANON_KEY,
    authorization: `Bearer ${token}`,
    accept: 'application/json',
    ...options.headers,
  };
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  const response = await fetch(`${API_URL}/rest/v1${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body, text };
};

/** Real GoTrue password sign-in. Used only by the claims-fidelity test. */
export const signIn = async (
  email: string,
  password: string,
): Promise<{ accessToken: string; claims: Record<string, unknown> }> => {
  const response = await fetch(`${API_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const payload = (await response.json()) as { access_token?: string };
  if (!response.ok || payload.access_token === undefined) {
    throw new Error(`sign-in failed (${String(response.status)}): ${JSON.stringify(payload)}`);
  }
  return {
    accessToken: payload.access_token,
    claims: decodeJwtPayload(payload.access_token),
  };
};

export const createAuthUser = async (email: string, password: string): Promise<string> => {
  const response = await fetch(`${API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const payload = (await response.json()) as { id?: string };
  if (!response.ok || payload.id === undefined) {
    throw new Error(
      `admin create user failed (${String(response.status)}): ${JSON.stringify(payload)}`,
    );
  }
  return payload.id;
};
