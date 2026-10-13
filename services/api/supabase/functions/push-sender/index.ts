/**
 * `BE-W196` — the `push-sender` Edge Function: drains `notification_outbox` through FCM HTTP v1.
 *
 * **Who may run it — two callers, and nobody else:**
 *   1. the SCHEDULE (`.github/workflows/push-sender.yml`), which sends the header
 *      `x-push-sender-secret` equal to the function secret `PUSH_SENDER_CRON_SECRET` (32+ characters,
 *      compared in constant time); or
 *   2. an ADMIN, by hand: their own bearer token, checked by GoTrue (`getUser`) and then by the
 *      database AS THEM (`push_sender_authorise`, which refuses anyone else 42501 and writes an audit
 *      row).
 * Either way the run drains every company's due notifications -- what each says, and to whom, was
 * fixed by the database when it was raised (`20261013000410`), so the caller chooses nothing.
 *
 * **Deploy with `--no-verify-jwt`**: the scheduled caller holds no user token, and this function
 * authenticates every request itself (above). `docs/DEPLOY-RUNBOOK.md`.
 *
 * **Secrets.** `FCM_SERVICE_ACCOUNT` (the Firebase service-account JSON) is read here and nowhere else
 * in the repository; the outbox is reached through `pushOutboxFromEnv`, so the platform secret key is
 * still READ only in `_shared/practice-writer.ts` (`check-service-role-reads.mjs`). With either one
 * missing the answer is `{configured: false}` and nothing is claimed.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { pushOutboxFromEnv } from '../_shared/practice-writer.ts';
import { runPushSender, sameSecret } from '../_shared/push-sender.ts';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json(405, { code: 'method_not_allowed', message: 'POST only' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (supabaseUrl === undefined || anonKey === undefined) {
    return json(500, { code: 'misconfigured', message: 'SUPABASE_URL or SUPABASE_ANON_KEY unset' });
  }

  const scheduled = sameSecret(
    req.headers.get('x-push-sender-secret'),
    Deno.env.get('PUSH_SENDER_CRON_SECRET'),
  );
  if (!scheduled) {
    const authorization = req.headers.get('Authorization');
    if (authorization === null || !authorization.startsWith('Bearer ')) {
      return json(401, {
        code: '28000',
        message: 'an admin session or the schedule secret is required',
      });
    }
    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: sessionError } = await caller.auth.getUser(
      authorization.slice('Bearer '.length),
    );
    if (sessionError !== null) {
      return json(401, { code: '28000', message: 'the session is not valid; sign in again' });
    }
    const { error } = await caller.rpc('push_sender_authorise');
    if (error !== null) {
      return json(error.code === '42501' ? 403 : 400, { code: error.code, message: error.message });
    }
  }

  try {
    const result = await runPushSender({
      serviceAccountJson: Deno.env.get('FCM_SERVICE_ACCOUNT'),
      outbox: pushOutboxFromEnv(supabaseUrl),
      fetch: (input, init) => fetch(input, init),
      nowSeconds: Math.floor(Date.now() / 1000),
    });
    return json(200, result);
  } catch (error) {
    // A database refusal while claiming or recording. A claimed row that is never recorded becomes
    // claimable again after ten minutes (`push_claim_batch`), so it may be sent twice -- never lost.
    const e = error as { code?: string; message?: string };
    return json(500, { code: e.code ?? 'push_sender_failed', message: e.message ?? 'failed' });
  }
});
