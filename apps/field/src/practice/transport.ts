import { createSamplePracticeBackend } from './sample';
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

/** One backend for the app process, so a session started on one screen is there on the next. */
export const practiceBackend: PracticeBackend = createSamplePracticeBackend();
