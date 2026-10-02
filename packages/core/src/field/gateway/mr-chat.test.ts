import { describe, expect, it } from 'vitest';
import { PATIENT_SPECIFIC_REFUSAL_MESSAGE } from './guardrails.js';
import {
  MR_CHAT_FAILED_MESSAGE,
  MR_CHAT_OUTPUT_SCHEMA_NAME,
  MR_CHAT_OUT_OF_SCOPE_MESSAGE,
  answerMrChat,
  namesAProduct,
} from './mr-chat.js';
import type { ControlPlaneRpc, LlmGenerateRequest, LlmProvider } from './providers.js';

/**
 * W1-I Part B — the `mr_chat` flow against a fake control plane and a scripted model.
 *
 * **What this file is for: proving the CONTROL, not the prompt.** `mr-chat.ts` says in its header
 * that the system prompt is a request and the catalogue check is the control. That is a claim, and
 * these are the tests that make it checkable — in particular *"the answer is discarded when it names
 * a product, whatever the model said about scope"*, which is the half a prompt cannot do.
 *
 * What it cannot prove: that the database agrees. `services/api/tests/mr-chat.spec.ts` runs the same
 * properties against the real RPCs over real HTTP.
 */

const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const TERMS = ['Probexa', 'pentosan polysulfate'];

interface Recorded {
  calls: { fn: string; args: Record<string, unknown> }[];
  modelRequests: LlmGenerateRequest[];
}

const fakeRpc = (
  recorded: Recorded,
  opts: { outputSchemaName?: string; terms?: readonly string[] } = {},
): ControlPlaneRpc => ({
  call: (fn, args) => {
    recorded.calls.push({ fn, args: { ...args } });
    switch (fn) {
      case 'ai_begin_request':
        return Promise.resolve({
          requestId: REQUEST_ID,
          feature: 'mr_chat',
          startedAt: '2026-09-30T10:00:00+00:00',
          promptVersionId: '44444444-4444-4444-8444-444444444444',
          promptVersionNumber: 1,
          systemPrompt: 'You are the in-app assistant.',
          outputSchemaName: opts.outputSchemaName ?? MR_CHAT_OUTPUT_SCHEMA_NAME,
          modelConfig: { temperature: 0 },
          requestsUsedToday: 1,
          dailyLimit: 50,
          allowanceWarning: false,
          allowanceResetsAt: '2026-10-01T18:30:00+00:00',
        });
      case 'mr_chat_scope_terms':
        return Promise.resolve({ terms: opts.terms ?? TERMS });
      case 'ai_complete_request':
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
      usage: { inputTokens: 10, outputTokens: 5 },
    });
  },
});

const fresh = (): Recorded => ({ calls: [], modelRequests: [] });

const completionOf = (r: Recorded): Record<string, unknown> =>
  r.calls.filter((c) => c.fn === 'ai_complete_request').at(-1)?.args ?? {};

// ---------------------------------------------------------------------------

describe('namesAProduct', () => {
  it('matches a brand name on a word boundary, case-insensitively', () => {
    expect(namesAProduct('what does Probexa cost', TERMS)).toBe('Probexa');
    expect(namesAProduct('WHAT DOES PROBEXA COST', TERMS)).toBe('Probexa');
  });

  it('matches a multi-word generic name', () => {
    expect(namesAProduct('is pentosan polysulfate on the list', TERMS)).toBe(
      'pentosan polysulfate',
    );
  });

  it('does not match inside a longer word', () => {
    // The whole reason for the word boundary: "Probexatron" is not Probexa.
    expect(namesAProduct('Probexatron is not ours', TERMS)).toBeNull();
  });

  it('ignores terms shorter than three characters', () => {
    // A two-letter brand would match inside ordinary words and refuse everything.
    expect(namesAProduct('go to the beat plan', ['go'])).toBeNull();
  });

  it('treats a term with regex metacharacters as literal text', () => {
    // A brand name is data. If it became a pattern, one product could match everything.
    expect(namesAProduct('ask about a.b', ['a.b'])).toBe('a.b');
    expect(namesAProduct('ask about axb', ['a.b'])).toBeNull();
  });

  it('returns null on an empty term list, so an org with no catalogue is not blocked', () => {
    expect(namesAProduct('anything at all', [])).toBeNull();
  });
});

