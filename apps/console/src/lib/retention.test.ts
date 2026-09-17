import { describe, expect, it } from 'vitest';
import type { RetentionStatus } from '@fieldforce/core';
import { purgeNotice, retentionFigures, retentionSentence } from './retention';

/**
 * `FE-W13`'s recorded check, as replaced in MR-41 C1.
 *
 * **The old one was INVERTED**: `grep -c "90" <screen>` → `0`. It returned **2**, both prose
 * comments explaining why the figure was *not* printed — so it failed on a correct screen and
 * passed on a wrong one. A screen that printed the word "Ninety" would have satisfied it.
 *
 * **The replacement asserts that the number FOLLOWS the server's**, which is the property that
 * actually matters: the console may print this figure only because `retentionDays` is
 * `public.audio_retention_days()`, the same function that stamps `purge_after`. Two distinct
 * server values are used and the output must differ between them, so a hard-coded 90 fails —
 * and so does a hard-coded anything.
 */
const status = (over: Partial<RetentionStatus> = {}): RetentionStatus => ({
  retentionDays: 90,
  liveCount: 12,
  overdueCount: 0,
  destroyedCount: 41,
  purgeStalled: false,
  readAt: '2026-09-17T08:00:00.000Z',
  auditLogId: 7,
  ...over,
});

describe('FE-W13 — the retention figure comes from the server', () => {
  it('prints the period the server supplied', () => {
    expect(retentionSentence(status({ retentionDays: 90 }))).toMatch(/\b90 days\b/u);
  });

  it('CHANGES when the server changes it — the assertion a hard-coded 90 cannot pass', () => {
    // The whole check. `grep -c "90" -> 0` could not distinguish a screen that reads the value
    // from one that prints a constant; this cannot be satisfied by any constant at all.
    const ninety = retentionSentence(status({ retentionDays: 90 }));
    const thirty = retentionSentence(status({ retentionDays: 30 }));

    expect(thirty).toMatch(/\b30 days\b/u);
    expect(thirty).not.toMatch(/\b90\b/u);
    expect(thirty).not.toEqual(ninety);
  });

  it('prints NO period at all when the server did not supply one — the negative control', () => {
    // Without this, an implementation that fell back to the design's 90 on failure would pass
    // both assertions above while telling the reader a policy value it had not been told.
    const sentence = retentionSentence(null);

    expect(sentence).not.toMatch(/\d/u);
    expect(sentence).toMatch(/could not be read/iu);
  });
});

describe('FE-W13 — the counts say what they mean', () => {
  it('tones an overdue backlog as a warning and an empty one as neutral', () => {
    const clean = retentionFigures(status({ overdueCount: 0 }));
    const late = retentionFigures(status({ overdueCount: 3 }));

    const overdueOf = (rows: readonly { label: string; tone: string; value: number }[]) =>
      rows.find((row) => row.label === 'Past their date');

    expect(overdueOf(clean)?.tone).toBe('neutral');
    expect(overdueOf(late)?.tone).toBe('warning');
    expect(overdueOf(late)?.value).toBe(3);
  });

  it('carries every count through from the server rather than recomputing any of them', () => {
    const rows = retentionFigures(status({ liveCount: 5, overdueCount: 2, destroyedCount: 99 }));

    expect(rows.map((row) => row.value)).toEqual([5, 2, 99]);
  });

  it('warns on a stalled purge independently of the backlog', () => {
    // A stalled purge with an empty backlog is still worth showing: it is the state that
    // produces a backlog tomorrow. If these were the same condition, this would fail.
    expect(purgeNotice(status({ purgeStalled: true, overdueCount: 0 }))).toMatch(/not run/iu);
    expect(purgeNotice(status({ purgeStalled: false, overdueCount: 9 }))).toBeNull();
  });
});
