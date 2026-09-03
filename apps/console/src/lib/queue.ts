import type { Analysis, ConsentRecord, Finding, FindingCategory } from '@fieldforce/core';

/**
 * Phase 4 E1's arithmetic — the manager's coaching queue.
 *
 * > **NOTHING HERE MAY RANK ONE MR AGAINST ANOTHER.**
 * >
 * > `frontend-plan-v2.md` §3.6 bans "any ranking, score, rank, percentile or
 * > grade — not for MRs, not in the console, not 'just a sort order'". The
 * > 3 September reversals reopened the coaching *screens*, twice; neither touched
 * > the scoring ban. `manager.ts` says the same at the top of its own file:
 * > "adding an ordering here would invert the meaning of the whole surface."
 * >
 * > So the queue is a filter, not a league table. A row appears because a pattern
 * > repeated, and the rows carry no number that could order one MR above another.
 * > The only sort is by name.
 */

/** How many times a category must recur before it is a pattern rather than a day. */
export const PATTERN_THRESHOLD = 2;

export interface QueueRow {
  readonly mrId: string;
  /** Every finding in this category, with the analysis each came from. */
  readonly occurrences: readonly { readonly analysisId: string; readonly finding: Finding }[];
  readonly category: FindingCategory;
  /** The finding's own words, taken from the first occurrence. */
  readonly pattern: string;
  /** Analyses that exist for this MR — the sampling denominator. */
  readonly reviewed: number;
  /** True when the MR has replied to at least one of these analyses. */
  readonly replied: boolean;
}

/**
 * MRs whose analyses show the same category more than once.
 *
 * **Exception-first, and everyone else is absent.** The design's own line: "Four
 * MRs show the same weakness twice or more. Everyone else is not listed — that is
 * the point." A queue that listed the whole team would be an activity feed, and a
 * manager reading one starts comparing.
 *
 * A row is a *category* that recurred, not an MR — one person with two different
 * repeated patterns is two rows, because they are two coaching conversations.
 */
export const queueRows = (
  analyses: readonly Analysis[],
  threshold = PATTERN_THRESHOLD,
): readonly QueueRow[] => {
  const byMr = new Map<string, Analysis[]>();
  for (const analysis of analyses) {
    byMr.set(analysis.mrId, [...(byMr.get(analysis.mrId) ?? []), analysis]);
  }

  const rows: QueueRow[] = [];

  for (const [mrId, mrAnalyses] of byMr) {
    const byCategory = new Map<FindingCategory, { analysisId: string; finding: Finding }[]>();
    for (const analysis of mrAnalyses) {
      for (const finding of analysis.findings) {
        // `info` is what went well. A pattern of things going well is not a
        // coaching queue entry, and putting it here would make the queue a
        // performance view of the person rather than a list of conversations.
        if (finding.severity === 'info') continue;
        byCategory.set(finding.category, [
          ...(byCategory.get(finding.category) ?? []),
          { analysisId: analysis.id, finding },
        ]);
      }
    }

    for (const [category, occurrences] of byCategory) {
      if (occurrences.length < threshold) continue;
      const head = occurrences[0];
      if (head === undefined) continue;
      rows.push({
        mrId,
        category,
        occurrences,
        pattern: head.finding.title,
        reviewed: mrAnalyses.length,
        replied: mrAnalyses.some((analysis) => analysis.mrResponse !== null),
      });
    }
  }

  // Sorted by MR id, which is arbitrary and deliberately so. Any ordering that
  // meant something — most findings first, least replied first — would be the
  // ranking §3.6 forbids, wearing a sort order as a disguise.
  return rows.sort((a, b) => a.mrId.localeCompare(b.mrId) || a.category.localeCompare(b.category));
};

export interface ConsentSignal {
  readonly consented: number;
  readonly total: number;
  /** Whole percent. A rate, not a rating — see below. */
  readonly rate: number;
  /** MRs at 100% over a meaningful number of visits. */
  readonly perfect: readonly string[];
}

/**
 * The consent rate, and it is a data-quality signal.
 *
 * **A high rate is not a win.** `manager.ts` says it in the contract:
 * `consent_rate_anomaly` "always carries `signal: 'data_quality'`", and an MR at
 * 100% while the team sits at 40% is a fraud signal. Phase 4 draws the same
 * warning. This function therefore surfaces perfect scorers as something to look
 * at rather than as the top of a list — and there is no per-MR rate returned at
 * all, because a column of percentages per person is a league table however it is
 * labelled.
 */
export const consentSignal = (
  records: readonly ConsentRecord[],
  minimumVisits = 10,
): ConsentSignal => {
  const decided = records.filter((record) => !record.isWithdrawal);
  const consented = decided.filter((record) => record.outcome === 'consented').length;

  const byMr = new Map<string, { yes: number; total: number }>();
  for (const record of decided) {
    const current = byMr.get(record.capturedByMrId) ?? { yes: 0, total: 0 };
    byMr.set(record.capturedByMrId, {
      yes: current.yes + (record.outcome === 'consented' ? 1 : 0),
      total: current.total + 1,
    });
  }

  return {
    consented,
    total: decided.length,
    rate: decided.length === 0 ? 0 : Math.round((consented / decided.length) * 100),
    perfect: [...byMr.entries()]
      .filter(([, count]) => count.total >= minimumVisits && count.yes === count.total)
      .map(([mrId]) => mrId),
  };
};
