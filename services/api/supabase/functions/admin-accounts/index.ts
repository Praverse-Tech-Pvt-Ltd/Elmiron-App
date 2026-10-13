/**
 * `BE-W186` — the console's account writer: creates a confirmed sign-in account with its profile,
 * and resets a password. The ONLY path from the console to GoTrue's admin API.
 *
 * **What this function decides: nothing about who.** It takes the caller's token, asks GoTrue whether
 * it is a live session (`getUser`), and then does every authorisation step as an RPC under that same
 * token — the database answers whether the caller is an active admin and whether the person described
 * may exist in their company (`20261013000200_console_user_admin`). Only after the database has said
 * yes does it use the account writer from `_shared/practice-writer.ts`, which is still the one place
 * the secret key is read (`check-service-role-reads.mjs`).
 *
 * The sequencing, and what is reported when one system succeeds and the other does not, is in
 * `_shared/account-requests.ts`, where vitest can reach it.
 *
 * **CORS.** The console calls this from the browser. The token rides in `Authorization`, never a
 * cookie, so allowing any origin hands nothing to a page that does not already hold the token.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { accountAdminFromEnv } from '../_shared/practice-writer.ts';
import { handleAccountRequest } from '../_shared/account-requests.ts';
import type { RpcResult } from '../_shared/account-requests.ts';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { code: 'method_not_allowed', message: 'POST only' });

  const authorization = req.headers.get('Authorization');
  if (authorization === null || !authorization.startsWith('Bearer ')) {
    return json(401, { code: '28000', message: 'no bearer token' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (supabaseUrl === undefined || anonKey === undefined) {
    return json(500, { code: 'misconfigured', message: 'SUPABASE_URL or SUPABASE_ANON_KEY unset' });
  }

  // The caller, as the caller: every RPC below runs under this token, so Postgres decides.
  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: sessionError } = await caller.auth.getUser(authorization.slice('Bearer '.length));
  if (sessionError !== null) {
    return json(401, { code: '28000', message: 'the session is not valid; sign in again' });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { code: '22023', message: 'body is not JSON' });
  }

  const rpc = async (fn: string, args: Readonly<Record<string, unknown>>): Promise<RpcResult> => {
    // deno-lint-ignore no-explicit-any
    const { data, error } = await caller.rpc(fn, args as any);
    if (error !== null) {
      return {
        data: null,
        error: { code: error.code, message: error.message, hint: error.hint ?? undefined },
      };
    }
    return { data, error: null };
  };

  const result = await handleAccountRequest(body, rpc, accountAdminFromEnv(supabaseUrl));
  return json(result.status, result.body);
});
