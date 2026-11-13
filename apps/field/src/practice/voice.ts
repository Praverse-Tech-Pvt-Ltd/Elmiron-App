import { STUB_MARKER_PREFIX } from './contract';
import type { GatewayResponse, PracticeSession, SpokenTurnBody } from './contract';

/**
 * `FE-W163` — AI Doctor practice by voice, hands-free: the rules, with no device in them.
 *
 * The conversation is a loop the rep starts once: **listen → the rep stops talking → send → the doctor
 * answers out loud → listen again.** Two things decide it, both here and both tested:
 *
 * 1. **When the rep has finished speaking** (`listenStep`), from the microphone's level. The level is
 *    compared against the room's own quiet, measured as it goes, so a noisy corridor and a quiet cabin
 *    both work: speech is a level well above the quietest the phone has heard this turn.
 * 2. **What a spoken reply means** (`spokenTurnOutcome`), from the gateway's answer.
 *
 * The rep's recording goes to the gateway, is turned into text there, and is not kept; the TEXT is the
 * turn, stored and scored exactly as a typed one. The typing box stays: voice is another way in.
 */

export const spokenTurnBody = (session: PracticeSession, base64: string): SpokenTurnBody => ({
  feature: 'ai_doctor',
  sessionId: session.sessionId,
  repAudio: { base64, mimeType: 'audio/mp4' },
});

export type SpokenTurnOutcome =
  | {
      readonly kind: 'replied';
      readonly heard: string;
      readonly reply: string;
      /** The doctor's reply as MP3, base64; null when it could not be spoken (the text stands). */
      readonly audio: string | null;
    }
  /** Nothing was said — a cough, the room. No turn was taken; listen again. */
  | { readonly kind: 'no_speech' }
  /** Patient details: refused before the model, as for typed text. */
  | { readonly kind: 'refused'; readonly message: string }
  /** The recording reached the gateway but could not be heard. Say it again. */
  | { readonly kind: 'not_heard' }
  /** No speech service here (no AI key, or the sample): type instead. */
  | { readonly kind: 'voice_unavailable' }
  | { readonly kind: 'not_available' }
  | { readonly kind: 'at_limit' }
  | { readonly kind: 'offline' }
  | { readonly kind: 'error' };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const spokenTurnOutcome = ({ status, body }: GatewayResponse): SpokenTurnOutcome => {
  const record = isRecord(body) ? body : null;
  const code = record?.['code'];
  if (status === 429 && code === '45012') return { kind: 'at_limit' };
  if ((status === 503 && code === 'no_provider') || (status === 403 && code === '45011')) {
    return { kind: 'not_available' };
  }
  if (status === 503 && code === 'voice_unavailable') return { kind: 'voice_unavailable' };
  if (status === 502 && code === 'voice_failed') return { kind: 'not_heard' };
  if (status !== 200 || record === null) return { kind: 'error' };

  if (record['kind'] === 'no_speech') return { kind: 'no_speech' };
  if (record['kind'] === 'patient_specific' && typeof record['message'] === 'string') {
    return { kind: 'refused', message: record['message'] };
  }
  if (record['kind'] === 'replied') {
    const reply = record['reply'];
    const heard = record['repText'];
    if (typeof reply !== 'string' || reply.trim().length === 0) return { kind: 'error' };
    if (reply.startsWith(STUB_MARKER_PREFIX)) return { kind: 'not_available' };
    const audio = record['doctorAudio'];
    const base64 = isRecord(audio) && typeof audio['base64'] === 'string' ? audio['base64'] : null;
    return {
      kind: 'replied',
      heard: typeof heard === 'string' ? heard : '',
      reply: reply.trim(),
      audio: base64 !== null && base64.length > 0 ? base64 : null,
    };
  }
  return { kind: 'error' };
};

/**
 * When to stop listening. Levels are the recorder's metering, in dBFS (about -160 silent, 0 loudest),
 * sampled every `SAMPLE_MS`.
 */
export const LISTEN = {
  SAMPLE_MS: 150,
  /** Speech is this far above the quietest level heard this turn… */
  ABOVE_QUIET_DB: 14,
  /** …and never quieter than this, so a silent room's -90 does not make a breath "speech". */
  FLOOR_DB: -52,
  /** This much speech before a pause can end the turn: a click or a cough is not a turn. */
  MIN_SPEECH_MS: 450,
  /** A pause this long after speech ends the turn. */
  END_SILENCE_MS: 1_400,
  /** The longest turn; it is sent as it is. The gateway refuses about a minute and more. */
  MAX_TURN_MS: 45_000,
  /** Nobody spoke for this long: stop, and let the rep tap to carry on. */
  NOTHING_SAID_MS: 12_000,
} as const;

export interface ListenState {
  readonly elapsedMs: number;
  /** The quietest level this turn — the room. */
  readonly quietDb: number;
  readonly speechMs: number;
  readonly silenceAfterSpeechMs: number;
}

export const LISTEN_START: ListenState = {
  elapsedMs: 0,
  quietDb: 0,
  speechMs: 0,
  silenceAfterSpeechMs: 0,
};

export type ListenDecision = 'listening' | 'hearing' | 'send' | 'nothing_said';

/** One metering sample in; the next state and what to do. `level` undefined: the phone gave none. */
export const listenStep = (
  state: ListenState,
  level: number | undefined,
  dtMs: number = LISTEN.SAMPLE_MS,
): { readonly state: ListenState; readonly decision: ListenDecision } => {
  const elapsedMs = state.elapsedMs + dtMs;
  const db = typeof level === 'number' && Number.isFinite(level) ? level : -160;
  const quietDb = state.elapsedMs === 0 ? db : Math.min(state.quietDb, db);
  const speaking = db >= Math.max(quietDb + LISTEN.ABOVE_QUIET_DB, LISTEN.FLOOR_DB);

  const speechMs = state.speechMs + (speaking ? dtMs : 0);
  const heardEnough = speechMs >= LISTEN.MIN_SPEECH_MS;
  const silenceAfterSpeechMs = speaking ? 0 : heardEnough ? state.silenceAfterSpeechMs + dtMs : 0;
  const next: ListenState = { elapsedMs, quietDb, speechMs, silenceAfterSpeechMs };

  if (
    heardEnough &&
    (silenceAfterSpeechMs >= LISTEN.END_SILENCE_MS || elapsedMs >= LISTEN.MAX_TURN_MS)
  ) {
    return { state: next, decision: 'send' };
  }
  if (!heardEnough && elapsedMs >= LISTEN.NOTHING_SAID_MS) {
    return { state: next, decision: 'nothing_said' };
  }
  return { state: next, decision: speechMs > 0 ? 'hearing' : 'listening' };
};
