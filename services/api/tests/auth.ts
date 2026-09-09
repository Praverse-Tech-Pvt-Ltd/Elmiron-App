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

/**
 * MR-12 Part C. Why identity creation is serialised globally and budgeted per file.
 *
 * **The failure.** `POST /auth/v1/admin/users` makes GoTrue take a Postgres connection.
 * `max_connections` is 100, and PostgREST, Realtime and Storage hold pools against the
 * same 100. When enough suites seed at once GoTrue cannot get one and returns a 500 that
 * surfaces as **"Database error creating new user"** — an error naming neither
 * connections nor concurrency — failing whole suites at their `beforeAll`.
 *
 * **Why the previous fixes kept reopening.** MR-06 serialised the eight creations inside
 * one fixture, which cut the peak eightfold and held until MR-07 added two spec files.
 * MR-07 added `maxWorkers: 6`, which held until MR-10 added one more. MR-11 cut
 * `seed-day.spec` from nine identities to three. Every one of those is a constant tuned
 * to the suite count at the time, and the finding they each repeat is that **the burst
 * scales WITH the suite count** — so the next suite reopens it, and the record naming the
 * shape was written immediately before it did.
 *
 * `maxWorkers: 6` is that constant wearing a config value: whoever adds the 34th suite
 * has to know to re-tune it, which is the hand-maintained list `ci.yml` was taught not to
 * keep.
 *
 * **What replaces it.** An advisory lock held in the database being protected. Identity
 * creation is serialised ACROSS worker processes, so at most one `POST /admin/users` is
 * ever in flight no matter how many suites, workers or cores exist. There is no number to
 * re-tune: adding a hundred suites changes the peak not at all.
 */
const IDENTITY_LOCK_KEY = 0x5eed1de7;

/**
 * One world per spec file. `seedFixtures()` mints exactly eight.
 *
 * Serialising removes the connection burst; it does not stop a suite being wasteful, and
 * a suite that quietly mints nine identities per test is a defect whoever writes it should
 * hear about from the build rather than from CI three sessions later. `seed-day.spec`
 * called `seedDay()` once per test and minted nine — **this budget is what would have
 * failed that at the moment it was written**, naming the file, instead of a 500 from
 * GoTrue naming nothing.
 *
 * Vitest isolates module state per test file, so this counter is per file by construction.
 */
export const IDENTITY_BUDGET_PER_FILE = 8;
let mintedThisFile = 0;

/** Exposed so the budget's own test can assert the counter, and reset between cases. */
export const identitiesMintedThisFile = (): number => mintedThisFile;
export const resetIdentityBudgetForTest = (): void => {
  mintedThisFile = 0;
};

const DB_URL_FOR_LOCK =
  process.env['SUPABASE_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/**
 * Short-lived rather than a module-level singleton, deliberately. A held connection would
 * have to be torn down by something, and an un-closed pg client keeps vitest's process
 * alive past the last test — trading a visible failure for a hang. One connection, taken
 * and dropped around a serialised section, is at most `workers` connections in flight
 * where the old shape was `workers × 8`.
 */
const withIdentityLock = async <T>(fn: () => Promise<T>): Promise<T> => {
  const { Client } = await import('pg');
  const lock = new Client({ connectionString: DB_URL_FOR_LOCK });
  await lock.connect();
  try {
    await lock.query('select pg_advisory_lock($1)', [IDENTITY_LOCK_KEY]);
    try {
      return await fn();
    } finally {
      await lock.query('select pg_advisory_unlock($1)', [IDENTITY_LOCK_KEY]);
    }
  } finally {
    try {
      await lock.end();
    } catch {
      // The lock is released by the backend when the connection drops, so a failure to
      // close cleanly cannot strand it.
    }
  }
};

export const createAuthUser = async (email: string, password: string): Promise<string> => {
  mintedThisFile += 1;
  if (mintedThisFile > IDENTITY_BUDGET_PER_FILE) {
    throw new Error(
      `identity budget exceeded: this spec file has asked GoTrue for ${String(mintedThisFile)} ` +
        `identities and the budget is ${String(IDENTITY_BUDGET_PER_FILE)} (one world per file, ` +
        `as seedFixtures() mints). Seed once in beforeAll and share it rather than seeding ` +
        `per test. This is a build failure ON PURPOSE: the alternative is GoTrue returning ` +
        `"Database error creating new user", which names neither connections nor the suite ` +
        `that caused it.`,
    );
  }

  return withIdentityLock(async () => {
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
  });
};

/**
 * Runs `fn` with the table owner's rights, then puts the previous role back.
 *
 * **MR-07 / BE-W78.** `authenticated` no longer holds an `INSERT` grant on
 * `consent_records` — the whole point of that change is that a client cannot write a
 * consent record without going through `capture_consent`. Test fixtures that need a
 * standing consent to exist are not clients, though: they are setting up a world, and
 * they run inside a transaction that has already switched to `authenticated` for the
 * assertion that follows.
 *
 * So they elevate explicitly, here, in one place with a name that says what it is —
 * rather than each spec quietly inserting as whatever role it happened to be holding.
 * The role is read back rather than assumed, because these helpers are called from
 * transactions running as several different users and restoring the wrong one would
 * silently change what the test afterwards proves.
 *
 * `request.jwt.claims` is untouched: `set local role` and the claims setting are
 * independent, so the identity the policies see is the same on the way out as on the
 * way in.
 */
export const asOwner = async <T>(client: Client, fn: () => Promise<T>): Promise<T> => {
  const before = await client.query<{ role: string }>('select current_user as role');
  const previous = before.rows[0]?.role ?? 'postgres';
  await client.query('set local role postgres');

  // **The savepoint is not decoration.** MR-08 used this helper to attempt writes that
  // are SUPPOSED to fail, and a failed statement aborts the transaction — so the role
  // restore below then failed with `25P02, current transaction is aborted`, and that is
  // the error the test saw instead of the `42501` it was asserting. Eight assertions
  // reported the wrong code for one missing savepoint.
  //
  // Rolling back to it leaves the transaction usable, so the caller's own error survives
  // to be asserted and the previous role really is restored.
  // ...and only where there IS a transaction to put one in. This helper is called both
  // inside `inRolledBackTransaction` and from `withClient`, which runs in autocommit --
  // where `savepoint` is `25P01, SAVEPOINT can only be used in transaction blocks` and
  // took out eight upload tests on the first attempt. Autocommit needs no savepoint
  // anyway: a failed statement there aborts nothing.
  let savepoint = false;
  try {
    await client.query('savepoint as_owner');
    savepoint = true;
  } catch {
    savepoint = false;
  }

  try {
    const result = await fn();
    if (savepoint) await client.query('release savepoint as_owner');
    return result;
  } catch (error) {
    if (savepoint) await client.query('rollback to savepoint as_owner');
    throw error;
  } finally {
    await client.query(`set local role ${previous}`);
  }
};
