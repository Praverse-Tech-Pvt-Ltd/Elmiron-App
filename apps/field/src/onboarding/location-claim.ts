import type { TextKey } from '@fieldforce/ui/i18n';
import type { TrackingState } from '../integrations/tracking';
import { liveTrackingScreenOffEnabled } from '../features';

/**
 * `FE-W185` — what the first-run location screen promises about WHEN a position is read, chosen so
 * it is true for the phone in hand.
 *
 * It said "This app never asks your phone for a position at any other moment" in every build. With
 * live location in the build, a rep who accepted the notice and started sharing has their position
 * read every few minutes — so on that phone the sentence was false, on the screen whose whole job
 * is to be believed. Three cases now, each true:
 *
 * - **No live location for this rep** (not in the build, or the signed-in user is not a rep, so no
 *   tracker is mounted): only at check-in and check-out, never otherwise — as before.
 * - **Live location exists but is not running now**: check-in and check-out, AND — only if the rep
 *   accepts the notice and starts sharing — every few minutes in working hours, on screen.
 * - **Sharing right now** (`active`): said first and plainly, with where to stop it.
 */
export interface LocationClaim {
  readonly title: TextKey;
  readonly detail: TextKey;
}

export const locationClaim = (input: {
  /** `liveTrackingEnabled`, the build flag. */
  readonly liveBuild: boolean;
  /** The tracker's state, or null when no tracker is mounted (`useLiveTracker()` is null). */
  readonly trackerState: TrackingState | null;
}): LocationClaim => {
  if (!input.liveBuild || input.trackerState === null) {
    return { title: 'onboarding.locationOnlyPress', detail: 'onboarding.locationOnlyPressDetail' };
  }
  if (input.trackerState === 'active') {
    return {
      title: 'onboarding.locationSharingNow',
      // `FE-W207`: with the screen-off service, "on screen" is not the condition.
      detail: liveTrackingScreenOffEnabled
        ? 'onboarding.locationSharingNowDetailScreenOff'
        : 'onboarding.locationSharingNowDetail',
    };
  }
  return {
    title: 'onboarding.locationWithLive',
    detail: liveTrackingScreenOffEnabled
      ? 'onboarding.locationWithLiveDetailScreenOff'
      : 'onboarding.locationWithLiveDetail',
  };
};
