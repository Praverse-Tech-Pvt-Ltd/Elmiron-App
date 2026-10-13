/**
 * Live tracking — the decision of WHETHER the phone may track, with no tracking SDK at all.
 *
 * Nothing here records a position. What is fixed: tracking is never on outside working hours, never
 * before the rep has accepted the notice, never while the app is in the background (this app requests
 * no background location -- blocked in the manifest, `plugins/android-release.cjs`), and never unless
 * the company has switched it on. `trackingState` is that rule as code, and `FE-W71`'s tracker
 * (`src/tracking/tracker.tsx`) is started and stopped by it, not beside it. The server holds the same
 * rules again for every position it is sent (`record_location_ping`, `BE-W180`).
 */
export interface TrackingInputs {
  /** The company has switched live tracking on (`live_tracking_enabled`, from the server). */
  readonly companyEnabled: boolean;
  /** The rep accepted the CURRENT live-tracking notice (the server says, `my_live_tracking`). */
  readonly noticeAccepted: boolean;
  /** Inside the territory's working hours, by the SERVER's shift window (`my_shift_window`). */
  readonly withinWorkingHours: boolean;
  /** The app is on screen. */
  readonly foreground: boolean;
  /** The rep started sharing for today, on the server's today (`src/tracking/decide.ts`). */
  readonly dayOpen: boolean;
}

export type TrackingState =
  | 'off_company'
  | 'off_no_notice'
  | 'paused_outside_hours'
  | 'paused_background'
  | 'paused_day_closed'
  | 'active';

/** In order of precedence: the company, the rep's consent, the hours, the day, the screen. */
export const trackingState = (input: TrackingInputs): TrackingState => {
  if (!input.companyEnabled) return 'off_company';
  if (!input.noticeAccepted) return 'off_no_notice';
  if (!input.withinWorkingHours) return 'paused_outside_hours';
  if (!input.dayOpen) return 'paused_day_closed';
  if (!input.foreground) return 'paused_background';
  return 'active';
};

/** What the rep is told, for every state -- tracking is never silent. */
export const TRACKING_WORDS: Readonly<Record<TrackingState, string>> = {
  off_company: 'Live location is off for your company.',
  off_no_notice: 'Live location is off until you read and accept the notice.',
  paused_outside_hours: 'Live location is paused outside your working hours.',
  paused_day_closed: 'Live location is paused: your working day is not open.',
  paused_background: 'Live location is paused while the app is not on screen.',
  active: 'Your live location is being shared with your company during working hours.',
};
