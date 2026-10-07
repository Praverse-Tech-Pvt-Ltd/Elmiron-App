import { describe, expect, it } from 'vitest';
import { SIM_DOCTOR_TURN_OUTPUT_SCHEMA_NAME } from '../simulation.js';
import type { ControlPlaneRpc, LlmGenerateRequest, LlmProvider } from './providers.js';
import { takeDoctorTurn } from './sim-doctor.js';

/**
 * Where a conversation's earlier turns come from — `BE-W135` and `BE-W136`.
 *
 * * W1-Q E1 found that `mr_chat` and `ai_doctor` put a CLIENT-supplied history into the prompt, and
 *   screened only the new message. W1-Q screened the history too.
 * * W1-R C (`BE-W136`): the AI doctor now reads its persona and turns from the server
 *   (`sim_session_context`) and takes no history from the client at all — tested here.
 * * W1-S C: `mr_chat` is single-turn; the gateway refuses a history outright (400). Its tests are in
 *   `mr-chat.test.ts` (the model is sent the message alone) and over HTTP in `mr-chat.spec.ts`.
 */

const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '77777777-7777-4777-8777-777777777777';

type Recorded = {
  calls: { fn: string; args: Record<string, unknown> }[];
  /** W1-Z A: calls made through the gateway's writer, kept apart from the rep's `calls`. */
  writes: { fn: string; args: Record<string, unknown> }[];
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

const fakeRpc = (r: Recorded, opts: { notYours?: boolean } = {}): ControlPlaneRpc => ({
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
          feature: 'ai_doctor',
          startedAt: '2026-10-01T10:00:00+00:00',
          promptVersionId: '55555555-5555-4555-8555-555555555555',
          promptVersionNumber: 1,
          systemPrompt: 'system',
          outputSchemaName: SIM_DOCTOR_TURN_OUTPUT_SCHEMA_NAME,
          modelConfig: { temperature: 0 },
          requestsUsedToday: 1,
          dailyLimit: 100,
          allowanceWarning: false,
          allowanceResetsAt: '2026-10-01T18:30:00+00:00',
        });
      case 'record_sim_turn': {
        // W1-Z A (`BE-C69`): as the database now answers the rep's connection.
        const refusal = new Error('permission denied for function record_sim_turn') as Error & {
          code?: string;
        };
        refusal.code = '42501';
        return Promise.reject(refusal);
      }
      // W2-E C (`BE-W146`): the close is the writer's now; asked of the rep it is unexpected.
      default:
        throw new Error(`unexpected rpc ${fn}`);
    }
  },
});

/** The gateway's writer: the only connection that may store a practice turn (W1-Z A, `BE-C69`). */
const fakeWriter = (r: Recorded): ControlPlaneRpc => ({
  call: (fn, args) => {
    r.writes.push({ fn, args: { ...args } });
    if (fn === 'ai_gateway_complete_request') return Promise.resolve({ requestId: REQUEST_ID });
    if (fn !== 'record_sim_turn') throw new Error(`unexpected writer call ${fn}`);
    return Promise.resolve({ turnCount: 2 });
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

const fresh = (): Recorded => ({ calls: [], writes: [], model: [] });

const doctor = (r: Recorded, opts: { notYours?: boolean } = {}) =>
  takeDoctorTurn({
    rpc: fakeRpc(r, opts),
    // W1-Z A (`BE-C69`): the turn is written through the gateway's writer, recorded in `r.writes`.
    writer: fakeWriter(r),
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

  it('W1-Z A: the turn is stored through the WRITER, bound to the request — never as the rep', async () => {
    // Added after a mutant survived: with the writer and the rep's connection as one fake, writing
    // the turn AS THE REP passed every test in this file.
    const r = fresh();
    expect((await doctor(r)).kind).toBe('replied');
    expect(r.writes.map((w) => w.fn)).toEqual(['record_sim_turn', 'ai_gateway_complete_request']);
    expect(r.writes[0]?.args['p_ai_request_id']).toBe(REQUEST_ID);
    expect(r.calls.map((c) => c.fn)).not.toContain('record_sim_turn');
  });

  it('"not your session" refuses BEFORE a request is counted', async () => {
    const r = fresh();
    await expect(doctor(r, { notYours: true })).rejects.toMatchObject({ code: '42501' });
    expect(r.calls.map((c) => c.fn)).toEqual(['sim_session_context']);
    expect(r.model).toHaveLength(0);
  });
});
