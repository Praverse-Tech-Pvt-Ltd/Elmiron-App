import { STUB_MARKER_PREFIX } from './contract';
import type { GatewayResponse } from './contract';

/**
 * FE-D15 — what one chat request came to, for the screen.
 *
 * Every state is distinct, and the mapping fails closed: a body that is not the contract is an
 * error, never an answer. Text the rep reads is the SERVER's (an answer, or its refusal sentence)
 * or the app's own fixed copy for a state. The app never writes a reply of its own.
 */
export type AllowanceView =
  | { readonly kind: 'not_reported' }
  | {
      readonly kind: 'warning';
      readonly used: number;
      readonly limit: number;
      readonly resetsAt: string | null;
    };

export type AssistantOutcome =
  | { readonly kind: 'answer'; readonly text: string; readonly allowance: AllowanceView }
  /** A designed refusal: product, clinical or patient-specific. Not an error. */
  | { readonly kind: 'refusal'; readonly text: string; readonly allowance: AllowanceView }
  /** No model connected, or the feature switched off. Nothing was answered. */
  | { readonly kind: 'not_available' }
  | { readonly kind: 'at_limit'; readonly resetsAt: string | null }
  | { readonly kind: 'offline' }
  | { readonly kind: 'error' };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const text = (body: Record<string, unknown>, key: string): string | null => {
  const value = body[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
};

const isoOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/** FE-CR-6's proposed `allowance`, read only when every figure is present and is the server's. */
const allowanceFrom = (body: Record<string, unknown>): AllowanceView => {
  const raw = body['allowance'];
  if (!isRecord(raw) || raw['warning'] !== true) return { kind: 'not_reported' };
  const used = raw['requestsUsedToday'];
  const limit = raw['dailyLimit'];
  if (typeof used !== 'number' || typeof limit !== 'number') return { kind: 'not_reported' };
  return { kind: 'warning', used, limit, resetsAt: isoOrNull(raw['resetsAt']) };
};

export const outcomeFromGateway = ({ status, body }: GatewayResponse): AssistantOutcome => {
  const record = isRecord(body) ? body : null;
  const code = record === null ? null : record['code'];

  if (status === 429 && code === '45012') {
    // `BE-W161`: the gateway sends the reset instant inside `allowance` (`limitReached`), not at
    // the top level.
    const allowance = record?.['allowance'];
    return {
      kind: 'at_limit',
      resetsAt: isRecord(allowance) ? isoOrNull(allowance['resetsAt']) : null,
    };
  }
  if ((status === 503 && code === 'no_provider') || (status === 403 && code === '45011')) {
    return { kind: 'not_available' };
  }
  if (status !== 200 || record === null) return { kind: 'error' };

  const allowance = allowanceFrom(record);
  switch (record['kind']) {
    case 'answered': {
      const answer = text(record, 'answer');
      if (answer === null) return { kind: 'error' };
      // A stub reply is never an answer, whatever kind it arrived under.
      if (answer.startsWith(STUB_MARKER_PREFIX)) return { kind: 'not_available' };
      return { kind: 'answer', text: answer, allowance };
    }
    case 'out_of_scope':
    case 'patient_specific': {
      const message = text(record, 'message');
      return message === null ? { kind: 'error' } : { kind: 'refusal', text: message, allowance };
    }
    default:
      // `failed`, and anything that is not the contract.
      return { kind: 'error' };
  }
};

/**
 * A request that never got an HTTP answer. React Native's fetch rejects with a `TypeError`
 * ("Network request failed") when there is no connection; that is offline. Anything else is an
 * error the rep can retry.
 */
export const outcomeFromThrown = (error: unknown): AssistantOutcome =>
  error instanceof TypeError ? { kind: 'offline' } : { kind: 'error' };
