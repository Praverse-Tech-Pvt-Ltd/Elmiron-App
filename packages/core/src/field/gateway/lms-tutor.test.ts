import { describe, expect, it } from 'vitest';
import { PATIENT_SPECIFIC_REFUSAL_MESSAGE } from './guardrails.js';
import {
  LMS_TUTOR_FAILED_MESSAGE,
  LMS_TUTOR_NOT_IN_LESSON_MESSAGE,
  LMS_TUTOR_OUTPUT_SCHEMA_NAME,
  answerLessonQuestion as answerLessonQuestionWith,
} from './lms-tutor.js';
import type { LmsTutorInput } from './lms-tutor.js';
import type { ControlPlaneRpc, LlmGenerateRequest, LlmProvider } from './providers.js';

/** W2-E C: the close goes to the gateway's writer; one recording fake stands in for both here. */
const answerLessonQuestion = (input: Omit<LmsTutorInput, 'writer'>) =>
  answerLessonQuestionWith({ ...input, writer: input.rpc });

/**
 * W1-K Part B — the `lms_tutor` flow against a fake control plane and a scripted model.
 *
 * **What this file is for: proving the restriction, not the prompt.** The tutor's claim is that it
 * answers only from the one lesson it was given, and that the restriction is enforced by the flow
 * rather than requested of the model. These are the tests that make that checkable — in particular
 * that the model is given **exactly one lesson and nothing else**, and that `groundedInLesson: true`
 * is not taken on trust.
 *
 * What it cannot prove: that the database agrees. `services/api/tests/lms-tutor.spec.ts` runs the
 * same properties against the real RPCs over real HTTP.
 */

const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const LESSON_ID = '44444444-4444-4444-8444-444444444444';

interface Recorded {
  calls: { fn: string; args: Record<string, unknown> }[];
  modelRequests: LlmGenerateRequest[];
}

const LESSON_BODY =
  'Interstitial cystitis is a chronic bladder condition. This module covers how to introduce the topic.';

const fakeRpc = (
  recorded: Recorded,
  opts: { outputSchemaName?: string; lessonRefused?: boolean } = {},
): ControlPlaneRpc => ({
  call: (fn, args) => {
    recorded.calls.push({ fn, args: { ...args } });
    switch (fn) {
      case 'ai_begin_request':
        return Promise.resolve({
          requestId: REQUEST_ID,
          feature: 'lms_tutor',
          startedAt: '2026-09-30T10:00:00+00:00',
          promptVersionId: '55555555-5555-4555-8555-555555555555',
          promptVersionNumber: 1,
          systemPrompt: 'You are the training tutor.',
          outputSchemaName: opts.outputSchemaName ?? LMS_TUTOR_OUTPUT_SCHEMA_NAME,
          modelConfig: { temperature: 0 },
          requestsUsedToday: 1,
          dailyLimit: 50,
          allowanceWarning: false,
          allowanceResetsAt: '2026-10-01T18:30:00+00:00',
        });
      case 'lms_tutor_lesson_context':
        if (opts.lessonRefused === true) {
          const err = new Error('lesson is not available to you') as Error & { code?: string };
          err.code = '42501';
          throw err;
        }
        return Promise.resolve({
          lessonId: LESSON_ID,
          lessonTitle: 'Introducing the therapy area',
          lessonBody: LESSON_BODY,
          courseTitle: 'Urology foundations',
        });
      case 'ai_gateway_complete_request':
        return Promise.resolve({ requestId: REQUEST_ID, status: 'recorded' });
      default:
        throw new Error(`unexpected rpc ${fn}`);
    }
  },
});

const scripted = (body: unknown, recorded: Recorded): LlmProvider => ({
  generate: (request) => {
    recorded.modelRequests.push(request);
    return Promise.resolve({
      provider: 'scripted',
      model: 'scripted-1',
      text: typeof body === 'string' ? body : JSON.stringify(body),
      usage: { inputTokens: 12, outputTokens: 6 },
    });
  },
});

const fresh = (): Recorded => ({ calls: [], modelRequests: [] });

