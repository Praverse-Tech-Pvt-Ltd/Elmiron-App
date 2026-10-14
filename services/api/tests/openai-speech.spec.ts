import { describe, expect, it, vi } from 'vitest';
import {
  MAX_AUDIO_BYTES,
  OPENAI_SPEECH_MODEL,
  OPENAI_SPEECH_URL,
  OPENAI_TRANSCRIPTION_MODEL,
  OPENAI_TRANSCRIPTION_URL,
  SPEECH_UNAVAILABLE_CODES,
  SpeechError,
  createOpenAiSpeech,
  readRepAudio,
  takeSpokenTurn,
  toBase64,
} from '../supabase/functions/_shared/openai-speech.ts';
import type { SpeechClient } from '../supabase/functions/_shared/openai-speech.ts';

/**
 * `BE-W214` — AI Doctor practice by voice. Every OpenAI call here is a mocked `fetch`: no request
 * leaves this machine, and the key below is made up.
 */
const KEY = 'sk-test-not-a-real-key';
const AUDIO = { bytes: new Uint8Array([1, 2, 3, 4]), mimeType: 'audio/mp4' as const };

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('readRepAudio — the request body is read, not trusted', () => {
  it('decodes base64 audio of an accepted type', () => {
    const read = readRepAudio({
      base64: toBase64(new Uint8Array([9, 8, 7])),
      mimeType: 'audio/mp4',
    });
    expect('audio' in read && Array.from(read.audio.bytes)).toEqual([9, 8, 7]);
  });

  it('refuses a missing body, an unknown type, bad base64 and an oversized turn', () => {
    expect(readRepAudio(undefined)).toEqual({ refused: 'repAudio.base64 is required' });
    const wrongType = readRepAudio({ base64: 'AAAA', mimeType: 'video/mp4' });
    expect('refused' in wrongType && wrongType.refused).toMatch(/mimeType/u);
    expect(readRepAudio({ base64: '***', mimeType: 'audio/mp4' })).toEqual({
      refused: 'repAudio.base64 is not base64',
    });
    const huge = 'A'.repeat(Math.ceil(((MAX_AUDIO_BYTES + 10) * 4) / 3));
    expect(readRepAudio({ base64: huge, mimeType: 'audio/mp4' })).toEqual({
      refused: 'repAudio is longer than a spoken turn can be',
    });
  });
});

