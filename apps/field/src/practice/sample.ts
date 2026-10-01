import type {
  CoachRequestBody,
  GatewayResponse,
  PracticeAnalysis,
  PracticePersona,
  PracticeScenario,
  PracticeSession,
  PracticeSessionSummary,
  PracticeTurn,
  StartSessionResponse,
  TurnRequestBody,
} from './contract';
import type { PracticeBackend } from './transport';

/**
 * FE-D17 — the AI Doctor practice SAMPLE backend. Added, not changed from anything existing.
 *
 * **This is not the practice backend.** Nothing leaves the phone. Each answer is shaped like the
 * branch's (see `contract.ts`) and goes through the same mappers the real one will. Every doctor
 * reply starts "Sample reply", and every analysis has `modelProvider: 'sample'`, so the screens
 * label them as sample data. Its scores are fixed sample values, not an assessment of anything
 * the rep typed.
 *
 * In memory only, for the life of the app process. A word in the rep's turn picks a state, so
 * each can be shown on purpose: "unavailable" (no model), "patient" (refused), "limit",
 * "offline", "error".
 */
export const SAMPLE_REPLY_PREFIX = 'Sample reply';

const PERSONAS: readonly PracticePersona[] = [
  {
    id: '77777777-7777-4777-8777-777777777701',
    displayName: 'Dr Sample Rao',
    specialty: 'Urology',
    stance: 'sceptical',
    brief: 'A busy urologist who has seen many reps this week and wants evidence, not adjectives.',
  },
  {
    id: '77777777-7777-4777-8777-777777777702',
    displayName: 'Dr Sample Iyer',
    specialty: 'General practice',
    stance: 'rushed',
    brief: 'A GP between patients, with two minutes to spare.',
  },
];

const SCENARIOS: readonly PracticeScenario[] = [
  {
    id: '77777777-7777-4777-8777-7777777777a1',
    personaId: '77777777-7777-4777-8777-777777777701',
    title: 'Answer a cost objection',
    objective: 'Introduce the product and agree a follow-up visit.',
    objection: 'The price is too high for my patients.',
  },
  {
    id: '77777777-7777-4777-8777-7777777777a2',
    personaId: '77777777-7777-4777-8777-777777777702',
    title: 'Two minutes between patients',
    objective: 'Make one clear point and leave material.',
    objection: 'I really do not have time today.',
  },
];

const SAMPLE_REPLIES = [
  `${SAMPLE_REPLY_PREFIX} from the practice doctor: go on, but I have heard this before.`,
  `${SAMPLE_REPLY_PREFIX} from the practice doctor: and what does it cost my patients?`,
  `${SAMPLE_REPLY_PREFIX} from the practice doctor: send me the study and come back next week.`,
];

const SAMPLE_MODULES = [
  { moduleId: '77777777-7777-4777-8777-7777777777m1', title: 'Handling cost objections' },
  { moduleId: '77777777-7777-4777-8777-7777777777m2', title: 'Closing a short visit' },
];

interface StoredSession {
  readonly start: StartSessionResponse;
  readonly scenario: PracticeScenario;
  readonly persona: PracticePersona;
  state: 'open' | 'ended';
  turns: PracticeTurn[];
  analysisId: string | null;
}

const has = (text: string, word: string): boolean => text.toLowerCase().includes(word);

