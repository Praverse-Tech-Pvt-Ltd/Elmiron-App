/**
 * Phase 4's MR-facing words.
 *
 * The design's five rules are copy decisions as much as layout ones, and three of
 * them live entirely in this file.
 */

/**
 * Rule 1, and it goes at the top of the feed rather than into a policy page.
 *
 * The contract makes it true rather than reassuring: `mrViewedAt` is stamped when
 * the MR opens an analysis, `mrResponse` is attached beside the findings, and the
 * audit log records both. A sentence like this one is only worth printing when the
 * schema behind it can be checked.
 */
export const SEEN_FIRST =
  "You're seeing this before your manager acts on it. Anything you write goes with it.";

/**
 * What happens to the audio behind a quote — the sentence `CitationSpan` requires.
 *
 * **Two different promises, and the MR is told which one they are looking at**
 * before deciding whether to argue with a finding. Audio that still exists can in
 * principle be checked; audio that has been purged cannot, and the transcript is
 * all that is left.
 *
 * `daysLeft` is computed by the caller from the server's purge date, never from a
 * count this module invented.
 */
export const retentionNote = (daysLeft: number | null): string =>
  daysLeft === null || daysLeft <= 0
    ? 'audio deleted at 90 days · transcript kept'
    : `audio kept ${String(daysLeft)} more days`;

/**
 * Why no quote can be played, and it is not hidden.
 *
 * `CitationSpan` takes `onPlay` as optional precisely so a quote can render with
 * no play control when there is nothing to play. There is nothing to play here for
 * a different reason than the one that prop was written for — this app has no
 * audio capability at all, so no recording was ever made — and an MR who was shown
 * a dead play button would conclude the recording exists and the app is broken.
 *
 * Removed the day audio capture lands (FE-W4).
 */
export const NO_AUDIO_NOTE =
  'The words are from the transcript. This build cannot play audio back — nothing was recorded to play.';

/**
 * Rule 5, said out loud on the trend rather than left as an absence.
 *
 * §3.6 bans a score, a rank and a percentile, and that half of the line was never
 * lifted. An MR looking at a chart will assume it is being compared to something;
 * saying whose numbers these are is what stops the assumption.
 */
export const TREND_NOTE = 'Yours only — nobody else’s, and not a score.';

/** Rule 3. The reply is a first-class object, so its screen says what it is for. */
export const REPLY_NOTE =
  'Your manager sees this next to the finding, not underneath it. If you disagree, say so — that is what this is for.';

/**
 * The sampling ratio, in words.
 *
 * The design added this and defended it: "an MR who believes every visit is
 * analysed behaves like someone under total observation. The ratio is the
 * difference between sampling and surveillance, and it is true, so say it."
 */
export const reviewedNote = (reviewed: number, total: number): string =>
  `${String(reviewed)} ${reviewed === 1 ? 'visit' : 'visits'} reviewed of ${String(total)}`;
