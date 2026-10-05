import { describe, expect, it } from 'vitest';
import { coachOutcome, coachRequestBody, turnOutcome, turnRequestBody } from './flow';
import { DIMENSION_LABELS, PRACTICE_DIMENSIONS } from './contract';
import { createSamplePracticeBackend, SAMPLE_REPLY_PREFIX } from './sample';

/**
 * FE-D17 — AI Doctor practice, against the contract on `worktree-ai-platform-phase-a`
 * (`packages/core/src/field/simulation.ts`, mirrored in `contract.ts` until FE-CR-11 lands it).
 */

const SESSION = {
  sessionId: '66666666-6666-4666-8666-666666666601',
  personaId: '66666666-6666-4666-8666-666666666602',
  personaDisplayName: 'Dr Sample Rao',
  personaStance: 'sceptical' as const,
  personaBrief: 'A busy urologist who has seen many reps this week.',
  objective: 'Introduce the product and agree a follow-up.',
  objection: 'The price is too high for my patients.',
  turns: [
    { turnIndex: 1, role: 'rep' as const, text: 'Good morning, Doctor.' },
    { turnIndex: 2, role: 'doctor' as const, text: 'I have two minutes.' },
  ],
};

describe('turnRequestBody — what a practice turn sends', () => {
  it('carries the server-provided session context and the rep’s own words, nothing else', () => {
    const body = turnRequestBody(SESSION, '  I will be brief.  ');

    expect(body).toEqual({
      feature: 'ai_doctor',
      sessionId: SESSION.sessionId,
      repText: 'I will be brief.',
      personaBrief: SESSION.personaBrief,
      personaStance: 'sceptical',
      objection: SESSION.objection,
      history: [
        { role: 'rep', text: 'Good morning, Doctor.' },
        { role: 'doctor', text: 'I have two minutes.' },
      ],
    });
    expect(Object.keys(body ?? {}).sort()).toEqual(
      [
        'feature',
        'history',
        'objection',
        'personaBrief',
        'personaStance',
        'repText',
        'sessionId',
      ].sort(),
    );
  });

  it('an empty turn is not sent', () => {
    expect(turnRequestBody(SESSION, '   ')).toBeNull();
  });
});

describe('coachRequestBody — what the analysis request sends', () => {
  it('sends the stored turns with their indices, and the scenario', () => {
    expect(coachRequestBody(SESSION)).toEqual({
      feature: 'ai_coach',
      sessionId: SESSION.sessionId,
      objective: SESSION.objective,
      objection: SESSION.objection,
      turns: [
        { turnIndex: 1, role: 'rep', text: 'Good morning, Doctor.' },
        { turnIndex: 2, role: 'doctor', text: 'I have two minutes.' },
      ],
    });
  });
});

describe('turnOutcome — SimTurnResult and the gateway errors', () => {
  it('a reply is a reply', () => {
    expect(
      turnOutcome({
        status: 200,
        body: {
          kind: 'replied',
          sessionId: SESSION.sessionId,
          reply: 'Go on.',
          objectionAddressed: false,
          turnCount: 4,
        },
      }),
    ).toEqual({ kind: 'replied', reply: 'Go on.', objectionAddressed: false });
  });

  it('a stub-marked reply is NEVER a reply: it is "not available yet"', () => {
    expect(
      turnOutcome({
        status: 200,
        body: {
          kind: 'replied',
          sessionId: SESSION.sessionId,
          reply: '[PRACTICE STUB - no AI provider is configured; decision #5 is open]',
          objectionAddressed: false,
          turnCount: 2,
        },
      }).kind,
    ).toBe('not_available');
  });

  it('patient details are refused, as a designed state', () => {
    expect(
      turnOutcome({
        status: 200,
        body: { kind: 'patient_specific', sessionId: SESSION.sessionId, message: 'No patients.' },
      }),
    ).toEqual({ kind: 'refused', message: 'No patients.' });
  });

  it('503 no_provider and 403 45011 are "not available yet"; 429 45012 is at-limit', () => {
    expect(turnOutcome({ status: 503, body: { code: 'no_provider' } }).kind).toBe('not_available');
    expect(turnOutcome({ status: 403, body: { code: '45011' } }).kind).toBe('not_available');
    expect(turnOutcome({ status: 429, body: { code: '45012' } }).kind).toBe('at_limit');
  });

  it('a failed turn, or anything not the contract, is an error', () => {
    expect(
      turnOutcome({ status: 200, body: { kind: 'failed', sessionId: 'x', message: 'Try again.' } })
        .kind,
    ).toBe('error');
    expect(turnOutcome({ status: 200, body: { kind: 'replied' } }).kind).toBe('error');
    expect(turnOutcome({ status: 500, body: {} }).kind).toBe('error');
  });
});

