import type { Analysis, Finding, FindingCategory, Visit } from '@fieldforce/core';

/**
 * Phase 4 D1's arithmetic, and the one file in this app most able to do harm.
 *
 * > **NOTHING HERE MAY PRODUCE A SCORE.**
 * >
 * > `frontend-plan-v2.md` §3.6 bans "any ranking, score, rank, percentile or
 * > grade — not for MRs, not in the console, not 'just a sort order'", and calls
 * > it a regulatory line rather than a preference. That half of §3.6 has **not**
 * > been lifted: the 3 September decision reopened the coaching *screens*, not the
 * > scoring ban. Backend has tests asserting those column names do not exist, and
 * > `analysis.ts` opens by saying a composite score is "unappealable and useless
 * > as coaching".
 * >
 * > A count of a behaviour against the same MR's own previous months is not a
 * > score. A count compared to anybody else's would be one, and there is no shape
 * > in this file that can express that: `trend` takes one MR's analyses and has
 * > nowhere to put a second person's.
 */

/**
 * How much of the MR's work was actually looked at.
 *
 * **This ratio is on the screen deliberately, and the design says why.** An MR who
 * believes every visit is analysed behaves like someone under total observation.
 * Most visits are never reviewed, and stating that is the difference between
 * sampling and surveillance. Hiding it would make the system feel total when it is
 * not — so `reviewed` is never rendered without `total` beside it.
 */
export interface ReviewedRatio {
  readonly reviewed: number;
  readonly total: number;
}

export const reviewedRatio = (
  analyses: readonly Analysis[],
  visits: readonly Visit[],
): ReviewedRatio => ({
  // A refused or failed analysis still means the visit was looked at, so it counts
  // here. Only a visit with no analysis row at all was never sampled.
  reviewed: new Set(analyses.map((analysis) => analysis.visitId)).size,
  total: visits.filter((visit) => visit.status !== 'cancelled').length,
});

/**
 * `info` findings are what worked; `improvement` and `concern` are what to try.
 *
 * Two severities collapse into one kind on purpose. The MR-facing distinction that
 * matters is "this went well" against "this is worth doing differently"; splitting
 * `concern` into its own louder treatment would reintroduce severity as a ranking
 * of the MR through the back door, and §3.6 bans a severity control on an adverse
 * event for the same reason.
 */
export const isWorkedWell = (finding: Finding): boolean => finding.severity === 'info';

/**
 * The findings, ordered: what worked, then what to try.
 *
 * **Nothing is dropped.** Phase 4 says "two worked, one to try — never a list of
 * six failures", and that is a rubric obligation rather than a UI one: a screen
 * that truncated would hide a finding the MR has a right to read and contest, and
 * the citation is the whole basis of contesting it. If an analysis arrives with
 * six improvements, the screen shows six and the rubric is what needs fixing.
 */
export const orderedFindings = (analysis: Analysis): readonly Finding[] => [
  ...analysis.findings.filter(isWorkedWell),
  ...analysis.findings.filter((finding) => !isWorkedWell(finding)),
];

/** "02:14" from a citation's millisecond offset. */
export const timestampFrom = (startMs: number): string => {
  const total = Math.floor(startMs / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

export interface TrendPoint {
  /** "Aug" — formatted by the caller's month labels, never a rank. */
  readonly label: string;
  readonly count: number;
}

/**
 * One behaviour, counted per month, for this MR and nobody else.
 *
 * **The comparison is always to their own past.** There is no parameter here for
 * a team, a peer or a target, and adding one would turn this into the ranking §3.6
 * forbids. The count is of findings in a category — an observable behaviour — not
 * of anything weighted or combined.
 *
 * Months come from `generatedAt`, the server's stamp, sliced rather than parsed:
 * the contract sends an offset and parsing it re-expresses the month in whatever
 * timezone the handset is set to, which at a month boundary moves a finding into
 * the wrong bar.
 */
export const trendFor = (
  analyses: readonly Analysis[],
  category: FindingCategory,
  months: readonly string[],
): readonly TrendPoint[] =>
  months.map((month) => ({
    label: month.slice(5, 7),
    count: analyses
      .filter((analysis) => analysis.generatedAt?.slice(0, 7) === month)
      .reduce(
        (running, analysis) =>
          running + analysis.findings.filter((finding) => finding.category === category).length,
        0,
      ),
  }));

/**
 * What the MR is told about an analysis that produced nothing.
 *
 * `refused` is a first-class outcome in the contract — "when the model cannot
 * produce a cited finding without speculating, refusing is correct behaviour and
 * the UI shows it as such". Showing it as an error would teach the MR that a
 * refusal is a fault, when it is the system declining to guess about them.
 */
export const statusNote = (analysis: Analysis): string | null => {
  switch (analysis.status) {
    case 'completed':
      return null;
    case 'pending':
      return 'This visit is still being looked at. Nothing has been written yet.';
    case 'refused':
      return (
        analysis.refusalReason ??
        'Nothing could be said about this visit without guessing, so nothing was. That is the system working, not failing.'
      );
    case 'failed':
      return 'This one could not be processed. Nobody has seen anything about this visit.';
  }
};
