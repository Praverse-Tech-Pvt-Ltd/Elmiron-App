import { z } from 'zod';
import {
  SIM_COACH_DIMENSIONS,
  SIM_COACH_OUTPUT_SCHEMA_NAME,
  SIM_DOCTOR_TURN_OUTPUT_SCHEMA_NAME,
  SIM_TURN_FAILED_MESSAGE,
  SimCoachModuleCandidateSchema,
  SimCoachOutputSchema,
  SimDoctorTurnOutputSchema,
} from '../simulation.js';
import type { SimTurnResult } from '../simulation.js';
import { AiBeginRequestResponseSchema } from '../ai.js';
import type { AiRequestFlag } from '../ai.js';
import { PATIENT_SPECIFIC_REFUSAL_MESSAGE, detectPatientSignals } from './guardrails.js';
import { ProviderTimeoutError, generateStructured, withTimeout } from './providers.js';
import type { ControlPlaneRpc, LlmProvider, LlmResult } from './providers.js';

/**
 * `ai_doctor` — one turn of a practice conversation, runtime- and vendor-neutral. W1-D B4.
 *
 * **The order of the steps is the design, and it is deliberately the same order as
 * `answerProductQuestion`'s.** Two AI features with two different orders would be two different sets
 * of guarantees, and the one nobody re-read would be the one that leaked.
 *
 * 1. `ai_begin_request` — the database decides whether `ai_doctor` may run at all (flag, approved
 *    prompt, daily allowance) and hands back the approved prompt. `45011`/`45012` are thrown with
 *    their SQLSTATE for `refusalForSqlState`.
 * 2. **Guardrails, before anything leaves the building.** A rep turn carrying a patient identifier
 *    is refused here: no model, no stored turn. The request closes as `blocked` with a flag and no
 *    text.
 * 3. The model, given the persona brief and the conversation so far.
 * 4. **Validate the reply against the contract.** A reply that fails the schema is discarded and the
 *    rep is told the doctor could not answer — never a half-parsed object.
 * 5. `record_sim_turn` — the rep turn and the doctor turn stored together, atomically, with the
 *    `ai_requests` id so the conversation is traceable to the request that produced it.
 * 6. `ai_complete_request` records counts, timings and flags. **Never the turn text** — §52, and the
 *    same reason `product_qa` logs none: the request log is not a transcript.
 *
 * **Why the turn text is stored in `sim_turns` but not in `ai_requests`.** They are different
 * promises. `sim_turns` is the rep's own practice history, readable by them and an admin (`C27`).
 * `ai_requests` is the cost-and-safety ledger, readable more widely, and putting conversation text
 * there would widen who can read a rep's words without anybody deciding to.
 */

export interface SimTurnInput {
  readonly rpc: ControlPlaneRpc;
  readonly provider: LlmProvider;
  readonly sessionId: string;
  readonly repText: string;
  /** The persona's authored brief and stance, from `start_sim_session`. */
  readonly personaBrief: string;
  readonly personaStance: string;
  readonly objection: string;
  /** The turns so far, oldest first, so the doctor remembers the conversation. */
  readonly history: readonly { readonly role: 'rep' | 'doctor'; readonly text: string }[];
  readonly timeoutMs?: number;
}

/**
 * The fixed half of the system message — the contract with this code, not editable per organisation.
 * The approved prompt version supplies the organisation's voice; this supplies the shape and the
 * three rules that make a practice doctor safe to talk to.
 */
const OUTPUT_CONTRACT = [
  'You are role-playing a doctor in a TRAINING simulation with a medical representative.',
  'You are not a real doctor and this is not a real consultation.',
  'Never give advice about an individual patient, and never ask for patient details.',
  'Stay in character. Raise the objection you were given until it is addressed.',
  'Reply with JSON only: {"reply": string, "objectionAddressed": boolean}.',
].join('\n');

const renderHistory = (
  history: readonly { readonly role: 'rep' | 'doctor'; readonly text: string }[],
): string =>
  history.length === 0
    ? '(this is the first thing the representative has said)'
    : history.map((t) => `${t.role === 'rep' ? 'Representative' : 'Doctor'}: ${t.text}`).join('\n');

