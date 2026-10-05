/**
 * FE-D15 — a LOCAL MIRROR of the `mr_chat` contract on `worktree-ai-platform-phase-a`.
 *
 * **Temporary, and on purpose.** That branch is not merged, and this app must not import from it,
 * so these shapes are copied here from it rather than imported from `@fieldforce/core`. FE-CR-7 asks
 * backend to land them in `packages/core` on `main`. When it does, this file goes and the imports
 * move to core. Each shape names its source on the branch:
 *
 * - request: `services/api/supabase/functions/ai-gateway/index.ts:58-77, 162-163`;
 * - result: `packages/core/src/field/gateway/mr-chat.ts:86-90` (`MrChatResult`);
 * - 403 `45011` / 429 `45012`: `ai-gateway/index.ts:260-261`;
 * - 503 `no_provider`: `ai-gateway/index.ts:189-199`;
 * - the stub's marker: `services/api/supabase/functions/_shared/stub-provider.ts:79-80`.
 *
 * `allowance` on a result, and `resetsAt` on a 429, are NOT on the branch. They are the shape
 * FE-CR-6 proposes, read here only if present, so the app needs no change if backend accepts them.
 */

export const MR_CHAT_FEATURE = 'mr_chat';

/** What the app sends: the feature and the rep's own typed text. Nothing else. */
export interface ChatRequestBody {
  readonly feature: typeof MR_CHAT_FEATURE;
  readonly message: string;
}

export type MrChatResultBody =
  | { readonly kind: 'answered'; readonly requestId: string; readonly answer: string }
  | { readonly kind: 'out_of_scope'; readonly requestId: string; readonly message: string }
  | { readonly kind: 'patient_specific'; readonly requestId: string; readonly message: string }
  | { readonly kind: 'failed'; readonly requestId: string; readonly message: string };

/** FE-CR-6's proposed shape. Not yet sent by any server. */
export interface GatewayAllowance {
  readonly warning: boolean;
  readonly requestsUsedToday: number;
  readonly dailyLimit: number;
  readonly resetsAt: string | null;
}

/** The gateway's answer as the transport saw it: an HTTP status and a parsed JSON body. */
export interface GatewayResponse {
  readonly status: number;
  readonly body: unknown;
}

/**
 * Every reply the stub provider writes begins with this, by design: a stub must never read as an
 * answer. The app checks for it too, so a stub reply that ever reached `answered` is still shown
 * as "not available yet" and never as an answer.
 */
export const STUB_MARKER_PREFIX = '[PRACTICE STUB';
