import { describe, expect, it } from 'vitest';
import * as field from './index.js';
import type { TranscriptTokenV1, TranscriptV1 } from './index.js';

/**
 * Contract I3 — the transcript schema exists, and holds a real Hinglish consultation.
 *
 * ---
 * **WHY THIS NO LONGER CHECKS A DATE — MR-50 B3, 22 September 2026.**
 *
 * This file used to fail the build on 2026-09-30T23:59:59+05:30 unless a `TranscriptV1Schema` was
 * exported. BE-W6 wrote it so the `TranscriptV0` placeholder could not quietly become permanent, and
 * MR-38 gave it a warning window. **The date was never the point; the question behind it was: does
 * the AI layer ship, or is it cut?** On 22 September 2026 the operator answered it — **keep the AI
 * layer** (`C7`, `.ai-collab/decisions.md`) — and `TranscriptV1` was designed as the real contract
 * (`transcript-v1.ts`), not as a placeholder to satisfy this file.
 *
 * So the deadline has done its job and is retired. What replaces it is the thing the deadline was a
 * proxy for: that the contract exists and **accepts the hard case** — a code-switched Hinglish
 * segment with per-token languages and exact span offsets — and **rejects** a transcript that is
 * missing what downstream stages need. The vendor choice is still open (`blocked-on-you` 4.2); this
 * file does not pretend otherwise.
 * ---
 */

/** Words → tokens with exact code-point offsets, so the fixture's pointers are honest. */
const tokens = (text: string, languages: readonly string[]): TranscriptTokenV1[] => {
  const chars = Array.from(text);
  const out: TranscriptTokenV1[] = [];
  let i = 0;
  let w = 0;
  while (i < chars.length) {
    while (i < chars.length && chars[i] === ' ') i += 1;
    const start = i;
    while (i < chars.length && chars[i] !== ' ') i += 1;
    if (i > start) {
      const language = languages[w];
      out.push({
        text: chars.slice(start, i).join(''),
        startChar: start,
        endChar: i,
        ...(language === undefined ? {} : { language }),
      });
      w += 1;
    }
  }
  return out;
};

/** The code-switched line: romanised Hindi carrying English clinical terms, mid-sentence. */
const HINGLISH = 'Doctor sahab, BP ki dose kam kar dijiye, patient ko dizziness ho rahi thi';
const HINGLISH_LANGS = [
  'en',
  'hi-Latn',
  'en',
  'hi-Latn',
  'en',
  'hi-Latn',
  'hi-Latn',
  'hi-Latn',
  'en',
  'hi-Latn',
  'en',
  'hi-Latn',
  'hi-Latn',
  'hi-Latn',
];

/** A reply in Devanagari — combining marks make code points differ from visible characters. */
const DEVANAGARI = 'जी, मैं अगली विज़िट में देखूँगा';

/** A realistic two-speaker transcript of a short MR–doctor exchange. */
const realistic = (): TranscriptV1 => ({
  schemaVersion: 'v1',
  id: '7a1f3c2e-0b4d-4e6f-8a9b-1c2d3e4f5a61',
  visitId: '44444444-4444-4444-8444-444444444401',
  source: { kind: 'recording', recordingId: '9b8c7d6e-5f4a-4b3c-8d2e-1f0a9b8c7d61' },
  vendor: 'bake-off-candidate',
  modelVersion: 'unversioned-fixture',
  primaryLanguage: 'hi-Latn',
  durationMs: 12_000,
  transcribedAt: '2026-09-22T06:00:00.000Z',
  segments: [
    {
      id: '0c1d2e3f-4a5b-4c6d-8e7f-8a9b0c1d2e31',
      index: 0,
      speakerLabel: 'speaker_0',
      startMs: 0,
      endMs: 6_400,
      text: HINGLISH,
      language: 'hi-Latn',
      confidence: 0.71,
      tokens: tokens(HINGLISH, HINGLISH_LANGS),
    },
    {
      id: '0c1d2e3f-4a5b-4c6d-8e7f-8a9b0c1d2e32',
      index: 1,
      speakerLabel: 'speaker_1',
      // Overlaps the first segment: people talk over each other. `index` orders them.
      startMs: 6_100,
      endMs: 9_800,
      text: DEVANAGARI,
      language: 'hi-Deva',
      // The vendor gave no segment score. Stated, not omitted.
      confidence: null,
      tokens: tokens(DEVANAGARI, []),
    },
  ],
});

describe('I3 — TranscriptV1 is the real contract', () => {
  it('is exported from @fieldforce/core/field', () => {
    expect('TranscriptV1Schema' in field).toBe(true);
  });

  it('accepts a realistic Hinglish consultation, code-switch and all', () => {
    const parsed = field.TranscriptV1Schema.safeParse(realistic());
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('carries the code-switch INSIDE a segment, word by word', () => {
    const segment = realistic().segments[0];
    const byLanguage = (tag: string): string[] =>
      (segment?.tokens ?? []).filter((t) => t.language === tag).map((t) => t.text);
    expect(byLanguage('en')).toEqual(['Doctor', 'BP', 'dose', 'patient', 'dizziness']);
    expect(byLanguage('hi-Latn')).toContain('dijiye,');
  });

  it('points exactly: each token is the code-point slice it names, in Devanagari too', () => {
    for (const segment of realistic().segments) {
      const chars = Array.from(segment.text);
      for (const token of segment.tokens) {
        expect(chars.slice(token.startChar, token.endChar).join('')).toBe(token.text);
      }
    }
  });

  it('still exports TranscriptV0, so consumers move deliberately rather than by breakage', () => {
    expect('TranscriptV0Schema' in field).toBe(true);
  });
});

describe('I3 — TranscriptV1 rejects what downstream stages cannot use', () => {
  const rejects = (mutate: (t: TranscriptV1) => unknown): boolean =>
    !field.TranscriptV1Schema.safeParse(mutate(realistic())).success;

  it('rejects a segment with no confidence field at all — null must be SAID', () => {
    expect(
      rejects((t) => ({
        ...t,
        segments: t.segments.map((segment) => {
          const without: Record<string, unknown> = { ...segment };
          delete without['confidence'];
          return without;
        }),
      })),
    ).toBe(true);
  });

  it('rejects a token whose text is not what its offsets point at', () => {
    expect(
      rejects((t) => {
        const [first, ...others] = t.segments;
        if (first === undefined) return t;
        const [token, ...restTokens] = first.tokens;
        if (token === undefined) return t;
        return {
          ...t,
          segments: [
            { ...first, tokens: [{ ...token, text: 'Patient' }, ...restTokens] },
            ...others,
          ],
        };
      }),
    ).toBe(true);
  });

  it('rejects a transcript that does not say which audio it came from', () => {
    expect(
      rejects((t) => {
        const without: Record<string, unknown> = { ...t };
        delete without['source'];
        return without;
      }),
    ).toBe(true);
  });

  it('rejects a segment that ends after the audio does', () => {
    expect(rejects((t) => ({ ...t, durationMs: 5_000 }))).toBe(true);
  });
});
