/**
 * `BE-W214` — AI Doctor practice by voice: the rep's spoken turn becomes text, the doctor's reply
 * becomes speech. Both through OpenAI, with the same key and the same rules as `openai-provider.ts`.
 *
 * **IMPLEMENTED, NOT LIVE VERIFIED.** Every branch is proved against a mocked `fetch`
 * (`services/api/tests/openai-speech.spec.ts`); no call has been made to OpenAI from this code.
 *
 * **Nothing here decides anything.** The spoken turn, once it is text, goes through `takeDoctorTurn`
 * exactly as a typed one does: the same patient-detail guardrail before the model, the same stored
 * turn, the same request log and allowance. Voice changes how the words arrive and leave, nothing else.
 *
 * **The audio is not kept.** The rep's recording is held in memory for the one transcription request
 * and dropped; the doctor's speech is returned to the phone and not stored. What is kept is the text,
 * in `sim_turns`, as for a typed turn.
 *
 * The key is used only in the `Authorization` header, never logged, returned or put in an error.
 */

export const OPENAI_TRANSCRIPTION_URL = 'https://api.openai.com/v1/audio/transcriptions';
export const OPENAI_SPEECH_URL = 'https://api.openai.com/v1/audio/speech';
export const OPENAI_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';
export const OPENAI_SPEECH_MODEL = 'gpt-4o-mini-tts';
export const OPENAI_SPEECH_VOICE = 'sage';

/** The audio formats the phone's recorder produces, and OpenAI accepts. */
export const ACCEPTED_AUDIO = {
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
} as const;
export type AcceptedAudioType = keyof typeof ACCEPTED_AUDIO;

/**
 * At most about a minute of speech: the phone records 32 kbit/s mono, so a minute is ~240 KB. The cap
 * is far above that and far below anything that would hold the gateway's memory for long.
 */
export const MAX_AUDIO_BYTES = 1_500_000;

/** The longest reply that is spoken. A longer one is still shown, in full, as text. */
export const MAX_SPOKEN_CHARS = 1_200;

/** Words the transcriber is told to expect, so drug names and medical terms come through spelled. */
const TRANSCRIPTION_PROMPT =
  'A pharmaceutical sales representative in India speaking to a doctor in a practice role-play, in ' +
  'English that may include Hindi words. Medical terms and brand names are likely.';

const SPEECH_INSTRUCTIONS =
  'You are a busy doctor in an Indian clinic, in a practice role-play with a medical representative. ' +
  'Speak naturally and at a normal conversational pace, as you would across a desk.';

/** Vendor answers that mean "no voice here" (a refused key, no credit), not "say that again". */
export const SPEECH_UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  'no_key',
  'invalid_api_key',
  'http_401',
  'insufficient_quota',
  'model_not_found',
  'http_403',
]);

export class SpeechError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'SpeechError';
  }
}

export interface RepAudio {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly mimeType: AcceptedAudioType;
}

/**
 * The rep's audio from the request body, or the reason it cannot be used. Read here, not trusted:
 * the type must be one the recorder makes, and the size within the cap.
 */
export const readRepAudio = (
  value: unknown,
): { readonly audio: RepAudio } | { readonly refused: string } => {
  const record =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  const base64 = record?.['base64'];
  const mimeType = record?.['mimeType'];
  if (typeof base64 !== 'string' || base64.length === 0)
    return { refused: 'repAudio.base64 is required' };
  if (typeof mimeType !== 'string' || !(mimeType in ACCEPTED_AUDIO)) {
    return {
      refused: `repAudio.mimeType must be one of ${Object.keys(ACCEPTED_AUDIO).join(', ')}`,
    };
  }
  // Base64 is 4 characters per 3 bytes: refuse an oversized body before decoding it.
  if (Math.floor((base64.length * 3) / 4) > MAX_AUDIO_BYTES) {
    return { refused: 'repAudio is longer than a spoken turn can be' };
  }
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const binary = atob(base64);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  } catch {
    return { refused: 'repAudio.base64 is not base64' };
  }
  if (bytes.length === 0) return { refused: 'repAudio is empty' };
  return { audio: { bytes, mimeType: mimeType as AcceptedAudioType } };
};

/** Bytes to base64, in chunks so a long reply never builds one enormous argument list. */
export const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

const vendorCode = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { error?: { code?: unknown; type?: unknown } } | null;
    for (const candidate of [body?.error?.code, body?.error?.type]) {
      if (typeof candidate === 'string' && /^[A-Za-z0-9_.-]{1,48}$/u.test(candidate))
        return candidate;
    }
  } catch {
    // Not JSON: fall through to the status.
  }
  return `http_${String(response.status)}`;
};

