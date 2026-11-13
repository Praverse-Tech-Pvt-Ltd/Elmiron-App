/**
 * `FE-W207` — the two permissions a location FOREGROUND SERVICE needs, and only in a build that runs
 * one.
 *
 * Live location with the screen off (`src/tracking/screen-off.ts`) is an Android foreground service of
 * type `location`, started while the app is on screen. Android requires `FOREGROUND_SERVICE` and, from
 * Android 14, `FOREGROUND_SERVICE_LOCATION` for it. Both are install-time permissions the rep is
 * never asked about; what the rep SEES is the service's notification, for as long as it runs.
 *
 * **Not background location.** `ACCESS_BACKGROUND_LOCATION` stays in `android-release.cjs`'s blocked
 * list in every build, this one included: a while-in-use service started from the screen does not
 * need it, and blocking it means no library can add it.
 *
 * A build without both flags (`EXPO_PUBLIC_LIVE_TRACKING`, `EXPO_PUBLIC_LIVE_TRACKING_SCREEN_OFF`)
 * gets nothing from this file.
 */

const SCREEN_OFF_PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
];

const screenOffInBuild = (env) =>
  env.EXPO_PUBLIC_LIVE_TRACKING === 'true' && env.EXPO_PUBLIC_LIVE_TRACKING_SCREEN_OFF === 'true';

const withScreenOffTracking = (config, env) => {
  if (!screenOffInBuild(env)) return config;
  const android = config.android ?? {};
  const permissions = new Set([...(android.permissions ?? []), ...SCREEN_OFF_PERMISSIONS]);
  return { ...config, android: { ...android, permissions: [...permissions] } };
};

module.exports = { SCREEN_OFF_PERMISSIONS, screenOffInBuild, withScreenOffTracking };
