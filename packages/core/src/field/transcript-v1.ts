import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema } from '../shared/primitives.js';

/**
 * Contract **I3** — the transcript, as the real contract.
 *
 * MR-50 B, 22 September 2026. The operator decided to KEEP the AI layer (`C7`, `.ai-collab/decisions.md`),
 * which answers the ship-or-cut question the 30 September deadline existed to force. This is not a
 * placeholder: it is designed from what the stages after transcription need (`docs/mr-app-plan.md` —
 * redact → detect → analyse), contract-first, the way I1 and I2 were. **It does not choose a vendor**:
 * that still needs a measured Hinglish error rate on labelled audio (`blocked-on-you` 4.2, MR-50 B4).
 *
 * Built on `TranscriptV0` rather than beside it: every V0 field survives with the same meaning, and
 * V0 stays exported so consumers move deliberately. What V1 adds, and why:
 *
 * | Added | For |
 * | --- | --- |
 * | `id` | what `FindingCitation.transcriptId` points at (`analysis.ts`) |
 * | `source` | which audio this came from — the database requires exactly one of recording / voice note (`transcripts_raw_one_source`), and the retention purge cascades by it |
 * | segment `index` | reading order that survives diarization overlap, where `startMs` alone cannot order two speakers talking at once |
 * | segment `confidence` REQUIRED, nullable | redaction and adverse-event screening must know when to distrust a span; `null` says "the vendor gave none" out loud, where V0's optional field let it vanish |
 * | `tokens` with `startChar`/`endChar` | **stable span offsets**: redaction (§0.3, the gate) and citations point into the RAW text by segment id + offsets, so the pointer survives without the raw text ever leaving the gate |
 * | token `language` | **code-switching inside a segment.** A Hinglish sentence switches mid-segment; one tag per segment is wrong for half of it. Whisper-class models *"often lead to deletions when a switch to a different language occurs"* (mr-app-plan §0.5) — the switch points are exactly what must be measurable |
 *
 * **Offsets are Unicode CODE POINTS into `segment.text`, half-open `[startChar, endChar)`.** Not
 * UTF-16 units (what a JS string index counts) and not bytes: Devanagari and Latin are both in the
 * BMP so the two agree for Hinglish, but a vendor emitting an emoji or a supplementary-plane
 * character would silently shift every UTF-16 offset after it. Code points are what Postgres
 * (`char_length`) and Python (`str` indexing) count; what each STT vendor counts is to be checked in
 * the bake-off, and a vendor's offsets are converted at the edge, never trusted as-is.
 *
 * **Provider-agnostic by construction** (V0's rule, kept): no vendor field names or enums. Where a
 * provider may not return something — word timings, word confidence, word language — it is optional
 * or nullable, so a provider that omits it still conforms.
 */

/** BCP-47. Script subtags are allowed and matter here: romanised Hindi is `hi-Latn`, not `hi`. */
const LanguageTagSchema = z.string().min(2).max(35);

/**
 * A span of the segment's text — usually a word — that something downstream can point into.
 *
 * `text` must equal the code-point slice `[startChar, endChar)` of the segment's text; the parent
 * schema checks it. A pointer that does not match what it points at is worse than none.
 */
