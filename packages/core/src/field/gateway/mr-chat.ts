import { z } from 'zod';
import { AiBeginRequestResponseSchema } from '../ai.js';
import type { AiRequestFlag } from '../ai.js';
import { PATIENT_SPECIFIC_REFUSAL_MESSAGE, detectPatientSignals } from './guardrails.js';
import { ProviderTimeoutError, generateStructured, withTimeout } from './providers.js';
import type { ControlPlaneRpc, LlmProvider, LlmResult } from './providers.js';

/**
 * `mr_chat` — the general in-app assistant for a rep. W1-I Part B.
 *
 * **What the spec says it is, and the line that shapes every decision below.** `AI-SPEC.md` §2 A1:
 * *"A general assistant for a rep inside the app: how a process works, where to find a screen, what
 * a policy says. **It is not a product-information tool** — a product question must go through
 * Product Q&A, which is constrained to approved material."*
 *
 * So `mr_chat` cannot be restricted to approved knowledge the way `product_qa` is — approved
 * knowledge is product material, and a chat restricted to it could not answer *"how do I file a call
 * report"*, which is the whole point. **That leaves a free-text assistant, which is the most
 * dangerous thing in this system, and the question of what stops it inventing a product or medical
 * claim is not answered by its prompt.**
 *
 * ## What actually stops an invented claim — read this before changing anything here
 *
 * **A prompt is not a control.** The system prompt asks the model to stay in scope and that request
 * is worth exactly what the model chooses to do with it. The controls are these, and all three are
 * code:
 *
 * 1. **`detectPatientSignals` on the question, before anything leaves the building.** The spec calls
 *    this *"the capability where it matters most — a general chat box is the one an MR is most likely
 *    to type a real situation into"*, and the master prompt's §10 warning that the chatbot *"must not
 *    become a clinical decision-support system"* has this as its only enforcement.
 * 2. **A catalogue-derived product-name check on the QUESTION.** If the rep's message names one of
 *    their own organisation's products, the model is **never called** and the rep is sent to Product
 *    Q&A. The terms come from `mr_chat_scope_terms()`, which reads `products` under RLS — so they are
 *    that tenant's real catalogue, not a list somebody typed here.
 * 3. **The same check on the ANSWER, which is the one that matters.** A reply naming a product is
 *    **discarded** and replaced with the redirect. This is the half a prompt cannot provide: it does
 *    not ask the model to behave, it refuses to pass on the result when it did not.
 *
 * **`inScope` in the output is the model's own declaration and is treated as a HINT.** It is honoured
 * when false (a model saying "I should not answer this" is useful) and never trusted when true — the
 * catalogue check runs regardless. A control that asks the thing being controlled whether it complied
 * is not a control.
 *
 * ## The residual risk, stated plainly because it is real
 *
 * **A medical or regulatory claim that names no product would pass all three checks.** *"Is 400mg
 * twice daily normal for interstitial cystitis?"* names no brand, carries no patient identifier, and
 * would reach the model. Nothing in this file stops the model answering it.
 *
 * That is not an oversight; it is the cost of having a general assistant at all, and the honest
 * options are: accept it, or delete `mr_chat` and tell reps to use Product Q&A for everything. **It
 * is recorded in `docs/blocked-on-you.md` as a decision rather than mitigated with prompt wording
 * that would only look like a fix.**
 *
 * ## The order of the steps is the design, as in `product-qa.ts`
 *
 * 1. `ai_begin_request` — the database decides whether this feature may run (its **own** flag, its
 *    **own** approved prompt, the shared allowance) and hands back the prompt.
 * 2. The patient guardrail. No provider call, no text stored, closed as `blocked`.
 * 3. The catalogue terms, then the question-side product check. Still no provider call.
 * 4. The model.
 * 5. The answer-side product check. Fails closed.
 * 6. `ai_complete_request` — tokens and flags, never the message or the reply.
 */

/**
 * What the model must return.
 *
 * Deliberately NOT `product_qa`'s shape. `AI-SPEC` §2 A4 leaves the shape undesigned, and the spec's
 * own rule is that modes must not silently behave as one another — sharing an output schema name is
 * how two features start being one. There is no `citedChunkIds`, because there are no sources: a
 * citation field would invite the model to fabricate one.
 */