const completionOf = (r: Recorded): Record<string, unknown> =>
  r.calls.filter((c) => c.fn === 'ai_gateway_complete_request').at(-1)?.args ?? {};

// ---------------------------------------------------------------------------

describe('B2 — its own feature, sharing nothing', () => {
  it('asks the database for lms_tutor, not for mr_chat or product_qa', async () => {
    const r = fresh();
    await answerLessonQuestion({
      rpc: fakeRpc(r),
      provider: scripted(
        { groundedInLesson: true, explanation: 'It means the bladder lining.' },
        r,
      ),
      lessonId: LESSON_ID,
      question: 'what does chronic mean here',
    });
    expect(r.calls.find((c) => c.fn === 'ai_begin_request')?.args['p_feature']).toBe('lms_tutor');
  });

  it('refuses a prompt approved for another output shape, and calls no model', async () => {
    const r = fresh();
    const result = await answerLessonQuestion({
      rpc: fakeRpc(r, { outputSchemaName: 'MrChatOutputSchema' }),
      provider: scripted({ groundedInLesson: true, explanation: 'x' }, r),
      lessonId: LESSON_ID,
      question: 'what does chronic mean here',
    });
    expect(result.kind).toBe('failed');
    expect(r.modelRequests).toHaveLength(0);
    expect(completionOf(r)['p_error_code']).toBe('prompt_schema_mismatch');
  });
});

describe('B4 — the restriction IS the control', () => {
  it('gives the model the lesson body and nothing else', async () => {
    const r = fresh();
    await answerLessonQuestion({
      rpc: fakeRpc(r),
      provider: scripted({ groundedInLesson: true, explanation: 'ok' }, r),
      lessonId: LESSON_ID,
      question: 'what does chronic mean here',
    });
    const user = r.modelRequests[0]?.messages.find((m) => m.role === 'user');
    expect(user?.content).toContain(LESSON_BODY);
    expect(user?.content).toContain('Urology foundations');
    // Only ONE source. If a second lesson ever appears here, this is the test that should fail.
    expect(r.calls.filter((c) => c.fn === 'lms_tutor_lesson_context')).toHaveLength(1);
  });

  it('fails closed when the model says the lesson does not cover it', async () => {
    const r = fresh();
    const result = await answerLessonQuestion({
      rpc: fakeRpc(r),
      provider: scripted({ groundedInLesson: false, explanation: '' }, r),
      lessonId: LESSON_ID,
      question: 'what is the reimbursement code',
    });
    expect(result.kind).toBe('not_in_lesson');
    expect(result.kind === 'not_in_lesson' ? result.message : '').toBe(
      LMS_TUTOR_NOT_IN_LESSON_MESSAGE,
    );
    expect(completionOf(r)['p_flags']).toContain('knowledge_not_available');
  });

  it('does NOT take groundedInLesson: true on trust — a clinical answer is discarded', async () => {
    // The tutor claimed the lesson covered it and then gave a dose. The lesson is training text,
    // not prescribing information, so this is exactly the wandering the §10 rule is about.
    const r = fresh();
    const result = await answerLessonQuestion({
      rpc: fakeRpc(r),
      provider: scripted(
        { groundedInLesson: true, explanation: 'The usual dose is 400mg twice daily.' },
        r,
      ),
      lessonId: LESSON_ID,
      question: 'what does chronic mean here',
    });
    expect(r.modelRequests).toHaveLength(1); // the model WAS called
    expect(result.kind).toBe('not_in_lesson'); // and its answer was thrown away
    expect(completionOf(r)['p_flags']).toContain('guardrail_triggered');
  });

  it('explains a grounded, non-clinical answer and names the lesson', async () => {
    const r = fresh();
    const result = await answerLessonQuestion({
      rpc: fakeRpc(r),
      provider: scripted(
        { groundedInLesson: true, explanation: 'It means the condition is long lasting.' },
        r,
      ),
      lessonId: LESSON_ID,
      question: 'what does chronic mean here',
    });
    expect(result).toEqual({
      kind: 'explained',
      requestId: REQUEST_ID,
      explanation: 'It means the condition is long lasting.',
      lessonTitle: 'Introducing the therapy area',
    });
    const done = completionOf(r);
    expect(done['p_status']).toBe('completed');
    expect(done['p_model_provider']).toBe('scripted');
    // No sources of the citable kind exist for this feature; the audit must not claim any.
    expect(done['p_knowledge_version_ids']).toEqual([]);
  });
});

