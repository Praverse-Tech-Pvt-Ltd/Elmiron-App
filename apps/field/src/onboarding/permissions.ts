/**
 * What the app may do, and — much more importantly — what it still does when the
 * answer is no.
 *
 * The design's claim about S4 is that the app must **fully work with location
 * denied**, and that this is what makes a later re-ask honest rather than coercive.
 * That is a property of the whole app, not of one screen, so it is expressed here as
 * functions that can be asserted rather than as a paragraph nobody can test.
 *
 * Three rules, each with a function that enforces it:
 *
 *   1. **No route is blocked.** `reachableRoutes` takes the permission state and
 *      ignores it. The test compares every combination against the granted case.
 *   2. **No banner persists across screens.** `persistentBannerFor` returns `null`,
 *      always. S4 is a screen the MR navigates to, not a bar that follows them.
 *   3. **No nag loop.** `shouldPromptForLocation` is false on every launch, every
 *      screen and every timer. The only path to a re-ask is the MR opening S4.
 *
 * These read as tautologies, and that is deliberate — they are tautologies that a
 * future `if (location === 'denied')` would break, which is the entire point. The
 * cheapest way to lose this property is for someone to add a reasonable-looking
 * guard six months from now.
 */

/** Android's three answers. `undetermined` is "not asked yet", not a soft denial. */
export type PermissionState = 'granted' | 'denied' | 'undetermined';

export interface OnboardingPermissions {
  readonly location: PermissionState;
  /**
   * Requested at sign-in alongside location. See `notifications.ts` for the four
   * types this covers and the cap on them.
   */
  readonly notifications: PermissionState;
  /**
   * **Deferred to the first real visit, never asked at sign-in.**
   *
   * The design's reason: asking for a microphone before the MR has seen a single
   * benefit is the abandonment moment. It is modelled here so that a sign-in flow
   * that requested it would have to delete this comment to do so.
   */
  readonly microphone: PermissionState;
}

/**
 * Every route a signed-in MR can reach.
 *
 * Held as data so that rule 1 can be asserted as an equality between two computed
 * lists rather than by reading the router.
 */
export const REACHABLE_ROUTES = [
  '/home',
  '/doctors',
  '/queue',
  '/onboarding/battery',
  '/onboarding/notifications',
  '/onboarding/microphone',
  '/onboarding/location-denied',
] as const;

export type AppRoute = (typeof REACHABLE_ROUTES)[number];

/**
 * Rule 1. Which routes are reachable given these permissions: all of them.
 *
 * The parameter is accepted and deliberately unused. Removing it would make the
 * property untestable — a test can only demonstrate that permissions do not affect
 * navigation if permissions are something this function could, in principle, have
 * looked at.
 */
export const reachableRoutes = (_permissions: OnboardingPermissions): readonly AppRoute[] =>
  REACHABLE_ROUTES;

/**
 * Rule 2. The persistent banner, which does not exist.
 *
 * A bar that rides along the top of every screen saying location is off is the nag
 * loop wearing a different hat: it is unavoidable, it is present during work that has
 * nothing to do with location, and its only action is the one the MR already
 * declined. S4 is a destination instead.
 */
export const persistentBannerFor = (_permissions: OnboardingPermissions): null => null;

/**
 * How the MR can record a visit.
 *
 * **Manual is in both lists, and it is first in neither by accident** — it is a
 * first-class path, not a fallback that appears when something is broken. An MR who
 * denied location uses the same manual check-in as one who granted it and is standing
 * somewhere with no signal.
 */
export type CheckInMethod = 'manual' | 'automatic';

export const checkInMethodsFor = (permissions: OnboardingPermissions): readonly CheckInMethod[] =>
  permissions.location === 'granted' ? ['manual', 'automatic'] : ['manual'];

/**
 * Why the app might ask about location. Exhaustive on purpose: adding a reason means
 * editing this union, which is a visible change in a review.
 */
export type LocationAskTrigger =
  /** Cold start. */
  | 'app-launch'
  /** Any screen becoming visible. */
  | 'screen-focus'
  /** A timer, a retry counter, "it's been a week". */
  | 'elapsed-time'
  /** The MR pressed "Turn location back on" on S4. */
  | 'explicit-user-request';

/**
 * Rule 3. Whether to raise the system location prompt.
 *
 * Only ever true for `explicit-user-request`, and only when the state is not already
 * granted. Everything else is a nag: the MR answered, the app heard them, and asking
 * again on the next launch is how an app converts a considered "no" into a habit of
 * dismissing whatever it puts on screen.
 *
 * Note what is absent — there is no attempt counter, no backoff, no "ask again after
 * N days". Those are all designs for asking repeatedly, and this does not ask
 * repeatedly.
 */
export const shouldPromptForLocation = (
  trigger: LocationAskTrigger,
  permissions: OnboardingPermissions,
): boolean => trigger === 'explicit-user-request' && permissions.location !== 'granted';

/**
 * Whether to ask for the microphone. Never at sign-in; only when a visit has actually
 * started, and only once the MR has reached the point where recording is the thing
 * they are trying to do.
 */
export const shouldPromptForMicrophone = (
  context: 'sign-in' | 'first-visit',
  permissions: OnboardingPermissions,
): boolean => context === 'first-visit' && permissions.microphone === 'undetermined';

/**
 * **This sprint does not request background location, and this constant says so.**
 *
 * Two separate reasons, either sufficient:
 *
 *   - Android will not grant `ACCESS_BACKGROUND_LOCATION` in the same system prompt
 *     as foreground location. It is always a second, later request from a settings
 *     screen, so a sign-in flow cannot obtain it however it is written.
 *   - `FE-W3-SPEC` (PROJECT-OVERVIEW.md, 31 August) raises it as an open decision:
 *     the permission triggers a Google Play declaration whose listed acceptable uses
 *     are all user-benefiting features, and an employee-monitoring framing is not
 *     among them. That is a decision for a human and it has not been made.
 *
 * Continuous location, geofencing and shift enforcement are plan W5. Nothing in this
 * sprint requests, declares or prepares for background location.
 */
export const REQUESTS_BACKGROUND_LOCATION = false;