export const MrChatOutputSchema = z.object({
  /**
   * The model's own claim that the question is in scope. A hint, never the control — see the header.
   * Honoured when false, ignored when true.
   */
  inScope: z.boolean(),
  answer: z.string(),
});
export type MrChatOutput = z.infer<typeof MrChatOutputSchema>;
export const MR_CHAT_OUTPUT_SCHEMA_NAME = 'MrChatOutputSchema';

export type MrChatResult =
  | { readonly kind: 'answered'; readonly requestId: string; readonly answer: string }
  | { readonly kind: 'out_of_scope'; readonly requestId: string; readonly message: string }
  | { readonly kind: 'patient_specific'; readonly requestId: string; readonly message: string }
  | { readonly kind: 'failed'; readonly requestId: string; readonly message: string };

export interface MrChatInput {
  readonly rpc: ControlPlaneRpc;
  readonly provider: LlmProvider;
  readonly message: string;
  /** Earlier turns, oldest first. Trimmed by the caller; this does not decide a window. */
  readonly history?: readonly { readonly role: 'rep' | 'assistant'; readonly text: string }[];
  /** Default 20 seconds, matching `product_qa`. */
  readonly timeoutMs?: number;
}

export const MR_CHAT_FAILED_MESSAGE = 'The assistant could not answer just now. Please try again.';

export const MR_CHAT_OUT_OF_SCOPE_MESSAGE =
  'That looks like a product question. Use Product Q&A, which answers only from your company’s ' +
  'approved material and shows you where each answer came from.';

/** The shape of `mr_chat_scope_terms()`: the caller's own organisation's product names. */
export const MrChatScopeTermsResponseSchema = z.object({
  terms: z.array(z.string()),
});

/**
 * The fixed half of the system message: the contract with this code, not the organisation's voice.
 *
 * **It asks for scope discipline and that is not what enforces it.** The enforcement is the
 * catalogue check on the answer. This text exists so a cooperative model gives a better reply, not
 * so an uncooperative one is stopped.
 */
const OUTPUT_CONTRACT = [
  'You help a medical representative use their company app: how a process works, where to find a',
  'screen, what a policy says.',
  'You must NOT answer questions about medicines, products, doses, indications or clinical matters.',
  'For any of those, set "inScope" to false and leave "answer" empty.',
  'Never give advice about an individual patient.',
  'Reply with JSON only: {"inScope": boolean, "answer": string}.',
].join('\n');

const renderHistory = (
  history: readonly { readonly role: 'rep' | 'assistant'; readonly text: string }[],
): string => history.map((h) => `${h.role === 'rep' ? 'Rep' : 'Assistant'}: ${h.text}`).join('\n');

/**
 * Does `text` name one of the organisation's products?
 *
 * Word-boundary matching, case-insensitive, and each term is escaped — a brand name containing a
 * regex metacharacter must not become a pattern. **Terms shorter than three characters are ignored**:
 * a two-letter brand would match inside ordinary words and make the assistant refuse everything,
 * which is a different failure and not a safer one.
 */
/**
 * W1-J Part B — the clinical-question control, and why it needs two halves rather than a word list.
 *
 * **The gap it closes.** W1-I recorded a residual with an example: *"is 400mg twice daily normal for
 * interstitial cystitis?"* names no product, carries no patient identifier, and reached the model.
 * `AI-SPEC` §10 says `mr_chat` *"must not become a clinical decision-support system"* and nothing
 * enforced it. **A prompt instruction was never among the options** — the session that built this
 * feature established that its prompt stops nothing.
 *
 * **Why a term list alone would be worse than nothing.** These are all legitimate and all contain a
 * clinical word:
 *
 *   "how do I report an adverse event"
 *   "what do I do if a doctor asks about dosing"
 *   "the doctor asked about contraindications, what is the process"
 *
 * A rep who cannot ask those has lost the assistant's main use, and **a guardrail that blocks the
 * product gets switched off** — the same argument that made `PATIENT_COMPOUND_WORDS` necessary next
 * door. So a clinical term only counts when the question is **not** framed as a procedure.
 */
