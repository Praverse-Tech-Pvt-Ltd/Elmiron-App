/**
 * `FE-W85` / `FE-W86` — the two key-gated integrations, wired at BUILD time and only when switched on.
 *
 * **Maps.** `EXPO_PUBLIC_MAPS=true` turns the map screens on (`src/features.ts`). The Maps SDK for
 * Android reads its key from the manifest (`com.google.android.geo.API_KEY`), which Expo writes from
 * `android.config.googleMaps.apiKey`. That key comes from `GOOGLE_MAPS_ANDROID_API_KEY` in the BUILD
 * environment and nowhere else: it is a client key, restricted in Google Cloud to this package and
 * the signing certificate's SHA-1 (operator item Q-2), so it is not a secret -- but it is the
 * company's, so it is never committed. With the flag OFF no key is written even if one is set, so a
 * build that cannot show a map does not carry a key it does not use.
 *
 * **Push.** `EXPO_PUBLIC_PUSH=true` turns push registration on. Firebase needs the app's
 * `google-services.json` (operator item Q-3: configuration, not a secret, but the company's), given
 * as a PATH in `GOOGLE_SERVICES_JSON`; Expo copies it into the Android project and applies the
 * Google services Gradle plugin. The `expo-notifications` config plugin is added only then.
 *
 * **Flag on, input missing: REFUSED here**, at config time, with the variable's name -- as well as by
 * `scripts/release-build-checks.mjs` before a build starts. A map with no key is a grey rectangle on a
 * rep's phone; a push build with no Firebase file registers nothing and says nothing.
 */
const { existsSync } = require('node:fs');
const { isAbsolute, resolve } = require('node:path');

const on = (value) => value === 'true';
const text = (value) => (value === undefined || value === null ? '' : String(value).trim());

/**
 * Every reason this environment cannot build what its flags ask for. Empty: it can.
 *
 * @param {Record<string, string | undefined>} env
 * @param {(path: string) => boolean} [exists]
 * @returns {string[]}
 */
const integrationProblems = (env, exists = existsSync) => {
  const problems = [];
  if (on(env.EXPO_PUBLIC_MAPS) && text(env.GOOGLE_MAPS_ANDROID_API_KEY) === '') {
    problems.push(
      'EXPO_PUBLIC_MAPS is true but GOOGLE_MAPS_ANDROID_API_KEY is not set: supply the Android Maps key (restricted to com.praversetech.fieldforce and the signing SHA-1) in the build environment, or leave EXPO_PUBLIC_MAPS unset',
    );
  }
  if (on(env.EXPO_PUBLIC_PUSH)) {
    const file = text(env.GOOGLE_SERVICES_JSON);
    if (file === '') {
      problems.push(
        'EXPO_PUBLIC_PUSH is true but GOOGLE_SERVICES_JSON is not set: give the path to the Firebase app’s google-services.json, or leave EXPO_PUBLIC_PUSH unset',
      );
    } else if (!exists(file)) {
      problems.push('GOOGLE_SERVICES_JSON names a file that does not exist');
    }
  }
  return problems;
};

/**
 * The config with the map key and the Firebase file wired in -- only for the flags that are on.
 *
 * @template {{ android?: object, plugins?: unknown[] }} T
 * @param {T} config
 * @param {Record<string, string | undefined>} env
 * @param {(path: string) => boolean} [exists]
 * @returns {T}
 */
const withMapsAndPush = (config, env, exists = existsSync) => {
  const problems = integrationProblems(env, exists);
  if (problems.length > 0) throw new Error(problems.join('\n'));

  /** @type {Record<string, unknown>} */
  const android = { ...(config.android ?? {}) };
  /** @type {unknown[]} */
  let plugins = [...(config.plugins ?? [])];

  if (on(env.EXPO_PUBLIC_MAPS)) {
    android['config'] = {
      .../** @type {object | undefined} */ (android['config'] ?? {}),
      googleMaps: { apiKey: text(env.GOOGLE_MAPS_ANDROID_API_KEY) },
    };
  }
  if (on(env.EXPO_PUBLIC_PUSH)) {
    const file = text(env.GOOGLE_SERVICES_JSON);
    android['googleServicesFile'] = isAbsolute(file) ? file : resolve(file);
    plugins = [...plugins, ['expo-notifications', { defaultChannel: 'default' }]];
  }
  return { ...config, android, plugins };
};

module.exports = { integrationProblems, withMapsAndPush };
