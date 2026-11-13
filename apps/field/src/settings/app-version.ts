import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * `FE-W192` — which build this phone is running, for the last line of Me.
 *
 * Support's first question is "which version are you on?", and until now the rep had nowhere to
 * read it: Android buries it three screens deep in the phone's settings. The version is `app.json`'s;
 * the build number is the one `plugins/android-release.cjs` (`FIELD_ANDROID_VERSION_CODE`) or
 * `plugins/ios-release.cjs` (`FIELD_IOS_BUILD_NUMBER`) wrote into the same config — so the two
 * numbers on screen are the two a release is known by.
 *
 * Pure over the config it is given, so the rule is tested without a native build.
 */
export interface AppVersion {
  readonly version: string;
  /** The Android version code or iOS build number; null in a development build without one. */
  readonly build: string | null;
}

interface VersionConfig {
  readonly version?: string;
  readonly android?: { readonly versionCode?: number | null };
  readonly ios?: { readonly buildNumber?: string | null };
}

export const appVersionFrom = (
  config: VersionConfig | null | undefined,
  os: string,
): AppVersion | null => {
  const version = config?.version?.trim() ?? '';
  // No version means no line: an empty "Version" is a question, not an answer.
  if (version === '') return null;
  const raw = os === 'ios' ? config?.ios?.buildNumber : config?.android?.versionCode;
  const build = raw === undefined || raw === null || String(raw).trim() === '' ? null : String(raw);
  return { version, build };
};

/** This phone's build, read from the config the app was built with. */
export const readAppVersion = (): AppVersion | null =>
  appVersionFrom(Constants.expoConfig, Platform.OS);