const CLINICAL_TERMS =
  /\b(?:dose|doses|dosing|dosage|contraindicat\w*|indicat(?:ion|ions|ed)|pregnan\w*|lactation|breastfeed\w*|half[\s-]?life|interaction|interactions|titrat\w*|renal|hepatic|efficacy|pharmacokinetic\w*|posology|overdose|paediatric|pediatric|geriatric)\b/iu;

/**
 * A dosage amount — `400mg`, `20 mcg`, `5ml`.
 *
 * **Separate from `CLINICAL_TERMS`, and the reason is a bug the corpus caught.** The unit was first
 * written inside that alternation as `\bmg\b`, which never matches `400mg`: there is no word boundary
 * between a digit and a letter, so the very example W1-I recorded as the residual —
 * *"is 400mg twice daily normal for interstitial cystitis?"* — still passed. The number is what
 * creates the boundary, so the digits have to be part of the pattern.
 */
const DOSAGE_AMOUNT = /\b\d+(?:\.\d+)?\s?(?:mg|mcg|ml|g)\b/iu;

/**
 * A procedural frame: the question is about how to USE THE APP or follow a process, not about a
 * medicine. Its presence suppresses the clinical-term rule.
 */
const PROCEDURAL_FRAME =
  /\b(?:how\s+(?:do|does|can|should)\s+(?:i|we|you)|how\s+to\b|what\s+do\s+i\s+do|what\s+is\s+the\s+(?:process|procedure|workflow|sop)|where\s+do\s+i|who\s+do\s+i|process\s+for|procedure\s+for|escalat\w*|report\s+(?:an|a)\b|log\s+(?:an|a)\b|record\s+(?:an|a)\b|file\s+(?:an|a)\b)/iu;

/**
 * Is this a clinical question rather than a question about the app?
 *
 * **Used on BOTH the question and the answer**, exactly as the catalogue check is — and for the same
 * reason. The question side stops the obvious ask before a model is paid for it; **the answer side is
 * the one that matters**, because it catches an invented clinical claim regardless of how the
 * question was phrased, and no rephrasing gets around it.
 *
 * On the answer side the procedural suppressor still applies: a reply explaining *how to escalate a
 * dosing question* is exactly what this feature should say.
 */
export const isClinicalQuestion = (text: string): boolean =>
  (CLINICAL_TERMS.test(text) || DOSAGE_AMOUNT.test(text)) && !PROCEDURAL_FRAME.test(text);