describe('B3 — both guardrails fire BEFORE any provider call', () => {
  it('refuses a question naming a patient, with NO provider recorded', async () => {
    const r = fresh();
    const result = await answerLessonQuestion({
      rpc: fakeRpc(r),
      provider: scripted({ groundedInLesson: true, explanation: 'never produced' }, r),
      lessonId: LESSON_ID,
      question: 'patient Meena Kumari, 42, has bladder pain — what does the lesson say',
    });
    expect(result.kind).toBe('patient_specific');
    expect(result.kind === 'patient_specific' ? result.message : '').toBe(
      PATIENT_SPECIFIC_REFUSAL_MESSAGE,
    );
    expect(r.modelRequests).toHaveLength(0);
    const done = completionOf(r);
    expect(done['p_status']).toBe('blocked');
    expect(done['p_model_provider']).toBeNull();
    // And the lesson was never even fetched: the guardrail runs first.
    expect(r.calls.filter((c) => c.fn === 'lms_tutor_lesson_context')).toHaveLength(0);
  });

  it('refuses a clinical question, with NO provider recorded', async () => {
    const r = fresh();
    const result = await answerLessonQuestion({
      rpc: fakeRpc(r),
      provider: scripted({ groundedInLesson: true, explanation: 'never produced' }, r),
      lessonId: LESSON_ID,
      question: 'is 400mg twice daily normal for interstitial cystitis',
    });
    expect(result.kind).toBe('not_in_lesson');
    expect(r.modelRequests).toHaveLength(0);
    expect(completionOf(r)['p_model_provider']).toBeNull();
  });

  it('POSITIVE CONTROL: an ordinary lesson question DOES reach the model', async () => {
    // Without this, "no model request" could equally mean the harness is broken.
    const r = fresh();
    const result = await answerLessonQuestion({
      rpc: fakeRpc(r),
      provider: scripted({ groundedInLesson: true, explanation: 'It means long lasting.' }, r),
      lessonId: LESSON_ID,
      question: 'what does chronic mean here',
    });
    expect(result.kind).toBe('explained');
    expect(r.modelRequests).toHaveLength(1);
    expect(completionOf(r)['p_model_provider']).toBe('scripted');
  });
});

describe('the lesson is fetched before the model, and its refusal propagates', () => {
  it('a lesson the learner may not see refuses with 42501 and calls no model', async () => {
    const r = fresh();
    await expect(
      answerLessonQuestion({
        rpc: fakeRpc(r, { lessonRefused: true }),
        provider: scripted({ groundedInLesson: true, explanation: 'x' }, r),
        lessonId: LESSON_ID,
        question: 'what does chronic mean here',
      }),
    ).rejects.toMatchObject({ code: '42501' });
    expect(r.modelRequests).toHaveLength(0);
  });

  it('a reply that is not JSON is a failure, not an explanation', async () => {
    const r = fresh();
    const result = await answerLessonQuestion({
      rpc: fakeRpc(r),
      provider: scripted('I am not JSON', r),
      lessonId: LESSON_ID,
      question: 'what does chronic mean here',
    });
    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' ? result.message : '').toBe(LMS_TUTOR_FAILED_MESSAGE);
    expect(completionOf(r)['p_flags']).toContain('schema_invalid');
  });

  it('refuses an empty question before touching the control plane', async () => {
    const r = fresh();
    await expect(
      answerLessonQuestion({
        rpc: fakeRpc(r),
        provider: scripted({ groundedInLesson: true, explanation: 'x' }, r),
        lessonId: LESSON_ID,
        question: '   ',
      }),
    ).rejects.toThrow('empty question');
    expect(r.calls).toHaveLength(0);
  });
});