describe('answerMrChat — the happy path', () => {
  it('answers an in-scope process question and records tokens but no knowledge versions', async () => {
    const r = fresh();
    const result = await answerMrChat({
      rpc: fakeRpc(r),
      provider: scripted({ inScope: true, answer: 'Open Today, then tap the visit.' }, r),
      message: 'how do I file a call report',
    });

    expect(result).toEqual({
      kind: 'answered',
      requestId: REQUEST_ID,
      answer: 'Open Today, then tap the visit.',
    });
    const done = completionOf(r);
    expect(done['p_status']).toBe('completed');
    expect(done['p_model_provider']).toBe('scripted');
    expect(done['p_input_tokens']).toBe(10);
    // No sources exist for this feature, so the audit must not claim any.
    expect(done['p_knowledge_version_ids']).toEqual([]);
    expect(done['p_flags']).toEqual([]);
  });

  it('asks the database for its OWN feature, not product_qa', async () => {
    const r = fresh();
    await answerMrChat({
      rpc: fakeRpc(r),
      provider: scripted({ inScope: true, answer: 'ok' }, r),
      message: 'where is the beat plan',
    });
    const begin = r.calls.find((c) => c.fn === 'ai_begin_request');
    expect(begin?.args['p_feature']).toBe('mr_chat');
  });

  it('passes earlier turns to the model, oldest first', async () => {
    const r = fresh();
    await answerMrChat({
      rpc: fakeRpc(r),
      provider: scripted({ inScope: true, answer: 'ok' }, r),
      message: 'and after that?',
      history: [
        { role: 'rep', text: 'how do I check in' },
        { role: 'assistant', text: 'Tap Start day.' },
      ],
    });
    const user = r.modelRequests[0]?.messages.find((m) => m.role === 'user');
    expect(user?.content).toContain('Rep: how do I check in');
    expect(user?.content).toContain('Assistant: Tap Start day.');
    expect(user?.content).toContain('and after that?');
  });
});

describe('the guardrail fires BEFORE any provider call', () => {
  it('refuses a message carrying a patient identifier, and never calls the model', async () => {
    const r = fresh();
    const result = await answerMrChat({
      rpc: fakeRpc(r),
      provider: scripted({ inScope: true, answer: 'should never be produced' }, r),
      message: 'my patient Mr Sharma should take what dose',
    });

    expect(result.kind).toBe('patient_specific');
    expect(result.kind === 'patient_specific' ? result.message : '').toBe(
      PATIENT_SPECIFIC_REFUSAL_MESSAGE,
    );
    // THE POINT: no model request at all, and the audit says no provider.
    expect(r.modelRequests).toHaveLength(0);
    const done = completionOf(r);
    expect(done['p_status']).toBe('blocked');
    expect(done['p_model_provider']).toBeNull();
    expect(done['p_flags']).toContain('patient_identifier_detected');
  });

  it('BE-W126 — CLOSED: a bare "patient <Firstname Lastname>" is now refused', async () => {
    // **This test previously asserted the OPPOSITE, and the change is deliberate rather than
    // quiet.** W1-I registered `BE-W126` and wrote this as `expect(result.kind).toBe('answered')`,
    // documenting the gap in the suite instead of in a document, with the note that fixing the gap
    // would make it fail and that the failure was the instruction to rewrite it.
    //
    // W1-J fixed it. The failure arrived exactly as predicted —
    // `AssertionError: expected 'patient_specific' to be 'answered'` — and this is the rewrite.
    // The tuning it now depends on is scored against `guardrails.corpus.ts` in
    // `guardrails.test.ts`, which is where the false-positive half is kept honest.
    const r = fresh();
    const result = await answerMrChat({
      rpc: fakeRpc(r),
      provider: scripted({ inScope: true, answer: 'should never be produced' }, r),
      message: 'patient Meena Kumari, 42, has bladder pain',
    });
    expect(result.kind).toBe('patient_specific');
    // And it refused BEFORE the provider, which is the property that matters.
    expect(r.modelRequests).toHaveLength(0);
    expect(completionOf(r)['p_model_provider']).toBeNull();
  });

  it('POSITIVE CONTROL: the same shape of call WITHOUT patient details does reach the model', async () => {
    // Without this, "no model request" could equally mean the harness is broken.
    const r = fresh();
    const result = await answerMrChat({
      rpc: fakeRpc(r),
      provider: scripted({ inScope: true, answer: 'Tap Start day.' }, r),
      message: 'what should I do first thing in the morning',
    });
    expect(result.kind).toBe('answered');
    expect(r.modelRequests).toHaveLength(1);
    expect(completionOf(r)['p_model_provider']).toBe('scripted');
  });
});