describe('coachOutcome', () => {
  it('analysed carries the id to read', () => {
    expect(
      coachOutcome({
        status: 200,
        body: {
          kind: 'analysed',
          analysisId: '66666666-6666-4666-8666-6666666666a1',
          overallScore: 61,
        },
      }),
    ).toEqual({ kind: 'analysed', analysisId: '66666666-6666-4666-8666-6666666666a1' });
  });

  it('503 is not available; failed is an error', () => {
    expect(coachOutcome({ status: 503, body: { code: 'no_provider' } }).kind).toBe('not_available');
    expect(coachOutcome({ status: 200, body: { kind: 'failed', message: 'x' } }).kind).toBe(
      'error',
    );
  });
});

describe('the seven dimensions, in the operator’s words', () => {
  it('every dimension the branch scores has a label', () => {
    expect(PRACTICE_DIMENSIONS).toEqual([
      'opening',
      'product_knowledge',
      'scientific_accuracy',
      'objection_handling',
      'response_relevance',
      'communication',
      'closing',
    ]);
    expect(PRACTICE_DIMENSIONS.map((d) => DIMENSION_LABELS[d])).toEqual([
      'Opening and pitch',
      'Product knowledge',
      'Scientific accuracy',
      'Objection handling',
      'Relevance of responses',
      'Communication quality',
      'Closing and follow-up',
    ]);
  });
});

describe('the sample backend', () => {
  it('runs a whole session: start, turns, end, analysis, through the same mappers', async () => {
    const backend = createSamplePracticeBackend();
    const { scenarios } = await backend.listScenarios();
    const scenario = scenarios[0];
    if (scenario === undefined) throw new Error('no sample scenario');

    const started = await backend.start(scenario.id);
    let session = await backend.readSession(started.sessionId);
    if (session === null) throw new Error('no session');

    const body = turnRequestBody(session, 'Good morning, Doctor.');
    if (body === null) throw new Error('no body');
    const turn = turnOutcome(await backend.turn(body));
    expect(turn.kind).toBe('replied');
    expect(turn.kind === 'replied' ? turn.reply.startsWith(SAMPLE_REPLY_PREFIX) : false).toBe(true);

    await backend.end(started.sessionId);
    session = await backend.readSession(started.sessionId);
    if (session === null) throw new Error('no session');
    expect(session.state).toBe('ended');

    const coached = coachOutcome(await backend.analyse(coachRequestBody(session)));
    expect(coached.kind).toBe('analysed');
    const analysis =
      coached.kind === 'analysed' ? await backend.readAnalysis(coached.analysisId) : null;
    expect(analysis?.modelProvider).toBe('sample');
    expect(analysis?.strengths.every((f) => f.turnIndex >= 1)).toBe(true);
    expect((await backend.listMySessions()).map((s) => s.sessionId)).toContain(started.sessionId);
  });

  it('can reach "not available" and "refused" on purpose', async () => {
    const backend = createSamplePracticeBackend();
    const { scenarios } = await backend.listScenarios();
    const started = await backend.start(scenarios[0]?.id ?? '');
    const session = await backend.readSession(started.sessionId);
    if (session === null) throw new Error('no session');

    const unavailable = turnRequestBody(session, 'unavailable');
    const patient = turnRequestBody(session, 'about my patient Mrs Rao');
    if (unavailable === null || patient === null) throw new Error('no body');
    expect(turnOutcome(await backend.turn(unavailable)).kind).toBe('not_available');
    expect(turnOutcome(await backend.turn(patient)).kind).toBe('refused');
  });
});
