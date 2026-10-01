/**
 * W1-B C1 — the one place an Edge Function reaches into `@fieldforce/core`.
 *
 * **Why this file exists rather than each function importing core directly.** The path below is
 * long, relative, and reaches out of the functions directory into a workspace package's BUILT
 * output. That is a real constraint worth stating once instead of repeating in every function:
 *
 * * **It is `dist`, not `src`.** `packages/core/src` imports its neighbours as `'../ai.js'` —
 *   TypeScript's NodeNext convention, where a `.js` specifier resolves to the `.ts` file. Deno
 *   does not do that rewriting, so importing the source fails on the first relative import.
 *   `dist` contains real `.js` files with the same specifiers, which Deno resolves directly.
 * * **So `pnpm --filter @fieldforce/core build` must have run.** `dist/` is gitignored
 *   (`.gitignore:6`), so a fresh clone has none and the function will not serve until it is built.
 *   CI's function step builds first for exactly this reason (W1-B C5), and the failure if it does
 *   not is a module-not-found at serve time, not a wrong answer at request time.
 * * **`zod` is a bare specifier in that output.** `deno.json`'s import map maps it to an `npm:`
 *   specifier pinned to the version `packages/core/package.json` declares.
 *
 * **Nothing is re-implemented here. This file only re-exports**, so there is exactly one copy of
 * the `product_qa` flow in the repository and it is the one with 35 tests over it.
 */

export {
  PRODUCT_QA_FAILED_MESSAGE,
  answerProductQuestion,
} from '../../../../../packages/core/dist/field/gateway/product-qa.js';

export { KNOWLEDGE_NOT_AVAILABLE_MESSAGE } from '../../../../../packages/core/dist/field/knowledge.js';

// W1-P C (`BE-W128`): the allowance every 200 response carries. A type only -- the gateway builds it
// from `ai_begin_request`'s own figures, and the contract is where its shape lives.
export type { AiAllowance } from '../../../../../packages/core/dist/field/ai.js';

export { PATIENT_SPECIFIC_REFUSAL_MESSAGE } from '../../../../../packages/core/dist/field/gateway/guardrails.js';

// W1-I Part B -- `mr_chat`, from the same built output. Its out-of-scope redirect is exported too,
// because the gateway does not compose refusal text: one copy of the sentence, in the contract.
export {
  MR_CHAT_FAILED_MESSAGE,
  MR_CHAT_OUT_OF_SCOPE_MESSAGE,
  answerMrChat,
} from '../../../../../packages/core/dist/field/gateway/mr-chat.js';

// W1-K Part B -- `lms_tutor`, from the same built output. Its referral sentence is exported too:
// the gateway does not compose refusal text, so there is one copy of it, in the contract.
export {
  LMS_TUTOR_FAILED_MESSAGE,
  LMS_TUTOR_NOT_IN_LESSON_MESSAGE,
  answerLessonQuestion,
} from '../../../../../packages/core/dist/field/gateway/lms-tutor.js';

// W1-D B4 -- `ai_doctor` and `ai_coach`, from the same built output and the same interfaces.
export {
  analyseSimSession,
  takeDoctorTurn,
} from '../../../../../packages/core/dist/field/gateway/sim-doctor.js';

export type {
  ControlPlaneRpc,
  LlmGenerateRequest,
  LlmProvider,
  LlmResult,
} from '../../../../../packages/core/dist/field/gateway/providers.js';
