/**
 * FE-D17 — a LOCAL MIRROR of the AI Doctor practice contract on `worktree-ai-platform-phase-a`.
 *
 * **Temporary, and on purpose**, like `src/assistant/contract.ts`. The practice backend exists
 * only on that branch, so these shapes are copied from it rather than imported. FE-CR-11 asks
 * backend to land them in `packages/core` on `main`. When it does, this file goes and the imports
 * move to core. Sources on the branch:
 *
 * - `packages/core/src/field/simulation.ts`: personas and scenarios (`:1-154`), the seven
 *   dimensions (`:162-170`), `SimCoachAnalysisSchema` (`:246-277`),
 *   `StartSimSessionResponseSchema` (`:329`), `SimTurnResult` (`:362-371`);
 * - `packages/core/src/field/gateway/sim-doctor.ts:228-229`: the coach result;
 * - `services/api/supabase/functions/ai-gateway/index.ts:202-249`: the request bodies.
 *
 * Only the fields the app reads are mirrored. The lifecycle and authorship fields of a persona or
 * scenario are the console's business.
 */

export const PRACTICE_DIMENSIONS = [
  'opening',
  'product_knowledge',
  'scientific_accuracy',
  'objection_handling',
  'response_relevance',
  'communication',
  'closing',
] as const;
export type PracticeDimension = (typeof PRACTICE_DIMENSIONS)[number];

/** The operator's names for the seven dimensions (direction of 1 October, item 5). */
export const DIMENSION_LABELS: Readonly<Record<PracticeDimension, string>> = {
  opening: 'Opening and pitch',
  product_knowledge: 'Product knowledge',
  scientific_accuracy: 'Scientific accuracy',
  objection_handling: 'Objection handling',
  response_relevance: 'Relevance of responses',
  communication: 'Communication quality',
  closing: 'Closing and follow-up',
};

export type PersonaStance = 'receptive' | 'sceptical' | 'rushed' | 'hostile';

export interface PracticePersona {
  readonly id: string;
  readonly displayName: string;
  readonly specialty: string;
  readonly stance: PersonaStance;
  readonly brief: string;
}

export interface PracticeScenario {
  readonly id: string;
  readonly personaId: string;
  readonly title: string;
  readonly objective: string;
  readonly objection: string;
}

export interface StartSessionResponse {
  readonly sessionId: string;
  readonly personaId: string;
  readonly personaDisplayName: string;
  readonly personaStance: PersonaStance;
  readonly objective: string;
  readonly objection: string;
  readonly startedAt: string;
}

export interface PracticeTurn {
  readonly turnIndex: number;
  readonly role: 'rep' | 'doctor';
  readonly text: string;
}

/**
 * One session as the app shows it: the start response, the persona's brief (from `sim_personas`;
 * the gateway asks the client for it, FE-CR-11 question 3), the stored turns, and its state.
 */
export interface PracticeSession {
  readonly sessionId: string;
  readonly personaDisplayName: string;
  readonly personaStance: PersonaStance;
  readonly personaBrief: string;
  readonly scenarioTitle?: string;
  readonly objective: string;
  readonly objection: string;
  readonly state?: 'open' | 'ended';
  readonly startedAt?: string;
  readonly turns: readonly PracticeTurn[];
  readonly analysisId?: string | null;
}

export interface CoachFinding {
  readonly dimension: PracticeDimension;
  readonly title: string;
  readonly detail: string;
  /** The turn the finding is about. Every finding cites one: a criticism the rep can check. */
  readonly turnIndex: number;
}

export interface SuggestedModule {
  readonly moduleId: string;
  readonly dimension: PracticeDimension;
  readonly reason: string;
}

export interface PracticeAnalysis {
  readonly id: string;
  readonly sessionId: string;
  readonly overallScore: number;
  readonly dimensionScores: Readonly<Record<PracticeDimension, number>>;
  readonly strengths: readonly CoachFinding[];
  readonly improvements: readonly CoachFinding[];
  readonly suggestedModules: readonly SuggestedModule[];
  readonly summary: string;
  readonly modelProvider: string;
  readonly modelName: string;
  readonly createdAt: string;
}

export interface TurnRequestBody {
  readonly feature: 'ai_doctor';
  readonly sessionId: string;
  readonly repText: string;
  readonly personaBrief: string;
  readonly personaStance: PersonaStance;
  readonly objection: string;
  readonly history: readonly { readonly role: 'rep' | 'doctor'; readonly text: string }[];
}

export interface CoachRequestBody {
  readonly feature: 'ai_coach';
  readonly sessionId: string;
  readonly objective: string;
  readonly objection: string;
  readonly turns: readonly PracticeTurn[];
}

export interface GatewayResponse {
  readonly status: number;
  readonly body: unknown;
}

/** One row of "my sessions": what the home screen lists. */
export interface PracticeSessionSummary {
  readonly sessionId: string;
  readonly scenarioTitle: string;
  readonly personaDisplayName: string;
  readonly state: 'open' | 'ended';
  readonly startedAt: string;
  readonly analysisId: string | null;
}

/** The stub's marker (`stub-provider.ts:79-80` on the branch). Never shown as a reply. */
export const STUB_MARKER_PREFIX = '[PRACTICE STUB';
/** The stub's provider name in an analysis (`stub-provider.ts:50`). Its scores are all zero. */
export const STUB_PROVIDER = 'stub';
