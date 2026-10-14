/**
 * `FE-W161` — the native permission requests first run makes, per platform.
 *
 * **Android is exactly what it was:** `PermissionsAndroid`, which the screens called directly before
 * this file existed. **iOS** has no `PermissionsAndroid` (it answers `denied` to everything without
 * asking), so it is asked through the Expo modules, and the answer is translated by
 * `asAndroidResult` for the rules in `location-permission.ts` and `notification-permission.ts`.
 *
 * Foreground location only, on both: `requestForegroundPermissionsAsync`, which on iOS is "While
 * Using the App". Nothing here asks for more (`no-background-location.test.ts`).
 *
 * `expo-location` is already loaded by the app (check-in, live location); `expo-notifications` is
 * imported on use, on iOS only, as `src/push/push-provider.tsx` does. The microphone is asked in
 * `os-microphone.ts`, so only the screens that ask for it load `expo-audio`.
 */

import { PermissionsAndroid, Platform } from 'react-native';
import * as Location from 'expo-location';
import type { ACCESS_COARSE_LOCATION, ACCESS_FINE_LOCATION } from './location-permission';
import type { AndroidPermissionResult, POST_NOTIFICATIONS } from './notification-permission';
import { POST_NOTIFICATIONS_MIN_API } from './notification-permission';
import { asAndroidResult } from './os-permission-answer';

/** Read at each call, not at import: the platform is a fact of the call (and tests set it). */
export const isIos = (): boolean => Platform.OS === 'ios';

/** Foreground location: Android's fine-and-coarse dialog, or iOS's "While Using the App". */
export const requestLocationAnswers = async (
  permissions: [typeof ACCESS_FINE_LOCATION, typeof ACCESS_COARSE_LOCATION],
): Promise<Partial<Record<string, AndroidPermissionResult>>> => {
  if (!isIos()) return PermissionsAndroid.requestMultiple(permissions);
  const answer = asAndroidResult(await Location.requestForegroundPermissionsAsync());
  const [fine, coarse] = permissions;
  return { [fine]: answer, [coarse]: answer };
};

/**
 * The "API level" `requestNotificationPermission` decides by. iOS always has a notification
 * permission to ask for, so it is given the level from which Android has one too.
 */
export const notificationApiLevel = (): number => {
  if (isIos()) return POST_NOTIFICATIONS_MIN_API;
  return typeof Platform.Version === 'number' ? Platform.Version : 0;
};

export const requestNotificationAnswer = async (
  permission: typeof POST_NOTIFICATIONS,
): Promise<AndroidPermissionResult> => {
  if (!isIos()) return PermissionsAndroid.request(permission);
  const Notifications = await import('expo-notifications');
  return asAndroidResult(await Notifications.requestPermissionsAsync());
};