describe('B3 — what stops an invented product claim', () => {
  it('refuses a QUESTION naming a product, and never calls the model', async () => {
    const r = fresh();
    const result = await answerMrChat({
      rpc: fakeRpc(r),
      provider: scripted({ inScope: true, answer: 'Probexa is dosed twice daily.' }, r),
      message: 'what is the dose of Probexa',
    });

    expect(result.kind).toBe('out_of_scope');
    expect(result.kind === 'out_of_scope' ? result.message : '').toBe(MR_CHAT_OUT_OF_SCOPE_MESSAGE);
    expect(r.modelRequests).toHaveLength(0);
    const done = completionOf(r);
    expect(done['p_status']).toBe('blocked');
    expect(done['p_model_provider']).toBeNull();
  });

  it('DISCARDS an answer naming a product even when the model claims it is in scope', async () => {
    // This is the control. The model was asked to stay in scope, said it had, and did not.
    const r = fresh();
    const result = await answerMrChat({
      rpc: fakeRpc(r),
      provider: scripted(
        { inScope: true, answer: 'For that workflow, note that Probexa is taken twice daily.' },
        r,
      ),
      message: 'how do I record a sample drop',
    });

    expect(r.modelRequests).toHaveLength(1); // the model WAS called
    expect(result.kind).toBe('out_of_scope'); // and its answer was thrown away
    const done = completionOf(r);
    expect(done['p_status']).toBe('completed');
    expect(done['p_flags']).toContain('guardrail_triggered');
    // The tokens are still recorded: the call happened and was paid for.
    expect(done['p_model_provider']).toBe('scripted');
  });

  it('honours the model saying it is out of scope', async () => {
    const r = fresh();
    const result = await answerMrChat({
      rpc: fakeRpc(r),
      provider: scripted({ inScope: false, answer: '' }, r),
      message: 'is this medicine safe in pregnancy',
    });
    expect(result.kind).toBe('out_of_scope');
    expect(completionOf(r)['p_flags']).toContain('off_label_request');
  });

  it('W1-J: the limit W1-I recorded is CLOSED — a clinical question is refused, no model called', async () => {
    // **This test previously asserted the opposite, and the change is deliberate.** W1-I wrote it as
    // `expect(result.kind).toBe('answered')` with the note: *"Recorded as a test so the gap is
    // visible rather than implied. If this ever starts returning out_of_scope, something new is
    // stopping it and this test should say what."*
    //
    // W1-J Part B is the something new: `isClinicalQuestion`, a deterministic question-and-answer
    // side check scored against `CLINICAL_MUST_REFUSE` / `CLINICAL_MUST_NOT_REFUSE` in
    // `guardrails.test.ts`. The suppressor there is what keeps "what do I do if a doctor asks about
    // dosing" answerable.
    const r = fresh();
    const result = await answerMrChat({
      rpc: fakeRpc(r),
      provider: scripted({ inScope: true, answer: '400mg twice daily is typical.' }, r),
      message: 'is 400mg twice daily a normal dose for interstitial cystitis',
    });
    expect(result.kind).toBe('out_of_scope');
    // Refused BEFORE the provider: no model was paid for a question it must not answer.
    expect(r.modelRequests).toHaveLength(0);
    expect(completionOf(r)['p_model_provider']).toBeNull();
  });

  it('W1-J: and a clinical claim in the ANSWER is discarded, whatever the question was', async () => {
    // The half a question-side check cannot do: the rep asked something innocuous and the model
    // volunteered a dose. Same shape as the catalogue check on the answer.
    const r = fresh();
    const result = await answerMrChat({
      rpc: fakeRpc(r),
      provider: scripted(
        { inScope: true, answer: 'While you are there, 400mg twice daily is the usual dose.' },
        r,
      ),
      message: 'how do I record a sample drop',
    });
    expect(r.modelRequests).toHaveLength(1); // the model WAS called
    expect(result.kind).toBe('out_of_scope'); // and its answer was thrown away
    expect(completionOf(r)['p_flags']).toContain('guardrail_triggered');
  });
});

describe('bad model replies fail closed', () => {
  it('a reply that is not JSON is a failure, not an answer', async () => {
    const r = fresh();
    const result = await answerMrChat({
      rpc: fakeRpc(r),
      provider: scripted('I am not JSON', r),
      message: 'how do I check out',
    });
    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' ? result.message : '').toBe(MR_CHAT_FAILED_MESSAGE);
    expect(completionOf(r)['p_flags']).toContain('schema_invalid');
  });

  it('an empty answer with inScope true is treated as out of scope, not as an answer', async () => {
    const r = fresh();
    const result = await answerMrChat({
      rpc: fakeRpc(r),
      provider: scripted({ inScope: true, answer: '   ' }, r),
      message: 'how do I check out',
    });
    expect(result.kind).toBe('out_of_scope');
  });

  it('a prompt approved for another output shape fails loudly and calls no model', async () => {
    const r = fresh();
    const result = await answerMrChat({
      rpc: fakeRpc(r, { outputSchemaName: 'ProductQaOutputSchema' }),
      provider: scripted({ inScope: true, answer: 'ok' }, r),
      message: 'how do I check out',
    });
    expect(result.kind).toBe('failed');
    expect(r.modelRequests).toHaveLength(0);
    expect(completionOf(r)['p_error_code']).toBe('prompt_schema_mismatch');
  });

  it('refuses an empty message before touching the control plane', async () => {
    const r = fresh();
    await expect(
      answerMrChat({
        rpc: fakeRpc(r),
        provider: scripted({ inScope: true, answer: 'ok' }, r),
        message: '   ',
      }),
    ).rejects.toThrow('empty message');
    expect(r.calls).toHaveLength(0);
  });
});
