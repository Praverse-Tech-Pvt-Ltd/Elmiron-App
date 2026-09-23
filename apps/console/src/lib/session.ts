import { cookies } from 'next/headers';
import { createApiClient } from '@fieldforce/core';
import type { ApiClient } from '@fieldforce/core';
import { serverClient } from './supabase';

/**
 * MR-52 A1/A2 — the signed-in server, and the client every console page reads through.
 *
 * **One place builds the client, and it always carries the signed-in token.** Every page used to
 * call `createApiClient({ baseUrl, getAccessToken: () => Promise.resolve(null) })` against the mock
 * on `:4010` — no identity at all, so against the real server every RPC answered `28000 not
 * authenticated` (`FE-W66`). The base URL is now PostgREST's, and the token is the one in the
 * request's cookie.
 */
export interface SignedIn {
  readonly userId: string;
  readonly email: string;
  /** The contract-typed client: every RPC read and the override write. */
  readonly client: ApiClient;
  /** The same identity as `client`, for the one read that is a table and not an RPC. */
  readonly db: ReturnType<typeof serverClient>;
}

const restUrl = (): string => {
  const base = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  if (base === undefined || base === '') {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  }
  return `${base.replace(/\/+$/, '')}/rest/v1`;
};

/**
 * The signed-in user for THIS request, or null.
 *
 * `getUser()`, never `getSession()`: the session in a cookie is whatever the browser sent, and
 * `getUser` is the call that asks the auth server whether the token is genuine and still live. The
 * difference matters here because the answer gates a page.
 */
export const signedIn = async (): Promise<SignedIn | null> => {
  const store = await cookies();
  const supabase = serverClient({
    getAll: () => store.getAll(),
    setAll: (written) => {
      try {
        for (const { name, value, options } of written) store.set(name, value, options);
      } catch {
        // A Server Component may not write cookies. The middleware refreshes them on the next
        // request, which is why this is swallowed rather than surfaced.
      }
    },
  });
  // `getUser` types its answer as a union: an error, or a user. There is no third state, so a
  // second null check on `data.user` is unreachable rather than defensive.
  const { data, error } = await supabase.auth.getUser();
  if (error !== null) return null;

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token ?? null;
  if (token === null) return null;

  return {
    userId: data.user.id,
    email: data.user.email ?? '',
    client: createApiClient({ baseUrl: restUrl(), getAccessToken: () => token }),
    db: supabase,
  };
};
