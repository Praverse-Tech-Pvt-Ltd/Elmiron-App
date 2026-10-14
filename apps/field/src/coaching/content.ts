import { t } from '@fieldforce/ui/i18n';

/**
 * Phase 4's MR-facing words.
 *
 * The design's five rules are copy decisions as much as layout ones, and three of
 * them live entirely in this file.
 *
 * `FE-W158`. Each is a function now, read at render, so a language change repaints it; the
 * English is in the catalogue under `coaching.*`, `analysis.*` and `reply.*`.
 */

/**
 * Rule 1, and it goes at the top of the feed rather than into a policy page.
 *
 * The contract makes it true rather than reassuring: `mrViewedAt` is stamped when
 * the MR opens an analysis, `mrResponse` is attached beside the findings, and the
 * audit log records both. A sentence like this one is only worth printing when the
 * schema behind it can be checked.
 */
/**
 * FE-D16. Why the feed cannot fill in this build. True of the build, not a guess: an analysis
 * is made from a recorded consultation, and `appConfig.recordingEnabled` is off. It does not
 * claim the AI key is missing, because the app has no signal for that.
 */
export const coachingUnavailable = (): { readonly title: string; readonly detail: string } => ({
  title: t('coaching.unavailableTitle'),
  detail: t('coaching.unavailableDetail'),
});

/** FE-D16. On every analysis: a model wrote it, not a person. */
export const aiProvenanceNote = (): string => t('analysis.aiProvenance');

/** FE-D16. A completed analysis the server returned with no findings (FE-CR-8). */
export const noFindingsNote = (): string => t('analysis.noFindings');

export const seenFirst = (): string => t('coaching.seenFirst');

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
    ? t('analysis.audioDeleted')
    : t('analysis.audioKept', { days: daysLeft });

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
export const noAudioNote = (): string => t('analysis.noAudio');

/**
 * Rule 5, said out loud on the trend rather than left as an absence.
 *
 * §3.6 bans a score, a rank and a percentile, and that half of the line was never
 * lifted. An MR looking at a chart will assume it is being compared to something;
 * saying whose numbers these are is what stops the assumption.
 */
export const trendNote = (): string => t('coaching.trendNote');

/** Rule 3. The reply is a first-class object, so its screen says what it is for. */
export const replyNote = (): string => t('reply.note');

/**
 * The sampling ratio, in words.
 *
 * The design added this and defended it: "an MR who believes every visit is
 * analysed behaves like someone under total observation. The ratio is the
 * difference between sampling and surveillance, and it is true, so say it."
 */
export const reviewedNote = (reviewed: number, total: number): string =>
  t('coaching.reviewed', { count: reviewed, total });
