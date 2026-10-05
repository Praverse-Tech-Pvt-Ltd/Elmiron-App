// deno-lint-ignore-file no-explicit-any
/**
 * W1-B C1 â€” the AI gateway, as a Supabase Edge Function. `C30` (register `#4` / `D1`).
 *
 * **THE ONE PROPERTY THIS FILE EXISTS TO PRESERVE: it calls the control plane as the USER'S
 * TOKEN, never as a service role, so Postgres keeps every authorisation decision.**
 *
 * `.ai-collab/constraints.md` â€” *"RLS is the enforcement layer, never application code."* A
 * gateway holding `SUPABASE_SERVICE_ROLE_KEY` and calling `ai_begin_request` with it would work,
 * would pass a happy-path test, and would have moved the feature flag, the daily allowance, the
 * organisation boundary and the approved-prompt check out of the database into this file.
 *
 * **What this file USED to say, and why it is no longer true.** Until W1-Z it said the service-role
 * key was "not read here at all — there is no reference to it, so it cannot be reached for later by
 * someone fixing a 401 in a hurry." That was `C30`'s real guarantee: not a rule, an ABSENCE. `BE-C69`
 * (W1-Z) spent it — the practice writes must come from the gateway, not the rep (`BE-W144`), so the key
 * is now in this process. **The absence is gone and nothing can bring it back while that is true.**
 *
 * **What replaces it (`BE-C70`, W2-A).** The key is read in exactly ONE place —
 * `_shared/practice-writer.ts` — which exports one function returning a writer for exactly two
 * functions (`record_sim_turn`, `record_sim_coach_analysis`), never the key or the client. This file
 * does not name the key. `services/api/scripts/check-service-role-reads.mjs` fails CI if a second read
 * appears anywhere under `supabase/functions`, or any read of the whole environment or of a name that is
 * not spelled out. Every authorisation decision still runs as the rep.
 *
 * **The gateway is deliberately dumb (`C30`).** It:
 *
 *   1. takes the caller's `Authorization` header and passes it through, unexamined;
 *   2. supplies an `LlmProvider`;
 *   3. calls `answerProductQuestion` from `@fieldforce/core`, which is the flow;
 *   4. maps the result to HTTP.
 *
 * It decides nothing else. It **cannot grant anything the database would refuse**, because it asks
 * the database as the user and returns what it is told.
 *
 * **Why the flow is imported rather than written here.** `answerProductQuestion` is 140 lines with
 * 35 tests over it (`packages/core/src/field/gateway/product-qa.test.ts`), including the order of
 * the steps â€” guardrail before search, search before model, citation check before answer. A second
 * copy of that order living in Deno would be a second set of guarantees nobody could keep aligned,
 * which is the failure `nav.tsx` and `outbox.ts` both have comments about. **This function adds a
 * transport; it does not add a flow.**
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  PRODUCT_QA_FAILED_MESSAGE,
  analyseSimSession,
  answerLessonQuestion,
  answerMrChat,
  answerProductQuestion,
  takeDoctorTurn,
} from '../_shared/core.ts';
import type { AiAllowance, ControlPlaneRpc, LlmProvider } from '../_shared/core.ts';
import { createStubProvider, stubProviderRefusal } from '../_shared/stub-provider.ts';
import { INDIA_PROFILES, createBedrockProvider } from '../_shared/bedrock-provider.ts';
import type { IndiaProfileId } from '../_shared/bedrock-provider.ts';
import { bedrockConverse } from '../_shared/bedrock-client.ts';
import { practiceWriterFromEnv } from '../_shared/practice-writer.ts';
import type { StubShape } from '../_shared/stub-provider.ts';

/**
 * W1-D B4 — the gateway now serves three features, and it is still ONE function.
 *
 * **No second Edge Function, no second upload path, no second mechanism.** `feature` selects a flow;
 * everything around it — the caller's token passed through unparsed, the absence of any service-role
 * key, the SQLSTATE mapping — is shared, so a property proved once holds for all three. A second
 * function would have been a second place for the token handling to drift, and the token handling is
 * the whole security model.
 */
type Feature = 'product_qa' | 'mr_chat' | 'lms_tutor' | 'ai_doctor' | 'ai_coach';

interface RequestBody {
  /** Defaults to `product_qa` so the W1-B contract is unchanged for existing callers. */
  readonly feature?: unknown;
  readonly question?: unknown;
  readonly marketId?: unknown;
  readonly productId?: unknown;
  // mr_chat
  readonly message?: unknown;
  // lms_tutor
  readonly lessonId?: unknown;
  // ai_doctor / ai_coach — only these two. Since W1-R the persona, scenario and turns are the
  // server's (`sim_session_context`); fields a client still sends for them are not read.
  readonly sessionId?: unknown;
  readonly repText?: unknown;
  // Read only to REFUSE it: `mr_chat` is single-turn since W1-S (`BE-W135`), and a non-empty
  // history is a 400 rather than something silently dropped.
  readonly history?: unknown;
}

