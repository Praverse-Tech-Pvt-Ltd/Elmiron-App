import { z } from 'zod';
import { UuidSchema } from '../../shared/primitives.js';
import { AiBeginRequestResponseSchema } from '../ai.js';
import type { AiRequestFlag } from '../ai.js';
import { PATIENT_SPECIFIC_REFUSAL_MESSAGE, detectPatientSignals } from './guardrails.js';
import { isClinicalQuestion } from './mr-chat.js';
import { generateStructured, invalidOutput, providerFailure, withTimeout } from './providers.js';
import type { ControlPlaneRpc, LlmProvider, LlmResult } from './providers.js';

/**
 * `lms_tutor` — the learning tutor. W1-K Part B.
 *
 * `AI-SPEC` §3: *"A tutor inside a course that explains a lesson the learner did not follow."*
 *
 * ## B4 — what stops an invented claim, and here the answer is STRONGER than `mr_chat`'s
 *
 * **`mr_chat` is a general assistant with no sources**, so the best available control there was a
 * catalogue check that discards an answer naming a product — a refusal after the fact. **The tutor is
 * not in that position.** It has the lesson's own `body` in front of it: text the company wrote and
 * published through `course_versions`.
 *
 * **So the tutor IS restricted to the lesson's own content, and that is the control.** It is the same
 * shape `product_qa` uses, and it is the only shape that prevents invention rather than catching it:
 *
 * 1. **The model is given exactly one lesson and told to answer only from it.** No other lesson, no
 *    course tree, no approved-knowledge corpus, no web.
 * 2. **`groundedInLesson` is a required field of the output**, and an answer that sets it false is
 *    **discarded** and replaced with the referral sentence. The model must assert that the lesson
 *    covers the question.
 * 3. **`groundedInLesson: true` is NOT taken on trust.** The answer is additionally checked with
 *    `isClinicalQuestion` — so a tutor that wanders from "what does this module mean" into a dose is
 *    refused whatever it claimed about grounding. A control that asks the thing being controlled
 *    whether it complied is not a control; the clinical check is code.
 *
 * **Why not go further and require quoted spans?** Because it would be a false promise. Verifying
 * that an explanation is *supported* by a passage is the same problem as the explanation itself, and
 * a substring check would be trivially satisfied by quoting one word. `product_qa` can demand exact
 * chunk ids because its answer IS a retrieval; a tutor's answer is a restatement. **What is enforced
 * is what can be enforced: one source, a grounding flag that fails closed, and the clinical check.**
 *
 * ## Why the lesson is fetched BEFORE the model, and before the guardrails
 *
 * `lms_tutor_lesson_context` refuses `42501` unless the learner is **enrolled** on a **published**
 * course version. Fetching it first means an unauthorised lesson id costs no model call and no
 * guardrail work — and it means a missing function (a rollback) makes the feature unavailable rather
 * than unguarded.
 *
 * ## The guardrails are shared, not copied
 *
 * `detectPatientSignals` and `isClinicalQuestion` are the same implementations `product_qa`,
 * `mr_chat` and `ai_doctor` use, scored against `guardrails.corpus.ts`. **A learner asking a clinical
 * question of a training tutor is exactly the §10 risk** — *"must not become a clinical
 * decision-support system"* — and a course about a medicine is where it is most tempting.
 */

/**
 * What the model must return.
 *
 * **Its own schema name**, not `mr_chat`'s and not `product_qa`'s: the spec's rule is that modes must
 * not silently behave as one another, and a shared output schema name is how two features start
 * being one.
 */
export const LmsTutorOutputSchema = z.object({
  /**
   * The model's assertion that the LESSON answers the question. Fails closed: false means the
   * learner is referred on, and true is checked further by the clinical rule.
   */
  groundedInLesson: z.boolean(),
  explanation: z.string(),
});
export type LmsTutorOutput = z.infer<typeof LmsTutorOutputSchema>;
export const LMS_TUTOR_OUTPUT_SCHEMA_NAME = 'LmsTutorOutputSchema';

/** What `lms_tutor_lesson_context()` returns: one published lesson the learner is enrolled on. */
export const LmsTutorLessonContextSchema = z.object({
  lessonId: UuidSchema,
  lessonTitle: z.string(),
  lessonBody: z.string(),
  courseTitle: z.string(),
});

export type LmsTutorResult =
  | {
      readonly kind: 'explained';
      readonly requestId: string;
      readonly explanation: string;
      readonly lessonTitle: string;
    }
  | { readonly kind: 'not_in_lesson'; readonly requestId: string; readonly message: string }
  | { readonly kind: 'patient_specific'; readonly requestId: string; readonly message: string }
  | { readonly kind: 'failed'; readonly requestId: string; readonly message: string };

export interface LmsTutorInput {
  readonly rpc: ControlPlaneRpc;
  /**
   * W2-E C (`BE-W146`). The gateway's own connection (the service role), which alone may close the
   * request: `ai_gateway_complete_request` is granted to nobody else. `rpc` is the rep's.
   */
  readonly writer: ControlPlaneRpc;
  readonly provider: LlmProvider;
  readonly lessonId: string;
  readonly question: string;
  /** Default 20 seconds, matching every other flow. */
  readonly timeoutMs?: number;
}

export const LMS_TUTOR_FAILED_MESSAGE = 'The tutor could not answer just now. Please try again.';