export const TranscriptTokenV1Schema = z.object({
  text: z.string().min(1),
  startChar: z.number().int().nonnegative(),
  endChar: z.number().int().positive(),
  /** Audio time of the token, where the vendor gives word timings. */
  startMs: z.number().int().nonnegative().optional(),
  endMs: z.number().int().nonnegative().optional(),
  /**
   * The token's own language, where it differs from — or confirms — the segment's. This is how a
   * code-switched segment is represented: `language: 'hi-Latn'` on the segment, `en` on "BP" and
   * "dose". Optional, because not every vendor tags per word.
   */
  language: LanguageTagSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type TranscriptTokenV1 = z.infer<typeof TranscriptTokenV1Schema>;

export const TranscriptSegmentV1Schema = z.object({
  /** Stable. Citations and redaction spans point at it; it never changes once issued. */
  id: UuidSchema,
  /** Reading order, 0-based. Overlapping speech means `startMs` cannot order segments alone. */
  index: z.number().int().nonnegative(),
  /**
   * Diarization label, as in V0: not a name and not a role. Mapping `speaker_0` to "the MR" is an
   * inference, and inferences do not belong in a transcript.
   */
  speakerLabel: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  /** The RAW text. Only the redacted transcript leaves the redaction gate. */
  text: z.string(),
  /** The segment's dominant language. Per-token tags are authoritative where present. */
  language: LanguageTagSchema,
  /**
   * 0–1, or `null` when the vendor gives no segment confidence. Required so an absence is stated,
   * not inferred: screening must not treat "no score" as "fine".
   */
  confidence: z.number().min(0).max(1).nullable(),
  /** Ascending, non-overlapping spans covering the words of `text`. */
  tokens: z.array(TranscriptTokenV1Schema),
});
export type TranscriptSegmentV1 = z.infer<typeof TranscriptSegmentV1Schema>;

export const TranscriptSourceV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('recording'), recordingId: UuidSchema }),
  z.object({ kind: z.literal('voice_note'), voiceNoteId: UuidSchema }),
]);
export type TranscriptSourceV1 = z.infer<typeof TranscriptSourceV1Schema>;

const codePoints = (text: string): readonly string[] => Array.from(text);

export const TranscriptV1Schema = z
  .object({
    schemaVersion: z.literal('v1'),
    /** What `FindingCitation.transcriptId` refers to. */
    id: UuidSchema,
    visitId: UuidSchema,
    source: TranscriptSourceV1Schema,
    /** Free-form, as in V0: enumerating vendors is the decision the bake-off exists to make. */
    vendor: z.string().min(1),
    modelVersion: z.string().min(1),
    /** For display only. Segment and token tags are authoritative. */
    primaryLanguage: LanguageTagSchema,
    durationMs: z.number().int().nonnegative(),
    segments: z.array(TranscriptSegmentV1Schema),
    transcribedAt: IsoDateTimeSchema,
  })
  .superRefine((transcript, ctx) => {
    const ids = new Set<string>();
    const indexes = new Set<number>();
    transcript.segments.forEach((segment, s) => {
      const at = ['segments', s];
      if (ids.has(segment.id)) {
        ctx.addIssue({
          code: 'custom',
          path: [...at, 'id'],
          message: 'segment ids must be unique',
        });
      }
      ids.add(segment.id);
      if (indexes.has(segment.index)) {
        ctx.addIssue({
          code: 'custom',
          path: [...at, 'index'],
          message: 'segment indexes must be unique',
        });
      }
      indexes.add(segment.index);
      if (segment.endMs < segment.startMs) {
        ctx.addIssue({
          code: 'custom',
          path: [...at, 'endMs'],
          message: 'a segment cannot end before it starts',
        });
      }
      if (segment.endMs > transcript.durationMs) {
        ctx.addIssue({
          code: 'custom',
          path: [...at, 'endMs'],
          message: 'a segment cannot end after the audio does',
        });
      }

      const chars = codePoints(segment.text);
      let previousEnd = 0;
      segment.tokens.forEach((token, t) => {
        const tokenAt = [...at, 'tokens', t];
        if (token.endChar <= token.startChar) {
          ctx.addIssue({
            code: 'custom',
            path: tokenAt,
            message: 'a token span must be non-empty',
          });
          return;
        }
        if (token.startChar < previousEnd) {
          ctx.addIssue({
            code: 'custom',
            path: tokenAt,
            message: 'token spans must ascend without overlap',
          });
        }
        if (token.endChar > chars.length) {
          ctx.addIssue({
            code: 'custom',
            path: tokenAt,
            message: 'a token span runs past the segment text',
          });
        } else if (chars.slice(token.startChar, token.endChar).join('') !== token.text) {
          ctx.addIssue({
            code: 'custom',
            path: [...tokenAt, 'text'],
            message: 'token text must equal the code-point slice it points at',
          });
        }
        if (
          token.startMs !== undefined &&
          token.endMs !== undefined &&
          token.endMs < token.startMs
        ) {
          ctx.addIssue({
            code: 'custom',
            path: [...tokenAt, 'endMs'],
            message: 'a token cannot end before it starts',
          });
        }
        previousEnd = token.endChar;
      });
    });
  });
export type TranscriptV1 = z.infer<typeof TranscriptV1Schema>;
