import type { AndroidPermissionResult } from './notification-permission';

/**
 * `FE-W161` — an Expo permission answer, read as the Android answer the first-run rules expect.
 *
 * First run's rules (`location-permission.ts`, `notification-permission.ts`) are written against
 * what `PermissionsAndroid` answers, and they are pure and tested. On iOS `PermissionsAndroid` does
 * nothing: every request resolves to `denied` (or `{}`), so an iPhone would land on "location is
 * off" without ever being asked. iOS is asked through the Expo modules instead (`expo-location`,
 * `expo-notifications`, `expo-audio`), and their answer is translated here so the same rules decide
 * what happens next.
 *
 * The one translation that matters: **iOS shows its prompt once.** After a "Don't Allow" it reports
 * `canAskAgain: false`, which is Android's `never_ask_again` — so S4 opens the app's settings rather
 * than asking into silence, exactly as it does on Android after "Don't ask again".
 */

/** The shape every Expo permission response shares. */
export interface ExpoPermissionAnswer {
  readonly granted: boolean;
  readonly canAskAgain: boolean;
}

export const asAndroidResult = (answer: ExpoPermissionAnswer): AndroidPermissionResult => {
  if (answer.granted) return 'granted';
  return answer.canAskAgain ? 'denied' : 'never_ask_again';
};
