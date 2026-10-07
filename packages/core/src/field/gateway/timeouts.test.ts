import { describe, expect, it } from 'vitest';
import {
  SIM_COACH_OUTPUT_SCHEMA_NAME,
  SIM_DOCTOR_TURN_OUTPUT_SCHEMA_NAME,
  SIM_TURN_FAILED_MESSAGE,
} from '../simulation.js';
import {
  LMS_TUTOR_FAILED_MESSAGE,
  LMS_TUTOR_OUTPUT_SCHEMA_NAME,
  answerLessonQuestion as answerLessonQuestionWith,
} from './lms-tutor.js';
import type { LmsTutorInput } from './lms-tutor.js';
import {
  MR_CHAT_FAILED_MESSAGE,
  MR_CHAT_OUTPUT_SCHEMA_NAME,
  answerMrChat as answerMrChatWith,
} from './mr-chat.js';
import type { MrChatInput } from './mr-chat.js';

/** W2-E C: the close goes to the gateway's writer; one recording fake stands in for both here. */
const answerMrChat = (input: Omit<MrChatInput, 'writer'>) =>
  answerMrChatWith({ ...input, writer: input.rpc });
const answerLessonQuestion = (input: Omit<LmsTutorInput, 'writer'>) =>
  answerLessonQuestionWith({ ...input, writer: input.rpc });
import { ProviderError } from './providers.js';
import type { ControlPlaneRpc, LlmProvider } from './providers.js';
import { analyseSimSession, takeDoctorTurn } from './sim-doctor.js';

/**
 * W1-Q B2 — a provider that never answers, in every flow whose timeout branch had never run.
 *
 * **Before this file only `product_qa`'s timeout had executed anywhere** (`benchmarks.ts`,
 * `provider-timeout`). The other four flows each carry the same `catch` — `ProviderTimeoutError` →
 * `provider_timeout`, anything else → `provider_error` — and no test had ever sent one down it. A real
 * model is the first thing that will (Bedrock latency is not the stub's), so this is the branch the
 * first real call is most likely to take.
 *
 * Both sides are here: a provider that never answers must be logged as a timeout, and one that fails
 * at once must NOT be — otherwise a flow that called every failure a timeout would pass.
 *
 * Each flow takes `timeoutMs`; 50 ms here costs nothing. **What this does NOT exercise: the gateway's
 * HTTP layer under a timeout.** It has no timeout-specific code — it returns whatever the flow
 * returns — so over HTTP a timeout differs from `provider-error` (driven in W1-P) only by the flag.
 */

const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '77777777-7777-4777-8777-777777777777';
const LESSON_ID = '44444444-4444-4444-8444-444444444444';

type Call = { fn: string; args: Record<string, unknown> };

/**
 * W1-Z A: the gateway's writer. Nothing may be STORED when the model never answered — but since
 * W2-E C (`BE-W146`) it is also the connection that CLOSES the request, recorded with the rest.
 */
const closeOnly = (calls: Call[]): ControlPlaneRpc => ({
  call: (fn, args) => {
    if (fn !== 'ai_gateway_complete_request') {
      return Promise.reject(
        new Error(`no practice write expected after a provider failure: ${fn}`),
      );
    }
    calls.push({ fn, args: { ...args } });
    return Promise.resolve({ requestId: '33333333-3333-4333-8333-333333333333' });
  },
});

const fakeRpc = (calls: Call[], feature: string, outputSchemaName: string): ControlPlaneRpc => ({
  call: (fn, args) => {
    calls.push({ fn, args: { ...args } });
    switch (fn) {
      case 'ai_begin_request':
        return Promise.resolve({
          requestId: REQUEST_ID,
          feature,
          startedAt: '2026-10-01T10:00:00+00:00',
          promptVersionId: '55555555-5555-4555-8555-555555555555',
          promptVersionNumber: 1,
          systemPrompt: 'system',
          outputSchemaName,
          modelConfig: { temperature: 0 },
          requestsUsedToday: 1,
          dailyLimit: 100,
          allowanceWarning: false,
          allowanceResetsAt: '2026-10-01T18:30:00+00:00',
        });
      case 'mr_chat_scope_terms':
        return Promise.resolve({ terms: ['Probexa'] });
      case 'lms_tutor_lesson_context':
        return Promise.resolve({
          lessonId: LESSON_ID,
          lessonTitle: 'Introducing the therapy area',
          lessonBody: 'Interstitial cystitis is a chronic bladder condition.',
          courseTitle: 'Urology foundations',
        });
      case 'sim_session_context':
        return Promise.resolve({
          sessionId: SESSION_ID,
          state: 'ended',
          personaBrief: 'A busy urologist.',
          personaStance: 'skeptical',
          objective: 'Explain storage',
          objection: 'No room in my fridge',
          turns: [{ turnIndex: 1, role: 'rep', text: 'It keeps below 25 degrees.' }],
        });
      case 'sim_coach_module_candidates':
        return Promise.resolve([]);
      case 'ai_gateway_complete_request':
        return Promise.resolve({ requestId: REQUEST_ID, status: 'recorded' });
      default:
        throw new Error(`unexpected rpc ${fn}`);
    }
  },
});