/**
 * W1-V A — which India profile answers each feature, as decided (`docs/ai-platform/AI-SPEC.md`:
 * Sonnet 5 for reasoning-heavy work; Haiku 4.5 for `mr_chat` and `lms_tutor`, `BE-C41`).
 */
const BEDROCK_PROFILE: Record<Feature, IndiaProfileId> = {
  product_qa: INDIA_PROFILES.sonnet,
  ai_doctor: INDIA_PROFILES.sonnet,
  ai_coach: INDIA_PROFILES.sonnet,
  mr_chat: INDIA_PROFILES.haiku,
  lms_tutor: INDIA_PROFILES.haiku,
};

const STUB_SHAPE: Record<Feature, StubShape> = {
  product_qa: 'product_qa',
  // W1-I: its OWN shape, not product_qa's. The spec's rule is that modes must not silently behave
  // as one another, and sharing a stub shape is how two features start being one.
  mr_chat: 'mr_chat',
  // W1-K: its OWN shape. Four features, four output schemas, no sharing.
  lms_tutor: 'lms_tutor',
  ai_doctor: 'sim_doctor',
  ai_coach: 'sim_coach',
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * A refusal raised by an RPC arrives as a PostgREST error object, and the SQLSTATE is in `code`.
 * The gateway does not interpret it â€” `45011` and `45012` are the database's sentences and the
 * client maps them with `refusalForSqlState`. Re-wording them here would put a second copy of the
 * refusal vocabulary in a third place.
 */
const sqlstateOf = (error: unknown): string | null => {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
};

/**
 * The allowance on a 429, from `45012`'s DETAIL (`20261001000400`). Null if the detail is absent or
 * not the expected JSON — an older database, say — so the client shows nothing rather than a guess.
 */
const limitReached = (error: unknown): AiAllowance | null => {
  try {
    const d = JSON.parse(String((error as { details?: unknown }).details)) as Record<
      string,
      unknown
    >;
    if (typeof d['resetsAt'] !== 'string') return null;
    return {
      requestsUsedToday: Number(d['requestsUsedToday']),
      dailyLimit: Number(d['dailyLimit']),
      warning: true,
      resetsAt: d['resetsAt'],
    };
  } catch {
    return null;
  }
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  // The caller's token, passed through and never parsed. The gateway does not read the JWT's
  // claims: whether this user may run this feature is `ai_begin_request`'s answer, not ours.
  const authorization = req.headers.get('Authorization');
  if (authorization === null || !authorization.startsWith('Bearer ')) {
    // 28000 is the contract's `not_authenticated`, and the client already maps it.
    return json(401, { code: '28000', message: 'no bearer token' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (supabaseUrl === undefined || anonKey === undefined) {
    return json(500, { code: 'misconfigured', message: 'SUPABASE_URL or SUPABASE_ANON_KEY unset' });
  }

  // The anon key identifies the PROJECT; the Authorization header identifies the USER, and
  // PostgREST runs the request as that user. This is the line that keeps Postgres in charge.
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return json(400, { code: '22023', message: 'body is not JSON' });
  }
  const rawFeature = typeof body.feature === 'string' ? body.feature : 'product_qa';
  if (
    rawFeature !== 'product_qa' &&
    rawFeature !== 'mr_chat' &&
    rawFeature !== 'lms_tutor' &&
    rawFeature !== 'ai_doctor' &&
    rawFeature !== 'ai_coach'
  ) {
    // An unknown feature is refused here rather than passed to `ai_begin_request`, which would
    // refuse it too -- but with a message about a feature flag, which would send whoever typoed it
    // looking in `app_thresholds` for a row that was never the problem.
    return json(400, { code: '22023', message: `unknown feature ${rawFeature}` });
  }
  const feature: Feature = rawFeature;

  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (feature === 'product_qa' && question.length === 0) {
    return json(400, { code: '22023', message: 'question is required' });
  }
  if (feature === 'ai_doctor') {
    if (typeof body.sessionId !== 'string' || String(body.repText ?? '').trim().length === 0) {
      return json(400, { code: '22023', message: 'sessionId and repText are required' });
    }
  }
  if (feature === 'mr_chat' && typeof body.message !== 'string') {
    return json(400, { code: '22023', message: 'mr_chat needs a message' });
  }
  // W1-S C (`BE-W135` CLOSED). `mr_chat` is single-turn: nothing stores a chat, so an earlier
  // "assistant" turn could only ever be the client's word. A client that sends one is TOLD, here,
  // before any request is counted — not silently answered as though its history had been read.
  if (
    feature === 'mr_chat' &&
    body.history !== undefined &&
    !(Array.isArray(body.history) && body.history.length === 0)
  ) {
    return json(400, {
      code: '22023',
      message: 'mr_chat is single-turn: send only the message, no history',
    });
  }
  if (
    feature === 'lms_tutor' &&
    (typeof body.lessonId !== 'string' || typeof body.question !== 'string')
  ) {
    return json(400, { code: '22023', message: 'lms_tutor needs a lessonId and a question' });
  }
  if (feature === 'ai_coach' && typeof body.sessionId !== 'string') {
    return json(400, { code: '22023', message: 'sessionId is required' });
  }

  // W1-P C (`BE-W128`). The rep's allowance, captured from `ai_begin_request`'s own reply as it
  // passes through here -- every flow calls it first, so no flow had to change, and the figures are
  // the database's, not recomputed. Attached to every 200 below; null if the request never began.
  let allowance: AiAllowance | null = null;
  const withAllowance = (result: unknown): Response =>
    json(200, { ...(result as Record<string, unknown>), allowance });

  const rpc: ControlPlaneRpc = {
    call: async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
      const { data, error } = await supabase.rpc(fn, args as any);
      if (error !== null) {
        // Rethrown with the SQLSTATE on `code`, which is the shape `answerProductQuestion`
        // expects and the shape the database tests already produce through `pg`.
        const wrapped = new Error(error.message) as Error & { code?: string; details?: string };
        wrapped.code = (error as { code?: string }).code;
        wrapped.details = (error as { details?: string }).details;
        throw wrapped;
      }
      if (fn === 'ai_begin_request' && typeof data === 'object' && data !== null) {
        const begun = data as Record<string, unknown>;
        allowance = {
          requestsUsedToday: Number(begun['requestsUsedToday']),
          dailyLimit: Number(begun['dailyLimit']),
          warning: begun['allowanceWarning'] === true,
          resetsAt: String(begun['allowanceResetsAt']),
        };
      }
      return data;
    },
  };

  // THE construction line (`KEY-DAY-CHECKLIST.md` D1 §1). Bedrock only when the deployment says so
  // EXPLICITLY (`AI_PROVIDER=bedrock`, an Edge Function secret); otherwise the stub, which refuses
  // any non-local target. Local runs and CI therefore keep the stub even where a key file exists —
  // the HTTP suites drive stub behaviour, and a real model would turn them red for no defect.
  let provider: LlmProvider;
  try {
    provider =
      Deno.env.get('AI_PROVIDER') === 'bedrock'
        ? createBedrockProvider({
            region: Deno.env.get('AWS_REGION'),
            profileId: BEDROCK_PROFILE[feature],
            converse: bedrockConverse({
              accessKeyId: Deno.env.get('AWS_ACCESS_KEY_ID'),
              secretAccessKey: Deno.env.get('AWS_SECRET_ACCESS_KEY'),
            }),
          })
        : createStubProvider(STUB_SHAPE[feature]);
  } catch (error) {
    // The stub refuses to exist outside a local target (`C2`). That is a deployment-shaped
    // refusal, not a user-shaped one, and it must not read as "the assistant is busy".
    return json(503, {
      code: 'no_provider',
      message: error instanceof Error ? error.message : stubProviderRefusal,
    });
  }

  try {
    if (feature === 'ai_doctor' || feature === 'ai_coach') {
      // W1-Z A (`BE-C69`) / W2-A (`BE-C70`): the practice paths write turns and scores through the
      // service-role writer. This file never names the key; the writer module reads it.
      const writer = practiceWriterFromEnv(supabaseUrl);
      if (writer === null) {
        return json(500, {
          code: 'misconfigured',
          message: 'the practice writer is not configured',
        });
      }
      if (feature === 'ai_coach') {
        const result = await analyseSimSession({
          rpc,
          writer,
          provider,
          sessionId: String(body.sessionId),
          // W1-R C (`BE-W136`): the STORED conversation is analysed; body turns are ignored.
        });
        return withAllowance(result);
      }
      const result = await takeDoctorTurn({
        rpc,
        writer,
        provider,
        sessionId: String(body.sessionId),
        repText: String(body.repText),
        // W1-R C (`BE-W136`): persona, objection and history come from `sim_session_context`. A
        // client that still sends them is not refused — it is ignored.
      });
      return withAllowance(result);
    }
    if (feature === 'mr_chat') {
      const result = await answerMrChat({
        rpc,
        provider,
        message: String(body.message),
      });
      return withAllowance(result);
    }
    if (feature === 'lms_tutor') {
      const result = await answerLessonQuestion({
        rpc,
        provider,
        lessonId: String(body.lessonId),
        question: String(body.question),
      });
      return withAllowance(result);
    }
    const result = await answerProductQuestion({
      rpc,
      provider,
      question,
      marketId: typeof body.marketId === 'string' ? body.marketId : null,
      productId: typeof body.productId === 'string' ? body.productId : null,
    });
    return withAllowance(result);
  } catch (error) {
    const code = sqlstateOf(error);
    if (code === '45011') return json(403, { code, message: 'ai feature disabled' });
    if (code === '45012') {
      // W1-Q E2 (frontend `FE-CR-6`). The refusal's DETAIL carries the database's own figures and
      // reset instant; the rep at the limit is the one who most needs to know when it resets.
      return json(429, { code, message: 'ai daily limit reached', allowance: limitReached(error) });
    }
    if (code !== null) return json(403, { code, message: (error as Error).message });
    return json(500, { code: 'gateway_error', message: PRODUCT_QA_FAILED_MESSAGE });
  }
});
