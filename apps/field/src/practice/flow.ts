import { STUB_MARKER_PREFIX } from './contract';
import type {
  CoachRequestBody,
  GatewayResponse,
  PracticeSession,
  TurnRequestBody,
} from './contract';

/**
 * FE-D17 — the practice requests and how their answers become screen states.
 *
 * **What is sent is the server's own session context plus what the rep typed.** The persona,
 * stance, objection, objective and earlier turns all come from the session the server stored and
 * returned. The app adds nothing about a real doctor, a patient or a visit, and the pulled store
 * is never read here. The gateway on the branch takes these from the request rather than from its
 * own rows (FE-CR-11 question 3); the app sends the stored values either way.
 */
export const turnRequestBody = (
  session: PracticeSession,
  typed: string,
): TurnRequestBody | null => {
  const repText = typed.trim();
  if (repText.length === 0) return null;
  return {
    feature: 'ai_doctor',
    sessionId: session.sessionId,
    repText,
    personaBrief: session.personaBrief,
    personaStance: session.personaStance,
    objection: session.objection,
    history: session.turns.map((turn) => ({ role: turn.role, text: turn.text })),
  };
};

export const coachRequestBody = (session: PracticeSession): CoachRequestBody => ({
  feature: 'ai_coach',
  sessionId: session.sessionId,
  objective: session.objective,
  objection: session.objection,
  turns: session.turns.map((turn) => ({
    turnIndex: turn.turnIndex,
    role: turn.role,
    text: turn.text,
  })),
});

export type TurnOutcome =
  | { readonly kind: 'replied'; readonly reply: string; readonly objectionAddressed: boolean }
  /** Patient details: a designed refusal, not an error. */
  | { readonly kind: 'refused'; readonly message: string }
  /** No model connected, or the feature switched off. */
  | { readonly kind: 'not_available' }
  | { readonly kind: 'at_limit' }
  | { readonly kind: 'offline' }
  | { readonly kind: 'error' };

export type CoachOutcome =
  | { readonly kind: 'analysed'; readonly analysisId: string }
  | { readonly kind: 'not_available' }
  | { readonly kind: 'at_limit' }
  | { readonly kind: 'offline' }
  | { readonly kind: 'error' };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** The gateway's refusals, shared by both features (`ai-gateway/index.ts:189-199, 259-263`). */
const gatewayRefusal = (
  status: number,
  body: Record<string, unknown> | null,
): { readonly kind: 'not_available' } | { readonly kind: 'at_limit' } | null => {
  const code = body?.['code'];
  if (status === 429 && code === '45012') return { kind: 'at_limit' };
  if ((status === 503 && code === 'no_provider') || (status === 403 && code === '45011')) {
    return { kind: 'not_available' };
  }
  return null;
};

export const turnOutcome = ({ status, body }: GatewayResponse): TurnOutcome => {
  const record = isRecord(body) ? body : null;
  const refusal = gatewayRefusal(status, record);
  if (refusal !== null) return refusal;
  if (status !== 200 || record === null) return { kind: 'error' };

  if (record['kind'] === 'replied') {
    const reply = record['reply'];
    if (typeof reply !== 'string' || reply.trim().length === 0) return { kind: 'error' };
    // A stub reply is never a reply, however it arrived.
    if (reply.startsWith(STUB_MARKER_PREFIX)) return { kind: 'not_available' };
    return {
      kind: 'replied',
      reply: reply.trim(),
      objectionAddressed: record['objectionAddressed'] === true,
    };
  }
  if (record['kind'] === 'patient_specific' && typeof record['message'] === 'string') {
    return { kind: 'refused', message: record['message'] };
  }
  return { kind: 'error' };
};

export const coachOutcome = ({ status, body }: GatewayResponse): CoachOutcome => {
  const record = isRecord(body) ? body : null;
  const refusal = gatewayRefusal(status, record);
  if (refusal !== null) return refusal;
  if (status !== 200 || record === null) return { kind: 'error' };
  if (record['kind'] === 'analysed' && typeof record['analysisId'] === 'string') {
    return { kind: 'analysed', analysisId: record['analysisId'] };
  }
  return { kind: 'error' };
};

/** A request that got no HTTP answer: a `TypeError` from fetch is no connection. */
export const outcomeFromThrown = (error: unknown): { readonly kind: 'offline' | 'error' } =>
  error instanceof TypeError ? { kind: 'offline' } : { kind: 'error' };
