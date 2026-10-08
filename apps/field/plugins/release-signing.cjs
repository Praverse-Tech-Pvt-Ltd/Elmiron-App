// W2-I C3 (`BE-W169`) — a release build is signed with the company's release key, or it is not built.
//
// Why: Expo's Android template signs the RELEASE build type with the DEBUG keystore — a key that
// ships inside every React Native template and that anyone can sign with. `assembleRelease` therefore
// produced an APK that looks like a release, installs like one, and can be silently replaced by
// anybody's app with the same package name. The demo script relies on that, and labels its APK
// "(demo)"; nothing stopped the same command making an unlabelled one.
//
// What this does, at prebuild, to the generated `android/app/build.gradle`:
//   - adds a `release` signing config read from four Gradle properties (below), set OUTSIDE the
//     repository — in `%USERPROFILE%\.gradle\gradle.properties` or as `ORG_GRADLE_PROJECT_<name>`;
//   - makes the release build type use it;
//   - refuses, when the task graph holds any release task, if a property is missing or the keystore
//     file does not exist — before anything is compiled, so no APK is written.
// A DEMO prebuild (`DEMO_CLEARTEXT_HOSTS` set) is left exactly as the template made it: its APK is
// debug-signed on purpose and says "(demo)" on the home screen.
//
// It never creates, holds or names a key. The operator supplies one; `docs/HANDOVER.md`, "Q-19".
//
// CommonJS, because Expo's config loader `require`s plugins and `apps/field` is `"type": "module"`.

/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS by necessity; see above. */
const { withAppBuildGradle } = require('expo/config-plugins');

const PROPERTIES = [
  'FIELDFORCE_UPLOAD_STORE_FILE',
  'FIELDFORCE_UPLOAD_STORE_PASSWORD',
  'FIELDFORCE_UPLOAD_KEY_ALIAS',
  'FIELDFORCE_UPLOAD_KEY_PASSWORD',
];
const MARK = '// W2-I C3 release-signing';

/** The end of the template's debug signing config: the release config goes after it. */
const DEBUG_CONFIG_END = /(\n[ \t]*keyPassword 'android'\r?\n[ \t]*\}\r?\n)/u;
/** The template's release build type signing with the debug key. */
const RELEASE_USES_DEBUG = /(\n[ \t]*release \{[^}]*?)signingConfig signingConfigs\.debug/u;

const RELEASE_CONFIG = `        release {
            ${MARK}: four properties, set outside the repository; never a value in this file.
            if (findProperty('FIELDFORCE_UPLOAD_STORE_FILE')) {
                storeFile file(findProperty('FIELDFORCE_UPLOAD_STORE_FILE'))
                storePassword findProperty('FIELDFORCE_UPLOAD_STORE_PASSWORD')
                keyAlias findProperty('FIELDFORCE_UPLOAD_KEY_ALIAS')
                keyPassword findProperty('FIELDFORCE_UPLOAD_KEY_PASSWORD')
            }
        }
`;

const GUARD = `
${MARK}: a release task with no release key is refused before anything is compiled.
gradle.taskGraph.whenReady { graph ->
    def releasing = graph.allTasks.any { it.project == project && it.name ==~ /(assemble|bundle|package)Release/ }
    if (!releasing) return
    def missing = ${JSON.stringify(PROPERTIES).replace(/"/gu, "'")}.findAll { !findProperty(it) }
    if (!missing.isEmpty()) {
        throw new GradleException("RELEASE BUILD REFUSED: no release key. Not set: " + missing.join(', ') +
            ". Without them this APK would be signed with the public debug key. See docs/HANDOVER.md, Q-19.")
    }
    def store = file(findProperty('FIELDFORCE_UPLOAD_STORE_FILE'))
    if (!store.exists()) {
        throw new GradleException("RELEASE BUILD REFUSED: the release keystore " + store + " does not exist.")
    }
}
`;

/**
 * The template's build.gradle with release signing applied. Pure. Throws — loudly, at prebuild —
 * if the template no longer has the shape this expects, rather than quietly leaving the debug key.
 *
 * @param {string} contents
 * @returns {string}
 */
const releaseSigningGradle = (contents) => {
  if (contents.includes(MARK)) return contents;
  if (!DEBUG_CONFIG_END.test(contents) || !RELEASE_USES_DEBUG.test(contents)) {
    throw new Error(
      'release-signing: android/app/build.gradle no longer has the template shape this plugin edits ' +
        "(a debug signing config ending in keyPassword 'android', and a release build type signed with " +
        'signingConfigs.debug). Refusing to prebuild: a release build would be debug-signed.',
    );
  }
  return (
    contents
      // The build type first, on the untouched template: the config inserted next also says "release {".
      .replace(RELEASE_USES_DEBUG, '$1signingConfig signingConfigs.release')
      .replace(DEBUG_CONFIG_END, `$1${RELEASE_CONFIG}`) + GUARD
  );
};

/**
 * @param {import('expo/config').ExpoConfig} config
 * @param {{ demo: boolean }} options
 */
const withReleaseSigning = (config, { demo }) => {
  if (demo) return config;
  return withAppBuildGradle(config, (modConfig) => {
    modConfig.modResults.contents = releaseSigningGradle(modConfig.modResults.contents);
    return modConfig;
  });
};

module.exports = { PROPERTIES, releaseSigningGradle, withReleaseSigning };