describe('createOpenAiSpeech', () => {
  it('will not exist without a key', () => {
    expect(() => createOpenAiSpeech({ apiKey: '  ' })).toThrow(SpeechError);
  });

  it('transcribes: the audio as a file, the model, the key only in Authorization', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { text: '  Good morning doctor  ' })),
    );
    const speech = createOpenAiSpeech({ apiKey: KEY, fetch: fetchMock });

    await expect(speech.transcribe(AUDIO)).resolves.toBe('Good morning doctor');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OPENAI_TRANSCRIPTION_URL);
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${KEY}`);
    const form = init.body as FormData;
    expect(form.get('model')).toBe(OPENAI_TRANSCRIPTION_MODEL);
    expect((form.get('file') as File).name).toBe('turn.m4a');
    expect(JSON.stringify([...form.entries()].filter(([k]) => k !== 'file'))).not.toContain(KEY);
  });

  it('speaks: JSON body with the model and the reply text, MP3 bytes back', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(new Uint8Array([0xff, 0xfb, 1]), { status: 200 })),
    );
    const speech = createOpenAiSpeech({ apiKey: KEY, fetch: fetchMock });

    const bytes = await speech.speak('Tell me about the evidence.');
    expect(Array.from(bytes)).toEqual([0xff, 0xfb, 1]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OPENAI_SPEECH_URL);
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent['model']).toBe(OPENAI_SPEECH_MODEL);
    expect(sent['input']).toBe('Tell me about the evidence.');
    expect(sent['response_format']).toBe('mp3');
  });

  it('a vendor failure is its short code, never its message', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse(401, { error: { code: 'invalid_api_key', message: `bad key ${KEY}` } }),
      ),
    );
    const speech = createOpenAiSpeech({ apiKey: KEY, fetch: fetchMock });
    const failure = await speech.transcribe(AUDIO).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SpeechError);
    expect((failure as SpeechError).code).toBe('invalid_api_key');
    expect((failure as SpeechError).message).not.toContain(KEY);
    // A refused key means voice is unavailable here, not that the rep should say it again.
    expect(SPEECH_UNAVAILABLE_CODES.has('invalid_api_key')).toBe(true);
    expect(SPEECH_UNAVAILABLE_CODES.has('http_500')).toBe(false);
  });

  it('a transcription without text is malformed', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(200, { nothing: true })));
    const speech = createOpenAiSpeech({ apiKey: KEY, fetch: fetchMock });
    await expect(speech.transcribe(AUDIO)).rejects.toMatchObject({ code: 'malformed_response' });
  });
});

describe('takeSpokenTurn — the order is the guarantee', () => {
  type Turn = { kind: 'replied'; reply: string } | { kind: 'patient_specific'; message: string };

  const fakeSpeech = (
    heard: string,
    spoken: Uint8Array | Error,
  ): SpeechClient & {
    calls: string[];
  } => {
    const calls: string[] = [];
    return {
      calls,
      transcribe: () => {
        calls.push('transcribe');
        return Promise.resolve(heard);
      },
      speak: () => {
        calls.push('speak');
        return spoken instanceof Error ? Promise.reject(spoken) : Promise.resolve(spoken);
      },
    };
  };

  it('authorises the session BEFORE any audio is transcribed', async () => {
    const speech = fakeSpeech('hello', new Uint8Array([1]));
    const order: string[] = [];
    await expect(
      takeSpokenTurn<Turn>({
        audio: AUDIO,
        speech,
        authorise: () => {
          order.push('authorise');
          return Promise.reject(Object.assign(new Error('not your session'), { code: '42501' }));
        },
        takeTurn: () => Promise.resolve({ kind: 'replied', reply: 'x' }),
        replyText: () => null,
      }),
    ).rejects.toMatchObject({ code: '42501' });
    expect(order).toEqual(['authorise']);
    expect(speech.calls).toEqual([]);
  });

  it('the heard words are the turn; the reply comes back with its speech', async () => {
    const speech = fakeSpeech('Doctor, may I show you the data?', new Uint8Array([7, 7]));
    const takeTurn = vi.fn((): Promise<Turn> =>
      Promise.resolve({ kind: 'replied', reply: 'Go on.' }),
    );
    const result = await takeSpokenTurn<Turn>({
      audio: AUDIO,
      speech,
      authorise: () => Promise.resolve(),
      takeTurn,
      replyText: (turn) => (turn.kind === 'replied' ? turn.reply : null),
    });
    expect(takeTurn).toHaveBeenCalledWith('Doctor, may I show you the data?');
    expect(result).toEqual({
      kind: 'replied',
      reply: 'Go on.',
      repText: 'Doctor, may I show you the data?',
      doctorAudio: { base64: toBase64(new Uint8Array([7, 7])), mimeType: 'audio/mpeg' },
    });
  });

  it('silence is no_speech: no turn is taken, nothing is counted', async () => {
    const takeTurn = vi.fn((): Promise<Turn> => Promise.resolve({ kind: 'replied', reply: 'x' }));
    const result = await takeSpokenTurn<Turn>({
      audio: AUDIO,
      speech: fakeSpeech('', new Uint8Array([1])),
      authorise: () => Promise.resolve(),
      takeTurn,
      replyText: () => 'x',
    });
    expect(result).toEqual({ kind: 'no_speech' });
    expect(takeTurn).not.toHaveBeenCalled();
  });

  it('a guardrail refusal is passed through and nothing is spoken', async () => {
    const speech = fakeSpeech('the patient Ramesh Kumar, 9876543210', new Uint8Array([1]));
    const result = await takeSpokenTurn<Turn>({
      audio: AUDIO,
      speech,
      authorise: () => Promise.resolve(),
      takeTurn: () => Promise.resolve({ kind: 'patient_specific', message: 'No patient details.' }),
      replyText: (turn) => (turn.kind === 'replied' ? turn.reply : null),
    });
    expect(result).toMatchObject({ kind: 'patient_specific', doctorAudio: null });
    expect(speech.calls).toEqual(['transcribe']);
  });

  it('a reply that cannot be spoken still arrives, as text', async () => {
    const result = await takeSpokenTurn<Turn>({
      audio: AUDIO,
      speech: fakeSpeech('hello', new SpeechError('http_500')),
      authorise: () => Promise.resolve(),
      takeTurn: () => Promise.resolve({ kind: 'replied', reply: 'Hello.' }),
      replyText: (turn) => (turn.kind === 'replied' ? turn.reply : null),
    });
    expect(result).toMatchObject({ kind: 'replied', reply: 'Hello.', doctorAudio: null });
  });
});
