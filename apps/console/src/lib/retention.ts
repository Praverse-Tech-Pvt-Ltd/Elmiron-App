import type { RetentionStatus } from '@fieldforce/core';

/**
 * Phase 4 E3's retention panel — `FE-W13`, the half that can be asserted.
 *
 * **Why the arithmetic is here and not in the page.** The console's pages are React Server
 * Components and `vitest.config.ts` says exercising those needs a browser or a Next harness,
 * neither of which exists — adding one is a dependency, which this project requires asking
 * about first. So the page stays a binding and every decision it presents lives in a module a
 * `.test.ts` can call. That is the same split `queue.ts` already keeps.
 *
 * **Why this panel may print a number at all, when it refused to before.** It used to say
 * *"the design shows 90 days; printing that here would be this console asserting a policy value
 * it has not been told"*, and that was right. `retentionDays` now comes from
 * `public.audio_retention_days()` — the same function `stamp_audio_retention()` uses to set
 * `purge_after`. One number, two readers. **The console is not printing a copy of the design's
 * figure; it is printing the figure the database enforces**, and if the database's changes this
 * changes with it.
 *
 * That is also why nothing here has a fallback number. A default would be a second source of
 * truth for the one value whose whole justification is that it has only one.
 */

/** The server declined, or could not be reached. Distinct from "it said zero". */
export type RetentionUnavailable = null;

/**
 * The sentence naming the period, or a refusal that names no period.
 *
 * **The negative case prints no digits at all, deliberately.** A reader who sees a number
 * cannot tell whether the console was told it or assumed it, so when it has not been told, it
 * says so instead of degrading to the design's figure.
 */
export const retentionSentence = (status: RetentionStatus | RetentionUnavailable): string =>
  status === null
    ? 'The retention period could not be read from the server. It is not shown here, because a ' +
      'period this console has not been told is not a period it can state.'
    : `Audio is kept for ${String(status.retentionDays)} days from capture, then destroyed. ` +
      'That is the period the database enforces, not a figure held in this console.';

export interface RetentionFigure {
  readonly label: string;
  readonly value: number;
  /** What the number means, in the reader's terms rather than the column's. */
  readonly note: string;
  readonly tone: 'neutral' | 'warning';
}

/**
 * The three counts, each carrying what it means.
 *
 * `overdueCount` is the only one that can be alarming, and it is alarming precisely when it is
 * non-zero: a recording past its purge date still exists. It is toned on the value rather than
 * on `purgeStalled`, because a stalled purge and a backlog are different failures and either
 * can happen without the other.
 */
export const retentionFigures = (status: RetentionStatus): readonly RetentionFigure[] => [
  {
    label: 'Held now',
    value: status.liveCount,
    note: 'Recordings within the period.',
    tone: 'neutral',
  },
  {
    label: 'Past their date',
    value: status.overdueCount,
    note:
      status.overdueCount === 0
        ? 'Nothing is being kept beyond the period.'
        : 'These are past the retention period and still exist. That is the promise not being kept.',
    tone: status.overdueCount === 0 ? 'neutral' : 'warning',
  },
  {
    label: 'Destroyed',
    value: status.destroyedCount,
    note: 'Purged on schedule. The purge writes its own audit row.',
    tone: 'neutral',
  },
];

/**
 * The stalled-purge warning, or nothing.
 *
 * Separate from the overdue count on purpose: `purgeStalled` says the worker is not running,
 * which is a fact about the system, while `overdueCount` says rows are late, which is a fact
 * about the data. A stalled purge with an empty backlog is still worth showing — it is the
 * state that produces the backlog tomorrow.
 */
export const purgeNotice = (status: RetentionStatus): string | null =>
  status.purgeStalled
    ? 'The purge has not run recently. Until it does, the period above is the policy rather ' +
      'than a description of what is on disk.'
    : null;