export const LMS_TUTOR_NOT_IN_LESSON_MESSAGE =
  'This lesson does not cover that. Ask your training lead, or use Product Q&A for a question ' +
  'about a product — it answers only from your company’s approved material and shows its sources.';

/**
 * The fixed half of the system message: the contract with this code, not the organisation's voice.
 *
 * **Unlike `mr_chat`'s, this text is doing real work** — it names the single source and forbids
 * everything else, which is enforceable because the flow gives the model nothing else to use.
 */
export const LMS_TUTOR_OUTPUT_CONTRACT = [
  'You are helping a learner understand ONE lesson from their training course.',
  'Answer ONLY from the lesson text below. Do not use any other knowledge.',
  'If the lesson does not answer the question, set "groundedInLesson" to false and leave',
  '"explanation" empty.',
  'Never give advice about an individual patient, and never give clinical advice.',
  'Reply with JSON only: {"groundedInLesson": boolean, "explanation": string}.',
].join('\n');

export const answerLessonQuestion = async (input: LmsTutorInput): Promise<LmsTutorResult> => {
  const { rpc, provider } = input;
  const question = input.question.trim();
  if (question.length === 0) throw new Error('answerLessonQuestion: empty question');

  // 1. May this run at all? `lms_tutor` has its OWN flag and its OWN approved prompt.
  const begun = AiBeginRequestResponseSchema.parse(
    await rpc.call('ai_begin_request', { p_feature: 'lms_tutor' }),
  );
  const requestId = begun.requestId;

  const complete = async (args: {
    status: 'completed' | 'failed' | 'blocked';
    raw?: LlmResult;
    flags?: readonly AiRequestFlag[];
    errorCode?: string;
  }): Promise<void> => {
    await input.writer.call('ai_gateway_complete_request', {
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

  if (begun.outputSchemaName !== LMS_TUTOR_OUTPUT_SCHEMA_NAME) {
    await complete({ status: 'failed', errorCode: 'prompt_schema_mismatch' });
    return { kind: 'failed', requestId, message: LMS_TUTOR_FAILED_MESSAGE };
  }

  // 2. The guardrails, BEFORE any provider call. Shared implementations, not copies.
  const signals = detectPatientSignals(question);
  if (signals.length > 0) {
    const onlyAdvice = signals.every((s) => s === 'patient_specific_advice');
    await complete({
      status: 'blocked',
      flags: onlyAdvice ? ['guardrail_triggered'] : ['patient_identifier_detected'],
    });
    return { kind: 'patient_specific', requestId, message: PATIENT_SPECIFIC_REFUSAL_MESSAGE };
  }
  if (isClinicalQuestion(question)) {
    // A learner asking a dosing question of a training tutor is the §10 risk in its purest form.
    await complete({ status: 'blocked', flags: ['off_label_request'] });
    return { kind: 'not_in_lesson', requestId, message: LMS_TUTOR_NOT_IN_LESSON_MESSAGE };
  }

  // 3. The lesson. Refuses 42501 unless the learner is ENROLLED on a PUBLISHED version, so an
  //    unauthorised lesson id costs no model call.
  const lesson = LmsTutorLessonContextSchema.parse(
    await rpc.call('lms_tutor_lesson_context', { p_lesson_id: input.lessonId }),
  );

  // 4. The model, given ONE lesson and nothing else.
  let structured;
  try {
    structured = await withTimeout(input.timeoutMs ?? 20_000, (signal) =>
      generateStructured(provider, LmsTutorOutputSchema, {
        messages: [
          { role: 'system', content: `${begun.systemPrompt}\n\n${LMS_TUTOR_OUTPUT_CONTRACT}` },
          {
            role: 'user',
            content:
              `Course: ${lesson.courseTitle}\nLesson: ${lesson.lessonTitle}\n\n` +
              `${lesson.lessonBody}\n\nQuestion: ${question}`,
          },
        ],
        modelConfig: begun.modelConfig,
        signal,
      }),
    );
  } catch (error) {
    await complete({ status: 'failed', ...providerFailure(error) });
    return { kind: 'failed', requestId, message: LMS_TUTOR_FAILED_MESSAGE };
  }

  if (!structured.ok) {
    await complete({
      status: 'failed',
      raw: structured.raw,
      ...invalidOutput(structured.reason),
    });
    return { kind: 'failed', requestId, message: LMS_TUTOR_FAILED_MESSAGE };
  }
  const out = structured.value;

  // 5. Fails closed: the model saying the lesson does not cover it is honoured.
  if (!out.groundedInLesson || out.explanation.trim().length === 0) {
    await complete({
      status: 'completed',
      raw: structured.raw,
      flags: ['knowledge_not_available'],
    });
    return { kind: 'not_in_lesson', requestId, message: LMS_TUTOR_NOT_IN_LESSON_MESSAGE };
  }

  // 6. `groundedInLesson: true` is not taken on trust. A tutor that wandered into clinical territory
  //    is refused whatever it claimed about grounding.
  if (isClinicalQuestion(out.explanation)) {
    await complete({
      status: 'completed',
      raw: structured.raw,
      flags: ['guardrail_triggered', 'off_label_request'],
    });
    return { kind: 'not_in_lesson', requestId, message: LMS_TUTOR_NOT_IN_LESSON_MESSAGE };
  }

  await complete({ status: 'completed', raw: structured.raw });
  return {
    kind: 'explained',
    requestId,
    explanation: out.explanation.trim(),
    lessonTitle: lesson.lessonTitle,
  };
};
