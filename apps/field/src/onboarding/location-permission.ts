import type { AndroidPermissionResult } from './notification-permission';

/**
 * FE-D2 first run — A2 and S4 ask Android for FOREGROUND location. The permission, nothing else.
 *
 * Operator rulings (28 September):
 *   - `PermissionsAndroid`, fine and coarse together (Android shows them as one dialog), and **no
 *     position is read here**. A2 used to call `takeFix`, which asked and then took a fix; A2's own
 *     copy says the app reads a position "only when you press check in or check out".
 *   - **Approximate only** (coarse without fine, offered from Android 12) **is granted.** The rep
 *     said yes; a check-in then records an approximate position.
 *   - `never_ask_again` is its own answer, `blocked`: Android will not show the prompt again, so S4
 *     opens the app's settings instead of re-asking into silence.
 *   - **Never background location** (`REQUESTS_BACKGROUND_LOCATION`, and the test that scans for it).
 *
 * Pure, with the request passed in, so the rule runs under the node-side runner; the screens
 * supply `PermissionsAndroid.requestMultiple`. Both permissions are already in the manifest.
 */

export const ACCESS_FINE_LOCATION = 'android.permission.ACCESS_FINE_LOCATION';
export const ACCESS_COARSE_LOCATION = 'android.permission.ACCESS_COARSE_LOCATION';

/** What first run does next depends on which of these it got. */
export type LocationAnswer = 'granted' | 'denied' | 'blocked' | 'unanswered';

export interface LocationPermissionDeps {
  readonly requestMultiple: (
    permissions: [typeof ACCESS_FINE_LOCATION, typeof ACCESS_COARSE_LOCATION],
  ) => Promise<Partial<Record<string, AndroidPermissionResult>>>;
}

export const requestLocationPermission = async (
  deps: LocationPermissionDeps,
): Promise<LocationAnswer> => {
  try {
    const answers = await deps.requestMultiple([ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION]);
    const fine = answers[ACCESS_FINE_LOCATION];
    const coarse = answers[ACCESS_COARSE_LOCATION];
    if (fine === 'granted' || coarse === 'granted') return 'granted';
    if (fine === 'never_ask_again' || coarse === 'never_ask_again') return 'blocked';
    return 'denied';
  } catch {
    // No activity, a request already in flight: nobody answered, so nothing was granted.
    return 'unanswered';
  }
};
