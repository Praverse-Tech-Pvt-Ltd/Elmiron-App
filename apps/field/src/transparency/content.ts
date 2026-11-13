import type { TransparencyEntry, TransparencyState } from '@fieldforce/ui';
import { t } from '@fieldforce/ui/i18n';
import type { TextKey } from '@fieldforce/ui/i18n';
import { liveTrackingScreenOffEnabled } from '../features';

/**
 * A9 — "Everything, before you ask." The design's structure and voice
 * (`docs/design/phase2-first-run-and-the-day.dc.html` §A9), stating what THIS BUILD records.
 *
 * **FE-D12 item 1. Every row is now a fact about the code, and each is cited in the FE-D12 section
 * of `PROJECT-OVERVIEW.md`, not here and not on screen.** The rows were written in FE-W3, when
 * nothing was captured, as `not-yet` with a preamble saying the app "records nothing new about
 * you". Check-ins, positions, samples, reports and voice notes all landed after that, and the
 * screen kept saying the opposite. `content.test.ts` now reads the capturing routes and fails if a
 * row calls a wired capture "not yet".
 *
 * **Where this departs from the design's copy, the design was describing a different product:**
 * - "Where you are, during your shift · Start day to End day" describes continuous tracking.
 *   This build takes ONE fix per check-in or check-out press, and none at any other time.
 * - "Kept 90 days, then deleted" -- what the server does is stamp `purge_after` 90 days from
 *   receipt on every voice note. Deletion depends on the purge job running, so the row says
 *   "marked for deletion".
 * - "anything at all once your shift ends" is not something this client enforces, so it is not
 *   claimed. What is claimed is what the APK holds no permission for.
 *
 * There is no preamble any more. It existed to say "none of the list below is built yet", and the
 * list now says what is recorded.
 *
 * Copy is factually accurate but needs privacy/legal review; no owner named.
 *
 * **`FE-W155`. The words are in the catalogue, read when shown.** Each row's `title` and `detail`
 * are getters, so a row built once (`TRANSPARENCY_ENTRIES`) still reads the language in use.
 */
const entry = (
  titleKey: TextKey,
  detailKey: TextKey,
  state: TransparencyState,
): TransparencyEntry => ({
  get title(): string {
    return t(titleKey);
  },
  get detail(): string {
    return t(detailKey);
  },
  state,
});

/** The "what we never record" sentence for a build without live tracking. */
export const neverRecorded = (): string => t('transparency.neverRecorded');

/**
 * `FE-W71`. With live tracking in the build, "nothing in the background" is still true -- there is
 * no background location -- but "only at the moment you press check in or check out" is not: while
 * the rep shares live location, a position is read every few minutes with the app on screen. So the
 * sentence the build shows follows the build, as the recordings row does.
 */
// `FE-W207`: with the screen-off service in the build, "nothing in the background" is not the claim.
export const neverRecordedWithLiveTracking = (): string =>
  liveTrackingScreenOffEnabled
    ? t('transparency.neverRecordedLiveScreenOff')
    : t('transparency.neverRecordedLive');

export const neverRecordedFor = (build: { readonly liveTrackingEnabled: boolean }): string =>
  build.liveTrackingEnabled ? neverRecordedWithLiveTracking() : neverRecorded();

export const transparencyEntries = (build: {
  readonly recordingEnabled: boolean;
  /** `FE-W71`. Absent is off, which is every build that does not set `EXPO_PUBLIC_LIVE_TRACKING`. */
  readonly liveTrackingEnabled?: boolean;
}): readonly TransparencyEntry[] => [
  // `FE-W185`. "Never between visits" is false while the rep shares live location, so a build with
  // live location says only what stays true; the live row below says when else it is read.
  entry(
    'transparency.checkInLocation',
    build.liveTrackingEnabled === true
      ? 'transparency.checkInLocationDetailLive'
      : 'transparency.checkInLocationDetail',
    'active',
  ),
  ...(build.liveTrackingEnabled === true
    ? [
        entry(
          'transparency.liveLocation',
          liveTrackingScreenOffEnabled
            ? 'transparency.liveLocationDetailScreenOff'
            : 'transparency.liveLocationDetail',
          'active',
        ),
      ]
    : []),
  entry('transparency.visits', 'transparency.visitsDetail', 'active'),
  entry('transparency.voiceNotes', 'transparency.voiceNotesDetail', 'active'),
  entry('transparency.reports', 'transparency.reportsDetail', 'active'),
  entry(
    'transparency.recordings',
    'transparency.recordingsDetail',
    build.recordingEnabled ? 'active' : 'not-yet',
  ),
];

/** This build: consultation recording is off unless the build sets it (`config.ts:34`). */
export const TRANSPARENCY_ENTRIES: readonly TransparencyEntry[] = transparencyEntries({
  recordingEnabled: false,
});
