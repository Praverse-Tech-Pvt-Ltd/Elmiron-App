import { describe, expect, it } from 'vitest';
import { SIM_DOCTOR_TURN_OUTPUT_SCHEMA_NAME } from '../simulation.js';
import { MR_CHAT_OUTPUT_SCHEMA_NAME, answerMrChat } from './mr-chat.js';
import type { ControlPlaneRpc, LlmGenerateRequest, LlmProvider } from './providers.js';
import { takeDoctorTurn } from './sim-doctor.js';

/**
 * W1-Q E1 — `BE-W135`: the HISTORY a client sends is screened like the message it sends.
 * W1-R C — `BE-W136`: the AI doctor no longer takes a history from the client at all.
 *
 * `mr_chat` and `ai_doctor` both accept `history` from the request body and put it in the model's
 * prompt verbatim (`renderHistory`). Before W1-Q only the NEW message went through
 * `detectPatientSignals`, so patient details placed in an "earlier turn" reached the model — exactly
 * what `C25` forbids. Found while answering `FE-CR-7`'s question "should earlier turns be sent?".
 *
 * Two-sided: a patient detail anywhere in the history is refused before the model; a clean history
 * still reaches it (otherwise refusing every request would pass).
 */

const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '77777777-7777-4777-8777-777777777777';
const PATIENT = 'my patient Mr Sharma, phone 98765 43210, asked about it';

type Recorded = {
  calls: { fn: string; args: Record<string, unknown> }[];
  model: LlmGenerateRequest[];
};

/** What the SERVER holds for the session — distinct strings, so the prompt can be checked for them. */
const STORED = {
  sessionId: SESSION_ID,
  state: 'open',
  personaBrief: 'APPROVED BRIEF: a cautious urologist',
  personaStance: 'skeptical',
  objective: 'Explain storage',
  objection: 'No room in my fridge',
  turns: [
    { turnIndex: 1, role: 'rep', text: 'Good morning, doctor.' },
    { turnIndex: 2, role: 'doctor', text: 'STORED DOCTOR TURN: what about storage?' },
  ],
};

const fakeRpc = (
  r: Recorded,
  feature: string,
  outputSchemaName: string,
  opts: { notYours?: boolean } = {},
): ControlPlaneRpc => ({
  call: (fn, args) => {
    r.calls.push({ fn, args: { ...args } });
    switch (fn) {
      case 'sim_session_context':
        if (opts.notYours === true) {
          const refusal = new Error('session is not yours') as Error & { code?: string };
          refusal.code = '42501';
          return Promise.reject(refusal);
        }
        return Promise.resolve(STORED);
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
      case 'record_sim_turn':
        return Promise.resolve({ turnCount: 2 });
      case 'ai_complete_request':
        return Promise.resolve({ requestId: REQUEST_ID, status: 'recorded' });
      default:
        throw new Error(`unexpected rpc ${fn}`);
    }
  },
});

const scripted = (body: unknown, r: Recorded): LlmProvider => ({
  generate: (request) => {
    r.model.push(request);
    return Promise.resolve({
      provider: 'scripted',
      model: 'scripted-1',
      text: JSON.stringify(body),
      usage: { inputTokens: 10, outputTokens: 5 },
    });
  },
});

const fresh = (): Recorded => ({ calls: [], model: [] });
const closed = (r: Recorded) =>
  r.calls.filter((c) => c.fn === 'ai_complete_request').at(-1)?.args ?? {};

const chat = (r: Recorded, earlier: string) =>
  answerMrChat({
    rpc: fakeRpc(r, 'mr_chat', MR_CHAT_OUTPUT_SCHEMA_NAME),
    provider: scripted({ inScope: true, answer: 'Tap Day end, then Check out.' }, r),
    message: 'how do I check out',
    history: [
      { role: 'rep', text: earlier },
      { role: 'assistant', text: 'Open the visit first.' },
    ],
  });

describe('mr_chat — the history is screened before the model (BE-W135)', () => {
  const run = chat;

  it('a patient detail in an EARLIER turn is refused, and the model is never called', async () => {
    const r = fresh();
    const result = await run(r, PATIENT);

    expect(result.kind).toBe('patient_specific');
    expect(r.model).toHaveLength(0);
    expect(closed(r)['p_status']).toBe('blocked');
    expect(closed(r)['p_flags']).toContain('patient_identifier_detected');
  });

  it('a clean history still reaches the model, in the prompt', async () => {
    const r = fresh();
    const result = await run(r, 'What does the first screen show?');

    expect(result.kind).not.toBe('patient_specific');
    expect(r.model).toHaveLength(1);
    expect(JSON.stringify(r.model[0]?.messages)).toContain('What does the first screen show?');
  });
});

const doctor = (r: Recorded, opts: { notYours?: boolean } = {}) =>
  takeDoctorTurn({
    rpc: fakeRpc(r, 'ai_doctor', SIM_DOCTOR_TURN_OUTPUT_SCHEMA_NAME, opts),
    provider: scripted({ reply: 'Go on.', objectionAddressed: false }, r),
    sessionId: SESSION_ID,
    repText: 'It keeps below 25 degrees.',
  });

describe("ai_doctor — the persona and the conversation are the SERVER's (BE-W136)", () => {
  it('the model is briefed with the approved persona and the STORED turns', async () => {
    const r = fresh();
    const result = await doctor(r);

    expect(result.kind).toBe('replied');
    const [system, user] = r.model[0]?.messages ?? [];
    expect(system?.content).toContain('APPROVED BRIEF: a cautious urologist');
    expect(user?.content).toContain('STORED DOCTOR TURN: what about storage?');
  });

  it('"not your session" refuses BEFORE a request is counted', async () => {
    const r = fresh();
    await expect(doctor(r, { notYours: true })).rejects.toMatchObject({ code: '42501' });
    expect(r.calls.map((c) => c.fn)).toEqual(['sim_session_context']);
    expect(r.model).toHaveLength(0);
  });
});