export const createSamplePracticeBackend = (): PracticeBackend => {
  const sessions = new Map<string, StoredSession>();
  const analyses = new Map<string, PracticeAnalysis>();
  let counter = 0;
  /** A UUID-shaped id, as the real backend's are: `kind` is a hex tag, `a0` session, `b0` analysis. */
  const nextId = (kind: 'a0' | 'b0'): string => {
    counter += 1;
    return `88888888-8888-4888-8888-${kind}${String(counter).padStart(10, '0')}`;
  };
  // The sample's own clock: a fixed instant per step, so nothing on screen depends on the phone.
  const SAMPLE_AT = '2026-10-01T05:30:00.000Z';

  const view = (stored: StoredSession): PracticeSession => ({
    sessionId: stored.start.sessionId,
    personaDisplayName: stored.persona.displayName,
    personaStance: stored.persona.stance,
    personaBrief: stored.persona.brief,
    scenarioTitle: stored.scenario.title,
    objective: stored.scenario.objective,
    objection: stored.scenario.objection,
    state: stored.state,
    startedAt: stored.start.startedAt,
    turns: [...stored.turns],
    analysisId: stored.analysisId,
  });

  return {
    listScenarios: () => Promise.resolve({ personas: PERSONAS, scenarios: SCENARIOS }),

    start: (scenarioId) => {
      const scenario = SCENARIOS.find((candidate) => candidate.id === scenarioId);
      const persona = PERSONAS.find((candidate) => candidate.id === scenario?.personaId);
      if (scenario === undefined || persona === undefined) {
        return Promise.reject(new Error('sample: unknown scenario'));
      }
      const start: StartSessionResponse = {
        sessionId: nextId('a0'),
        personaId: persona.id,
        personaDisplayName: persona.displayName,
        personaStance: persona.stance,
        objective: scenario.objective,
        objection: scenario.objection,
        startedAt: SAMPLE_AT,
      };
      sessions.set(start.sessionId, {
        start,
        scenario,
        persona,
        state: 'open',
        turns: [],
        analysisId: null,
      });
      return Promise.resolve(start);
    },

    readSession: (sessionId) => {
      const stored = sessions.get(sessionId);
      return Promise.resolve(stored === undefined ? null : view(stored));
    },

    listMySessions: () =>
      Promise.resolve(
        [...sessions.values()].map((stored): PracticeSessionSummary => ({
          sessionId: stored.start.sessionId,
          scenarioTitle: stored.scenario.title,
          personaDisplayName: stored.persona.displayName,
          state: stored.state,
          startedAt: stored.start.startedAt,
          analysisId: stored.analysisId,
        })),
      ),

    turn: (body: TurnRequestBody): Promise<GatewayResponse> => {
      const text = body.repText;
      if (has(text, 'offline')) return Promise.reject(new TypeError('Network request failed'));
      if (has(text, 'unavailable')) {
        return Promise.resolve({ status: 503, body: { code: 'no_provider' } });
      }
      if (has(text, 'limit')) return Promise.resolve({ status: 429, body: { code: '45012' } });
      if (has(text, 'error'))
        return Promise.resolve({ status: 500, body: { code: 'gateway_error' } });
      if (has(text, 'patient')) {
        return Promise.resolve({
          status: 200,
          body: {
            kind: 'patient_specific',
            sessionId: body.sessionId,
            message:
              'This practice doctor cannot discuss a real patient, and patient details should not be entered here.',
          },
        });
      }
      const stored = sessions.get(body.sessionId);
      if (stored === undefined || stored.state !== 'open') {
        return Promise.resolve({ status: 403, body: { code: '22023' } });
      }
      const reply =
        SAMPLE_REPLIES[Math.floor(stored.turns.length / 2) % SAMPLE_REPLIES.length] ?? '';
      const repIndex = stored.turns.length + 1;
      stored.turns = [
        ...stored.turns,
        { turnIndex: repIndex, role: 'rep', text },
        { turnIndex: repIndex + 1, role: 'doctor', text: reply },
      ];
      return Promise.resolve({
        status: 200,
        body: {
          kind: 'replied',
          sessionId: body.sessionId,
          reply,
          objectionAddressed: false,
          turnCount: stored.turns.length,
        },
      });
    },

    end: (sessionId) => {
      const stored = sessions.get(sessionId);
      if (stored !== undefined) stored.state = 'ended';
      return Promise.resolve();
    },

    analyse: (body: CoachRequestBody): Promise<GatewayResponse> => {
      const stored = sessions.get(body.sessionId);
      if (stored === undefined || stored.state !== 'ended') {
        return Promise.resolve({ status: 403, body: { code: '22023' } });
      }
      const firstRep = stored.turns.find((turn) => turn.role === 'rep')?.turnIndex ?? 1;
      const analysis: PracticeAnalysis = {
        id: nextId('b0'),
        sessionId: body.sessionId,
        overallScore: 58,
        dimensionScores: {
          opening: 64,
          product_knowledge: 55,
          scientific_accuracy: 60,
          objection_handling: 42,
          response_relevance: 61,
          communication: 70,
          closing: 50,
        },
        strengths: [
          {
            dimension: 'communication',
            title: 'Sample strength: a clear, polite opening',
            detail: 'Sample data. In the real analysis, this cites what you actually said.',
            turnIndex: firstRep,
          },
        ],
        improvements: [
          {
            dimension: 'objection_handling',
            title: 'Sample improvement: answer the cost objection directly',
            detail: 'Sample data. In the real analysis, this cites the turn it is about.',
            turnIndex: firstRep,
          },
        ],
        suggestedModules: [
          {
            moduleId: SAMPLE_MODULES[0]?.moduleId ?? '',
            dimension: 'objection_handling',
            reason: 'Sample data: a module your company publishes on this.',
          },
        ],
        summary: 'Sample summary. No AI model is connected, so nothing you said was analysed.',
        modelProvider: 'sample',
        modelName: 'sample-fixture',
        createdAt: SAMPLE_AT,
      };
      analyses.set(analysis.id, analysis);
      stored.analysisId = analysis.id;
      return Promise.resolve({
        status: 200,
        body: { kind: 'analysed', analysisId: analysis.id, overallScore: analysis.overallScore },
      });
    },

    readAnalysis: (analysisId) => Promise.resolve(analyses.get(analysisId) ?? null),

    moduleTitles: (moduleIds) =>
      Promise.resolve(
        Object.fromEntries(
          SAMPLE_MODULES.filter((module) => moduleIds.includes(module.moduleId)).map((module) => [
            module.moduleId,
            module.title,
          ]),
        ),
      ),
  };
};
