import { appLiveConnection } from '../live-connection';
import { createLivePracticeBackend } from './live';
import type {
  CoachRequestBody,
  GatewayResponse,
  PracticeAnalysis,
  PracticePersona,
  PracticeScenario,
  PracticeSession,
  PracticeSessionSummary,
  StartSessionResponse,
  TurnRequestBody,
} from './contract';

/**
 * FE-D17 — everything the practice screens ask of a backend.
 *
 * **Today, only the sample.** When FE-CR-11 lands the practice contract on `main`, this becomes:
 * the persona and scenario reads, `start_sim_session`, `end_sim_session`, the read RPCs FE-CR-11
 * asks for, and the `ai_doctor` / `ai_coach` gateway features. The screens do not change: they
 * already speak these shapes.
 */
export interface PracticeBackend {
  listScenarios(): Promise<{
    readonly personas: readonly PracticePersona[];
    readonly scenarios: readonly PracticeScenario[];
  }>;
  start(scenarioId: string): Promise<StartSessionResponse>;
  readSession(sessionId: string): Promise<PracticeSession | null>;
  listMySessions(): Promise<readonly PracticeSessionSummary[]>;
  /** POST to the `ai-gateway`, feature `ai_doctor`. */
  turn(body: TurnRequestBody): Promise<GatewayResponse>;
  end(sessionId: string): Promise<void>;
  /** POST to the `ai-gateway`, feature `ai_coach`. */
  analyse(body: CoachRequestBody): Promise<GatewayResponse>;
  readAnalysis(analysisId: string): Promise<PracticeAnalysis | null>;
  /** Titles for suggested module ids (`sim_coach_module_candidates` on the branch). */
  moduleTitles(moduleIds: readonly string[]): Promise<Readonly<Record<string, string>>>;
}

/**
 * One backend for the app process, so a session started on one screen is there on the next.
 *
 * **W2-G A: the REAL backend**, as the signed-in rep — `createLivePracticeBackend`, proved end to end
 * against the local stack (`services/api/tests/sim-gateway.spec.ts`, W1-Z B3; `day-one-states.spec.ts`).
 * Switched now rather than on the day model access lands, behind `practiceEnabled`, which stays off
 * while the only model is the stub: its doctor speaks a marker sentence and the screens say so.
 */
export const practiceBackend: PracticeBackend = createLivePracticeBackend(appLiveConnection());