export const namesAProduct = (text: string, terms: readonly string[]): string | null => {
  const haystack = text.toLowerCase();
  for (const term of terms) {
    const t = term.trim().toLowerCase();
    if (t.length < 3) continue;
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`, 'u').test(haystack)) return term;
  }
  return null;
};

export const answerMrChat = async (input: MrChatInput): Promise<MrChatResult> => {
  const { rpc, provider } = input;
  const message = input.message.trim();
  if (message.length === 0) throw new Error('answerMrChat: empty message');

  // 1. May this run at all? `mr_chat` has its OWN flag and its OWN approved prompt; a refusal
  //    propagates with its SQLSTATE (45011 / 45012).
  const begun = AiBeginRequestResponseSchema.parse(
    await rpc.call('ai_begin_request', { p_feature: 'mr_chat' }),
  );
  const requestId = begun.requestId;

  const complete = async (args: {
    status: 'completed' | 'failed' | 'blocked';
    raw?: LlmResult;
    flags?: readonly AiRequestFlag[];
    errorCode?: string;
  }): Promise<void> => {
    await rpc.call('ai_complete_request', {
      p_request_id: requestId,
      p_status: args.status,
      p_model_provider: args.raw?.provider ?? null,
      p_model_name: args.raw?.model ?? null,
      p_input_tokens: args.raw?.usage.inputTokens ?? null,
      p_output_tokens: args.raw?.usage.outputTokens ?? null,
      p_knowledge_version_ids: [],
      p_flags: args.flags ?? [],
      p_error_code: args.errorCode ?? null,
    });
  };

  // A prompt approved for another output shape would make every reply fail validation. Refuse
  // loudly rather than silently returning the failure message forever.
  if (begun.outputSchemaName !== MR_CHAT_OUTPUT_SCHEMA_NAME) {
    await complete({ status: 'failed', errorCode: 'prompt_schema_mismatch' });
    return { kind: 'failed', requestId, message: MR_CHAT_FAILED_MESSAGE };
  }

  // 2. The patient guardrail, BEFORE any provider call. Nothing is searched, nothing is sent.
  //
  // W1-Q E1 (`BE-W135`): over the HISTORY too. It is the client's account of earlier turns and is
  // sent to the model verbatim, so a screened message beside an unscreened history screened nothing.
  const signals = [
    ...detectPatientSignals(message),
    ...(input.history ?? []).flatMap((h) => detectPatientSignals(h.text)),
  ];
  if (signals.length > 0) {
    const onlyAdvice = signals.every((s) => s === 'patient_specific_advice');
    await complete({
      status: 'blocked',
      flags: onlyAdvice ? ['guardrail_triggered'] : ['patient_identifier_detected'],
    });
    return { kind: 'patient_specific', requestId, message: PATIENT_SPECIFIC_REFUSAL_MESSAGE };
  }

  // 3. The catalogue, then the question-side check. Also before any provider call.
  const { terms } = MrChatScopeTermsResponseSchema.parse(await rpc.call('mr_chat_scope_terms', {}));
  if (namesAProduct(message, terms) !== null) {
    await complete({ status: 'blocked', flags: ['off_label_request'] });
    return { kind: 'out_of_scope', requestId, message: MR_CHAT_OUT_OF_SCOPE_MESSAGE };
  }

  // W1-J Part B. A clinical question with no procedural framing, whether or not it names a product.
  // This is the half W1-I recorded as a residual: "is 400mg twice daily normal for interstitial
  // cystitis?" names nothing in the catalogue and used to reach the model.
  if (isClinicalQuestion(message)) {
    await complete({ status: 'blocked', flags: ['off_label_request'] });
    return { kind: 'out_of_scope', requestId, message: MR_CHAT_OUT_OF_SCOPE_MESSAGE };
  }

  // 4. The model. No sources: this feature has none by design.
  let structured;
  try {
    structured = await withTimeout(input.timeoutMs ?? 20_000, (signal) =>
      generateStructured(provider, MrChatOutputSchema, {
        messages: [
          { role: 'system', content: `${begun.systemPrompt}\n\n${OUTPUT_CONTRACT}` },
          {
            role: 'user',
            content:
              (input.history === undefined || input.history.length === 0
                ? ''
                : `Earlier in this conversation:\n${renderHistory(input.history)}\n\n`) + message,
          },
        ],
        modelConfig: begun.modelConfig,
        signal,
      }),
    );
  } catch (error) {
    const timedOut = error instanceof ProviderTimeoutError;
    await complete({
      status: 'failed',
      flags: [timedOut ? 'provider_timeout' : 'provider_error'],
      errorCode: timedOut ? 'provider_timeout' : 'provider_error',
    });
    return { kind: 'failed', requestId, message: MR_CHAT_FAILED_MESSAGE };
  }

  if (!structured.ok) {
    await complete({
      status: 'failed',
      raw: structured.raw,
      flags: ['schema_invalid'],
      errorCode: structured.reason,
    });
    return { kind: 'failed', requestId, message: MR_CHAT_FAILED_MESSAGE };
  }
  const out = structured.value;

  // The model's own refusal, honoured. `inScope: true` is NOT honoured — see step 5.
  if (!out.inScope || out.answer.trim().length === 0) {
    await complete({ status: 'completed', raw: structured.raw, flags: ['off_label_request'] });
    return { kind: 'out_of_scope', requestId, message: MR_CHAT_OUT_OF_SCOPE_MESSAGE };
  }

  // 5. THE CONTROL: the answer is checked against the catalogue and DISCARDED if it names a
  //    product, whatever the model said about scope. Fails closed.
  if (namesAProduct(out.answer, terms) !== null || isClinicalQuestion(out.answer)) {
    await complete({
      status: 'completed',
      raw: structured.raw,
      flags: ['guardrail_triggered', 'off_label_request'],
    });
    return { kind: 'out_of_scope', requestId, message: MR_CHAT_OUT_OF_SCOPE_MESSAGE };
  }

  // 6. Tokens and flags. Never the message, never the reply.
  await complete({ status: 'completed', raw: structured.raw });
  return { kind: 'answered', requestId, answer: out.answer.trim() };
};
