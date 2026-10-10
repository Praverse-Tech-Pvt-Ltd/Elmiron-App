/**
 * Voice — speech-to-text and text-to-speech, as interfaces, with a text fallback.
 *
 * Recording already exists (voice notes, `app/voice-note/`). TURNING SPEECH INTO TEXT, or text into
 * speech, needs a provider that is not chosen or credentialed (`TranscriptionProvider` in
 * `packages/core/src/field/gateway/providers.ts` is the server-side seam). Until then every screen
 * that could take speech takes typing, and says so -- no screen waits on a provider.
 */
export type SpeechResult =
  | { readonly kind: 'text'; readonly text: string }
  /** No provider: the screen offers typing instead. Never an empty transcript. */
  | { readonly kind: 'unavailable' };

export interface SpeechToText {
  readonly transcribe: (audioUri: string) => Promise<SpeechResult>;
}

export interface TextToSpeech {
  /** False when nothing was spoken; the text stays on screen either way. */
  readonly speak: (text: string) => Promise<boolean>;
}

/** The implementation until a provider exists: nothing is transcribed, nothing is spoken. */
export const unavailableSpeechToText: SpeechToText = {
  transcribe: () => Promise.resolve({ kind: 'unavailable' }),
};

export const silentTextToSpeech: TextToSpeech = {
  speak: () => Promise.resolve(false),
};

export const TYPE_INSTEAD = 'Speech-to-text is not available yet. Type your note instead.';

/** What the screen shows for a transcription attempt: the text, or the typing fallback. */
export const transcriptOrFallback = (
  result: SpeechResult,
): { text: string; fallback: string | null } =>
  result.kind === 'text' && result.text.trim() !== ''
    ? { text: result.text.trim(), fallback: null }
    : { text: '', fallback: TYPE_INSTEAD };