export const takeDoctorTurn = async (input: SimTurnInput): Promise<SimTurnResult> => {
  const { rpc, provider, sessionId } = input;
  const repText = input.repText.trim();
  if (repText.length === 0) throw new Error('takeDoctorTurn: empty rep turn');

  // 1. May this run at all? Refusals propagate with their SQLSTATE.
  const begun = AiBeginRequestResponseSchema.parse(
    await rpc.call('ai_begin_request', { p_feature: 'ai_doctor' }),
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

  // The approved prompt must be the one this code was written for, or every reply fails validation.
  if (begun.outputSchemaName !== SIM_DOCTOR_TURN_OUTPUT_SCHEMA_NAME) {
    await complete({ status: 'failed', errorCode: 'prompt_schema_mismatch' });
    return { kind: 'failed', sessionId, message: SIM_TURN_FAILED_MESSAGE };
  }

  // 2. Guardrails, BEFORE the model and BEFORE the turn is stored.
  //
  // A refused turn is not written to `sim_turns` at all. That is deliberate: a rep's practice
  // history should not contain the patient details they were stopped from sending, and storing them
  // "for the audit" would put the exact data `C25` forbids into a table that keeps it for ever.
  const signals = detectPatientSignals(repText);
  if (signals.length > 0) {
    const onlyAdvice = signals.every((s) => s === 'patient_specific_advice');
    await complete({
      status: 'blocked',
      flags: onlyAdvice ? ['guardrail_triggered'] : ['patient_identifier_detected'],
    });
    return { kind: 'patient_specific', sessionId, message: PATIENT_SPECIFIC_REFUSAL_MESSAGE };
  }

  // 3. The model.
  let structured;
  try {
    structured = await withTimeout(input.timeoutMs ?? 20_000, (signal) =>
      generateStructured(provider, SimDoctorTurnOutputSchema, {
        messages: [
          {
            role: 'system',
            content: [
              begun.systemPrompt,
              OUTPUT_CONTRACT,
              `Your character: ${input.personaBrief}`,
              `Your stance: ${input.personaStance}`,
              `The objection you raise: ${input.objection}`,
            ].join('\n\n'),
          },
          {
            role: 'user',
            content: `Conversation so far:\n${renderHistory(input.history)}\n\nRepresentative: ${repText}`,
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
    return { kind: 'failed', sessionId, message: SIM_TURN_FAILED_MESSAGE };
  }

  // 4. A reply that fails the schema is discarded. The session stays open and the rep may retry --
  // failing closed here costs a turn, not the practice.
  if (!structured.ok) {
    await complete({
      status: 'failed',
      raw: structured.raw,
      flags: ['schema_invalid'],
      errorCode: structured.reason,
    });
    return { kind: 'failed', sessionId, message: SIM_TURN_FAILED_MESSAGE };
  }

  // 5. Both turns, atomically, with the request id that produced the doctor's.
  const recorded = (await rpc.call('record_sim_turn', {
    p_session_id: sessionId,
    p_rep_text: repText,
    p_doctor_text: structured.value.reply,
    p_ai_request_id: requestId,
    p_knowledge_version_ids: [],
  })) as { turnCount?: number };

  // 6. Counts, timings and flags. Never the text.
  await complete({ status: 'completed', raw: structured.raw });

  return {
    kind: 'replied',
    sessionId,
    reply: structured.value.reply,
    objectionAddressed: structured.value.objectionAddressed,
    turnCount: recorded.turnCount ?? 0,
  };
};

// ---------------------------------------------------------------------------
// `ai_coach` — the analysis of an ENDED session
// ---------------------------------------------------------------------------

/**
 * Analyse a finished practice session. W1-D B4/D4.
 *
 * **Separate from `takeDoctorTurn` because it is a separate AI feature with its own flag and its own
 * allowance.** `ai_doctor` and `ai_coach` are distinct ids in `AI_FEATURES`, so an organisation can
 * run practice without coaching — which is what `C27` leaves open while `#14` (may a manager see a
 * score?) is unanswered.
 *
 * **The guardrail is NOT re-run here, and that is deliberate rather than an omission.** Every turn
 * this reads was already screened by `takeDoctorTurn` before it was stored, so nothing in
 * `sim_turns` can carry a patient identifier. Re-screening would be a second copy of the rule, and
 * `constraints.md`'s standing answer is that one side computes and the other is told.
 */
export const analyseSimSession = async (input: {
  readonly rpc: ControlPlaneRpc;
  readonly provider: LlmProvider;
  readonly sessionId: string;
  readonly objective: string;
  readonly objection: string;
  readonly turns: readonly {
    readonly turnIndex: number;
    readonly role: 'rep' | 'doctor';
    readonly text: string;
  }[];
  readonly timeoutMs?: number;
}): Promise<
  | { readonly kind: 'analysed'; readonly analysisId: string; readonly overallScore: number }
  | { readonly kind: 'failed'; readonly message: string }
> => {
  const { rpc, provider, sessionId } = input;

  const begun = AiBeginRequestResponseSchema.parse(
    await rpc.call('ai_begin_request', { p_feature: 'ai_coach' }),
  );
  const requestId = begun.requestId;

  const complete = async (args: {
    status: 'completed' | 'failed';
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

  if (begun.outputSchemaName !== SIM_COACH_OUTPUT_SCHEMA_NAME) {
    await complete({ status: 'failed', errorCode: 'prompt_schema_mismatch' });
    return { kind: 'failed', message: SIM_TURN_FAILED_MESSAGE };
  }

  // W1-M Part C. The modules the coach may suggest -- the caller's company, published, active --
  // fetched BEFORE the model, so the model chooses from a list rather than recalling course names.
  // The database derives the company from the caller; there is no argument to ask about another.
  const candidates = z
    .array(SimCoachModuleCandidateSchema)
    .parse(await rpc.call('sim_coach_module_candidates', {}));
  const candidateIds = new Set(candidates.map((c) => c.moduleId));

  let structured;
  try {
    structured = await withTimeout(input.timeoutMs ?? 20_000, (signal) =>
      generateStructured(provider, SimCoachOutputSchema, {
        messages: [
          {
            role: 'system',
            content: [
              begun.systemPrompt,
              'You are coaching a medical representative on a PRACTICE conversation.',
              'Every finding must cite the turnIndex it is about, and at least one strength and one improvement are required.',
              `Score 0-100 overall and on each of: ${SIM_COACH_DIMENSIONS.join(', ')}.`,
              'suggestedModules: at most three, ONLY moduleIds from the AVAILABLE MODULES list, each with the dimension it addresses and a reason. An empty list is correct when none fits.',
              'Reply with JSON only.',
            ].join('\n'),
          },
          {
            role: 'user',
            content:
              `AVAILABLE MODULES (JSON): ${JSON.stringify(candidates)}\n\n` +
              `Objective: ${input.objective}\nObjection raised: ${input.objection}\n\n` +
              input.turns
                .map(
                  (t) =>
                    `[${String(t.turnIndex)}] ${t.role === 'rep' ? 'Representative' : 'Doctor'}: ${t.text}`,
                )
                .join('\n'),
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
    return { kind: 'failed', message: SIM_TURN_FAILED_MESSAGE };
  }

  if (!structured.ok) {
    await complete({
      status: 'failed',
      raw: structured.raw,
      flags: ['schema_invalid'],
      errorCode: structured.reason,
    });
    return { kind: 'failed', message: SIM_TURN_FAILED_MESSAGE };
  }

  // A suggested module the model was not offered is refused HERE, as invalid output, so the request
  // closes `failed` with a reason. Left to the database it would surface as a raised 23514 after
  // the request had already been counted, with nothing on the `ai_requests` row saying why.
  const out = structured.value;
  if (out.suggestedModules.some((m) => !candidateIds.has(m.moduleId))) {
    await complete({
      status: 'failed',
      raw: structured.raw,
      flags: ['schema_invalid'],
      errorCode: 'unknown_learning_module',
    });
    return { kind: 'failed', message: SIM_TURN_FAILED_MESSAGE };
  }

  // W1-P D2. A finding citing a turn this session was not given is refused HERE too, exactly as an
  // unoffered module is -- found by the stub's new `[STUB:cite-missing-turn]` branch: without it the
  // database's 23514 reached the rep as a raw 403 and the request was left `started` for ever.
  const offeredTurns = new Set(input.turns.map((t) => t.turnIndex));
  if ([...out.strengths, ...out.improvements].some((f) => !offeredTurns.has(f.turnIndex))) {
    await complete({
      status: 'failed',
      raw: structured.raw,
      flags: ['schema_invalid'],
      errorCode: 'unknown_turn_cited',
    });
    return { kind: 'failed', message: SIM_TURN_FAILED_MESSAGE };
  }

  // The database validates the SAME shape again -- see `record_sim_coach_analysis`. Not redundant:
  // this checks what the model said, that checks what reaches the table, and a future caller that
  // is not this code cannot skip the second one. The turn list above came from the client, so the
  // database stays the authority -- and if it refuses, the request is CLOSED with that refusal
  // rather than abandoned mid-flight.
  let stored: { analysisId?: string };
  try {
    stored = (await rpc.call('record_sim_coach_analysis', {
      p_session_id: sessionId,
      p_overall_score: out.overallScore,
      p_dimension_scores: out.dimensionScores,
      p_strengths: out.strengths,
      p_improvements: out.improvements,
      p_suggested_modules: out.suggestedModules,
      p_summary: out.summary,
      p_model_provider: structured.raw.provider,
      p_model_name: structured.raw.model,
    })) as { analysisId?: string };
  } catch (error) {
    // Only a refusal of the ANALYSIS is closed here; an identity or tenancy refusal (28000, 42501)
    // is the caller's problem and keeps propagating, as it does for every other RPC in this flow.
    const code = (error as { code?: unknown }).code;
    if (code !== '22023' && code !== '23514') throw error;
    await complete({
      status: 'failed',
      raw: structured.raw,
      flags: ['schema_invalid'],
      errorCode: 'analysis_refused',
    });
    return { kind: 'failed', message: SIM_TURN_FAILED_MESSAGE };
  }

  await complete({ status: 'completed', raw: structured.raw });

  return {
    kind: 'analysed',
    analysisId: stored.analysisId ?? '',
    overallScore: out.overallScore,
  };
};
