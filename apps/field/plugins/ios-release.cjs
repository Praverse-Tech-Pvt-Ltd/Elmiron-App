/**
 * `FE-W161` — iOS release readiness: the build number, and the background location no build may ship.
 *
 * The iOS counterpart of `android-release.cjs`. Nothing here needs an Apple account; it shapes the
 * config an iOS build (EAS or a Mac) will read, and it changes nothing in an Android build.
 *
 * **buildNumber.** App Store Connect and TestFlight refuse an upload whose `CFBundleVersion` is not
 * higher than the last one for the same version, so every iOS build handed out must carry a new,
 * larger number. The rule is `android-release.cjs`'s: the build supplies it in
 * `FIELD_IOS_BUILD_NUMBER` (a CI run number, or one the release owner increments), a whole number
 * from 1 to 2,100,000,000. Unset, it is "1". A malformed value is REFUSED rather than coerced.
 *
 * **No background location, on iOS either.** The app reads a position only while the rep acts or
 * while it is on screen (`src/tracking/tracker.tsx`, `src/onboarding/no-background-location.test.ts`).
 * On Android that is enforced by blocking the permission in the manifest. iOS has no blocked-permission
 * list, so the equivalent is a refusal: a config whose `ios.infoPlist` declares the "Always" location
 * strings or the `location` background mode does not build. This reads the config, not the Info.plist
 * a library's own plugin may write at prebuild — which is why `expo-location`'s plugin (whose options
 * can add both) is not in `app.json`: the one location string iOS needs is set there directly.
 */

const MAX_BUILD_NUMBER = 2100000000;

/** The Info.plist keys that ask for, or keep running, location in the background. */
const FORBIDDEN_PLIST_KEYS = [
  'NSLocationAlwaysUsageDescription',
  'NSLocationAlwaysAndWhenInUseUsageDescription',
];

/** The build number for this build, from `FIELD_IOS_BUILD_NUMBER`; throws on a bad value. */
const iosBuildNumber = (raw) => {
  if (raw === undefined || raw === null || String(raw).trim() === '') return '1';
  const text = String(raw).trim();
  if (!/^\d+$/u.test(text)) {
    throw new Error(`FIELD_IOS_BUILD_NUMBER must be a whole number, got "${text}"`);
  }
  const value = Number(text);
  if (value < 1 || value > MAX_BUILD_NUMBER) {
    throw new Error(
      `FIELD_IOS_BUILD_NUMBER must be from 1 to ${String(MAX_BUILD_NUMBER)}, got ${text}`,
    );
  }
  return String(value);
};

/** Every way this Info.plist asks for background location. Empty: it does not. */
const backgroundLocationProblems = (infoPlist) => {
  const plist = infoPlist ?? {};
  const problems = FORBIDDEN_PLIST_KEYS.filter((key) => key in plist).map(
    (key) => `ios.infoPlist declares ${key}: this app never asks for location in the background`,
  );
  const modes = Array.isArray(plist.UIBackgroundModes) ? plist.UIBackgroundModes : [];
  if (modes.includes('location')) {
    problems.push(
      'ios.infoPlist UIBackgroundModes includes "location": this app never keeps location running in the background',
    );
  }
  return problems;
};

/** The config with the build number set; refused if it asks for background location. */
const withIosRelease = (config, env) => {
  const ios = config.ios ?? {};
  const problems = backgroundLocationProblems(ios.infoPlist);
  if (problems.length > 0) throw new Error(problems.join('\n'));
  return {
    ...config,
    ios: { ...ios, buildNumber: iosBuildNumber(env.FIELD_IOS_BUILD_NUMBER) },
  };
};

module.exports = {
  FORBIDDEN_PLIST_KEYS,
  MAX_BUILD_NUMBER,
  backgroundLocationProblems,
  iosBuildNumber,
  withIosRelease,
};
