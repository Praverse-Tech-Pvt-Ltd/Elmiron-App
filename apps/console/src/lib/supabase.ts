import { createBrowserClient, createServerClient } from '@supabase/ssr';
import type { CookieMethodsServer } from '@supabase/ssr';

/**
 * MR-52 A1 — `FE-W66`: the console signs in, on the SAME Supabase identity as the app.
 *
 * **No second identity system, and no second user table** (`D-14`). These are the same
 * `auth.users` rows `apps/field` signs in with, the same `user_profiles` row behind
 * `current_app_role()`, and the same JWT every RLS policy already reads. The console gains a way to
 * HOLD that identity in a browser; it gains no authority of its own.
 *
 * **Why `@supabase/ssr` and not `supabase-js` alone.** The console's pages are React Server
 * Components: they render on the server, where `localStorage` does not exist, so the browser
 * client's default session storage is unreachable. `@supabase/ssr` stores the session in cookies,
 * which is the only place both halves can read — the browser for signing in, the server for
 * rendering a page as that user.
 *
 * **Permission logic stays on the server.** Nothing here decides what a role may see. The token is
 * carried to PostgREST and the database's policies and `SECURITY DEFINER` functions decide, exactly
 * as they do for the app. The middleware's redirect is not permission logic: an unauthenticated
 * browser is refused by the server too (MR-52 A5), and the redirect only avoids rendering a shell
 * that could not load anything.
 */
const url = (): string => {
  const value = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  if (value === undefined || value === '') {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL is not set — the console has no server to sign in to',
    );
  }
  return value;
};

const publishableKey = (): string => {
  const value = process.env['NEXT_PUBLIC_SUPABASE_KEY'];
  if (value === undefined || value === '') {
    throw new Error('NEXT_PUBLIC_SUPABASE_KEY is not set — the console cannot reach Supabase');
  }
  return value;
};

/** The browser half: the sign-in form, and nothing else. */
export const browserClient = () => createBrowserClient(url(), publishableKey());

/**
 * The server half, built per request from that request's cookies.
 *
 * The caller supplies the library's own `getAll`/`setAll` pair, because the two callers adapt
 * different things: the middleware writes onto a response it owns, while a Server Component cannot
 * write cookies at all and must swallow the attempt (see `session.ts`).
 */
export const serverClient = (cookies: CookieMethodsServer) =>
  createServerClient(url(), publishableKey(), { cookies });