/** Never resolves. Only the flow's own timeout can end the wait. */
const silent: LlmProvider = { generate: () => new Promise(() => undefined) };

/** Fails at once. A failure that is not a timeout must not be logged as one. */
const broken: LlmProvider = { generate: () => Promise.reject(new Error('connection reset')) };

/**
 * W1-S B (`BE-C64`). The SAME prose twice — once as the vendor's ordinary reply, once with the vendor
 * reporting the model declined. Only the signal differs, so a test that tells them apart is testing
 * the signal, not a string.
 */
const PROSE = 'I cannot help with that request.';
const reply = (refused: boolean) => ({
  generate: () =>
    Promise.resolve({
      text: PROSE,
      usage: { inputTokens: 10, outputTokens: 5 },
      provider: 'scripted',
      model: 'scripted-1',
      ...(refused ? { refused: true } : {}),
    }),
});
const malformed: LlmProvider = reply(false);
const refusing: LlmProvider = reply(true);

/** A failure the vendor NAMED. Its message is never logged, only the name (§52). */
const throttled: LlmProvider = {
  generate: () =>
    Promise.reject(new ProviderError('ThrottlingException', 'Rate exceeded: ' + PROSE)),
};

const completions = (calls: Call[]) => calls.filter((c) => c.fn === 'ai_gateway_complete_request');

const FLOWS = [
  {
    feature: 'mr_chat',
    message: MR_CHAT_FAILED_MESSAGE,
    run: (calls: Call[], provider: LlmProvider) =>
      answerMrChat({
        rpc: fakeRpc(calls, 'mr_chat', MR_CHAT_OUTPUT_SCHEMA_NAME),
        provider,
        message: 'how do I check out',
        timeoutMs: 50,
      }),
  },
  {
    feature: 'lms_tutor',
    message: LMS_TUTOR_FAILED_MESSAGE,
    run: (calls: Call[], provider: LlmProvider) =>
      answerLessonQuestion({
        rpc: fakeRpc(calls, 'lms_tutor', LMS_TUTOR_OUTPUT_SCHEMA_NAME),
        provider,
        lessonId: LESSON_ID,
        question: 'What does chronic mean here?',
        timeoutMs: 50,
      }),
  },
  {
    feature: 'ai_doctor',
    message: SIM_TURN_FAILED_MESSAGE,
    run: (calls: Call[], provider: LlmProvider) =>
      takeDoctorTurn({
        rpc: fakeRpc(calls, 'ai_doctor', SIM_DOCTOR_TURN_OUTPUT_SCHEMA_NAME),
        writer: closeOnly(calls),
        provider,
        sessionId: SESSION_ID,
        repText: 'It keeps below 25 degrees.',
        timeoutMs: 50,
      }),
  },
  {
    feature: 'ai_coach',
    message: SIM_TURN_FAILED_MESSAGE,
    run: (calls: Call[], provider: LlmProvider) =>
      analyseSimSession({
        rpc: fakeRpc(calls, 'ai_coach', SIM_COACH_OUTPUT_SCHEMA_NAME),
        writer: closeOnly(calls),
        provider,
        sessionId: SESSION_ID,
        timeoutMs: 50,
      }),
  },
] as const;

describe.each([
  ['never answers', 'provider_timeout', 'provider_timeout', silent],
  ['fails outright', 'provider_error', 'provider_error', broken],
  // W1-S B (`BE-C64`) — the two the first real call most needs told apart, and the vendor's name.
  ['replies with prose', 'schema_invalid', 'not_json', malformed],
  ['DECLINES (the same prose, flagged by the vendor)', 'model_refused', 'model_refused', refusing],
  ['fails with a NAMED vendor error', 'provider_error', 'provider_throttling_exception', throttled],
] as const)(
  'a provider that %s is closed once, flagged %s, in every flow (W1-Q B2, W1-S B)',
  (_how, flag, errorCode, provider) => {
    it.each(FLOWS.map((f) => [f.feature, f] as const))('%s', async (_feature, flow) => {
      const calls: Call[] = [];
      const result = await flow.run(calls, provider);

      expect(result.kind).toBe('failed');
      expect('message' in result ? result.message : '').toBe(flow.message);

      const closed = completions(calls);
      expect(closed, 'the request is closed exactly once').toHaveLength(1);
      expect(closed[0]?.args['p_status']).toBe('failed');
      expect(closed[0]?.args['p_flags']).toEqual([flag]);
      expect(closed[0]?.args['p_error_code']).toBe(errorCode);
      // The vendor's MESSAGE is never logged — only its name.
      expect(JSON.stringify(closed)).not.toContain(PROSE);
    });
  },
);
