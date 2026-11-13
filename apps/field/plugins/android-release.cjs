/**
 * Android release readiness — the version code, and the permissions this app must never ship.
 *
 * **versionCode.** Android refuses to install an update whose `versionCode` is not higher than the
 * installed one, so every build handed to a rep must carry a new, larger integer. The rule here is
 * the plainest one that cannot go backwards by accident: the build supplies it in
 * `FIELD_ANDROID_VERSION_CODE` (a CI run number, or a number the release owner increments), and it
 * must be a whole number from 1 to 2,100,000,000 (Google Play's ceiling). Unset, it is 1 -- right
 * for a development or demo build, and `verify-release-apk.mjs` is where a production APK is held to
 * more. A malformed value is REFUSED rather than coerced: "12a" silently becoming 12 is how two
 * different builds end up claiming the same number.
 *
 * **Blocked permissions.** Libraries merge permissions into the manifest that this app never uses.
 * A prebuild of this app carried storage read/write and drawing over other apps; none is used, and
 * each widens what a rep's phone grants. Background location is blocked as well: the app records
 * location only while the rep acts (`src/onboarding/no-background-location.test.ts`), and blocking it
 * in the manifest means no library can add it.
 */

const { screenOffInBuild } = require('./screen-off-tracking.cjs');

const MAX_VERSION_CODE = 2100000000;

const BLOCKED_PERMISSIONS = [
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.SYSTEM_ALERT_WINDOW',
  // `FE-W86`: `expo-notifications` declares it to re-schedule LOCAL notifications after a reboot.
  // This app schedules none -- every notification is pushed by the server -- so it is blocked.
  'android.permission.RECEIVE_BOOT_COMPLETED',
];

/**
 * `FE-W219`. The one permission a screen-off build may NOT block.
 *
 * `expo-task-manager` hands each position from the location foreground service to the app through a
 * PERSISTED JobScheduler job, and Android refuses to schedule a persisted job for an app that does
 * not hold `RECEIVE_BOOT_COMPLETED` -- with an exception thrown inside a broadcast receiver, which
 * ends the process. With the permission blocked, the app crashed at the first position after a rep
 * started sharing: found on the emulator on the first run of a screen-off build, 13 November 2026.
 *
 * So it is let through in a screen-off build and blocked in every other, as before. It starts
 * nothing by itself after a reboot: a task delivered with no tracker running stops the service
 * (`src/tracking/screen-off.ts`, `deliver`).
 */
const BOOT_COMPLETED = 'android.permission.RECEIVE_BOOT_COMPLETED';
const blockedFor = (env) =>
  screenOffInBuild(env)
    ? BLOCKED_PERMISSIONS.filter((permission) => permission !== BOOT_COMPLETED)
    : BLOCKED_PERMISSIONS;

/** The version code for this build, from `FIELD_ANDROID_VERSION_CODE`; throws on a bad value. */
const androidVersionCode = (raw) => {
  if (raw === undefined || raw === null || String(raw).trim() === '') return 1;
  const text = String(raw).trim();
  if (!/^\d+$/u.test(text)) {
    throw new Error(`FIELD_ANDROID_VERSION_CODE must be a whole number, got "${text}"`);
  }
  const value = Number(text);
  if (value < 1 || value > MAX_VERSION_CODE) {
    throw new Error(
      `FIELD_ANDROID_VERSION_CODE must be from 1 to ${String(MAX_VERSION_CODE)}, got ${text}`,
    );
  }
  return value;
};

/** The config with the version code set and the blocked permissions added (never removed). */
const withAndroidRelease = (config, env) => {
  const android = config.android ?? {};
  const blocked = new Set([...(android.blockedPermissions ?? []), ...blockedFor(env)]);
  return {
    ...config,
    android: {
      ...android,
      versionCode: androidVersionCode(env.FIELD_ANDROID_VERSION_CODE),
      blockedPermissions: [...blocked],
    },
  };
};

module.exports = { BLOCKED_PERMISSIONS, MAX_VERSION_CODE, androidVersionCode, withAndroidRelease };
