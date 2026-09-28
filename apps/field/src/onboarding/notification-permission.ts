import type { PermissionState } from './permissions';

/**
 * FE-D2 first run — A3's "Allow notifications" asks Android, where there is a question to ask.
 *
 * **`POST_NOTIFICATIONS` exists only from Android 13 (API 33).** Below that, notifications are
 * allowed by default and the permission does not exist, so there is nothing to request and the
 * answer is `granted` (operator ruling). From 33 up it is a runtime permission, requested here.
 *
 * Pure, with the platform passed in, for the reason `store.ts` gives for its boundary: the rule
 * is logic and belongs under the node-side runner, and `PermissionsAndroid` is a native module
 * that cannot load there. The screen supplies the real `Platform.Version` and
 * `PermissionsAndroid.request`.
 *
 * Nothing else is requested here. In particular, never a location permission: first run asks for
 * foreground location on A2 only, and never for background location (`REQUESTS_BACKGROUND_LOCATION`).
 */

export const POST_NOTIFICATIONS = 'android.permission.POST_NOTIFICATIONS';
export const POST_NOTIFICATIONS_MIN_API = 33;

/** What `PermissionsAndroid.request` answers. */
export type AndroidPermissionResult = 'granted' | 'denied' | 'never_ask_again';

export interface NotificationPermissionDeps {
  /** Android API level (`Platform.Version` on Android). */
  readonly apiLevel: number;
  readonly request: (permission: typeof POST_NOTIFICATIONS) => Promise<AndroidPermissionResult>;
}

export const requestNotificationPermission = async (
  deps: NotificationPermissionDeps,
): Promise<PermissionState> => {
  if (deps.apiLevel < POST_NOTIFICATIONS_MIN_API) return 'granted';
  try {
    const result = await deps.request(POST_NOTIFICATIONS);
    // "Never ask again" is a refusal the phone will now remember. It is still a refusal.
    return result === 'granted' ? 'granted' : 'denied';
  } catch {
    // No activity, a request already in flight: the question was not answered, so nothing was
    // granted. Not `denied` either — the rep did not say no.
    return 'undetermined';
  }
};