export interface SpeechClient {
  /** The rep's words, or '' when nothing was said. */
  readonly transcribe: (audio: RepAudio, signal?: AbortSignal) => Promise<string>;
  /** The doctor's reply as MP3 bytes. */
  readonly speak: (text: string, signal?: AbortSignal) => Promise<Uint8Array>;
}

export const createOpenAiSpeech = (config: {
  readonly apiKey: string | undefined;
  readonly fetch?: typeof fetch;
}): SpeechClient => {
  const apiKey = config.apiKey?.trim() ?? '';
  if (apiKey === '') throw new SpeechError('no_key');
  const doFetch = config.fetch ?? fetch;

  return {
    transcribe: async (audio, signal) => {
      const form = new FormData();
      form.append(
        'file',
        new Blob([audio.bytes], { type: audio.mimeType }),
        `turn.${ACCEPTED_AUDIO[audio.mimeType]}`,
      );
      form.append('model', OPENAI_TRANSCRIPTION_MODEL);
      form.append('prompt', TRANSCRIPTION_PROMPT);
      form.append('response_format', 'json');
      const response = await doFetch(OPENAI_TRANSCRIPTION_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        ...(signal === undefined ? {} : { signal }),
      });
      if (!response.ok) throw new SpeechError(await vendorCode(response));
      const body = (await response.json()) as { text?: unknown } | null;
      if (typeof body?.text !== 'string') throw new SpeechError('malformed_response');
      return body.text.trim();
    },

    speak: async (text, signal) => {
      const response = await doFetch(OPENAI_SPEECH_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OPENAI_SPEECH_MODEL,
          voice: OPENAI_SPEECH_VOICE,
          input: text.slice(0, MAX_SPOKEN_CHARS),
          instructions: SPEECH_INSTRUCTIONS,
          response_format: 'mp3',
        }),
        ...(signal === undefined ? {} : { signal }),
      });
      if (!response.ok) throw new SpeechError(await vendorCode(response));
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length === 0) throw new SpeechError('malformed_response');
      return bytes;
    },
  };
};

/** What a spoken turn adds to the doctor-turn result. */
export interface VoiceExtras {
  /** What the rep was heard to say — shown on the phone, and stored as the turn's text. */
  readonly repText: string;
  /** The doctor's reply as speech, or null when it could not be made (the text still stands). */
  readonly doctorAudio: { readonly base64: string; readonly mimeType: 'audio/mpeg' } | null;
}

/**
 * One spoken turn: authorise the session, transcribe, take the turn as text, speak the reply.
 *
 * * The session is read FIRST, as the rep, so audio for a session that is not theirs is refused
 *   before any of it is sent to OpenAI.
 * * Nothing said (silence, a cough) is `no_speech` — no turn is taken, no request is counted.
 * * A reply that cannot be spoken is still a reply: it arrives as text with `doctorAudio: null`.
 */
export const takeSpokenTurn = async <TurnResult extends { readonly kind: string }>(input: {
  readonly audio: RepAudio;
  readonly speech: SpeechClient;
  readonly authorise: () => Promise<void>;
  readonly takeTurn: (repText: string) => Promise<TurnResult>;
  readonly replyText: (result: TurnResult) => string | null;
  readonly timeoutMs?: number;
}): Promise<{ readonly kind: 'no_speech' } | (TurnResult & VoiceExtras)> => {
  await input.authorise();
  const repText = await withSignal(input.timeoutMs ?? 20_000, (signal) =>
    input.speech.transcribe(input.audio, signal),
  );
  if (repText.length === 0) return { kind: 'no_speech' };

  const result = await input.takeTurn(repText);
  const reply = input.replyText(result);
  let doctorAudio: VoiceExtras['doctorAudio'] = null;
  if (reply !== null && reply.trim().length > 0) {
    try {
      const bytes = await withSignal(input.timeoutMs ?? 20_000, (signal) =>
        input.speech.speak(reply, signal),
      );
      doctorAudio = { base64: toBase64(bytes), mimeType: 'audio/mpeg' };
    } catch {
      // The reply stands as text; the phone shows it and says the voice did not come through.
      doctorAudio = null;
    }
  }
  return { ...result, repText, doctorAudio };
};

const withSignal = async <T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, ms);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new SpeechError('timeout');
    throw error;
  } finally {
    clearTimeout(timer);
  }
};
