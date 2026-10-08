import { describe, expect, it } from 'vitest';
import plugin from '../plugins/release-signing.cjs';

/**
 * W2-I C3 (`BE-W169`) — the release-signing plugin. The template signs RELEASE builds with the
 * public debug key; this makes a release build use the company's key or refuse. The Gradle side is
 * proved by a real prebuild and a real Gradle run (`docs/log/backend.md`, W2-I C); this is the text.
 */
const { PROPERTIES, releaseSigningGradle } = plugin;

/** Verbatim from a prebuild of this app (the Expo template), the two blocks the plugin edits. */
const TEMPLATE = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            def enableShrinkResources = findProperty('android.enableShrinkResourcesInReleaseBuilds') ?: 'false'
            shrinkResources enableShrinkResources.toBoolean()
        }
    }
}
`;

/** The body of the `release { … }` build type. */
const releaseBuildType = (gradle: string): string =>
  /buildTypes \{[\s\S]*?\n {8}release \{([\s\S]*?)\n {8}\}/u.exec(gradle)?.[1] ?? '';

describe('W2-I C3 — release builds are signed with the release key, or refused', () => {
  it('the release BUILD TYPE no longer uses the debug key; the debug build type still does', () => {
    const out = releaseSigningGradle(TEMPLATE);
    expect(releaseBuildType(out)).toContain('signingConfig signingConfigs.release');
    expect(releaseBuildType(out)).not.toContain('signingConfigs.debug');
    expect(out).toMatch(/\n {8}debug \{\n {12}signingConfig signingConfigs\.debug\n/u);
  });

  it('a release SIGNING CONFIG reads the four properties — and holds no value of its own', () => {
    const out = releaseSigningGradle(TEMPLATE);
    const config = /signingConfigs \{[\s\S]*?\n {8}release \{([\s\S]*?)\n {8}\}\n {4}\}/u.exec(
      out,
    )?.[1];
    expect(config).toBeDefined();
    for (const p of PROPERTIES) expect(config).toContain(`findProperty('${p}')`);
    expect(config).not.toMatch(/(storePassword|keyPassword|keyAlias) '/u);
  });

  it('the guard refuses a release task with a missing property or keystore, naming all four', () => {
    const out = releaseSigningGradle(TEMPLATE);
    expect(out).toContain('gradle.taskGraph.whenReady');
    expect(out).toContain('throw new GradleException("RELEASE BUILD REFUSED: no release key.');
    expect(out).toContain('RELEASE BUILD REFUSED: the release keystore');
    for (const p of PROPERTIES) expect(out).toContain(`'${p}'`);
    expect(out).toMatch(/\(assemble\|bundle\|package\)Release/u);
  });

  it('applied twice, it is applied once', () => {
    const once = releaseSigningGradle(TEMPLATE);
    expect(releaseSigningGradle(once)).toBe(once);
  });

  it('a template it does not recognise is REFUSED at prebuild — never left debug-signed', () => {
    const changed = TEMPLATE.replace("keyPassword 'android'", "keyPassword 'secret'");
    expect(() => releaseSigningGradle(changed)).toThrow(/would be debug-signed/u);
    const noDebugRelease = TEMPLATE.replace(
      /(release \{[\s\S]*?)signingConfig signingConfigs\.debug/u,
      '$1',
    );
    expect(() => releaseSigningGradle(noDebugRelease)).toThrow(/would be debug-signed/u);
  });

  it('Windows line endings are the same template', () => {
    const crlf = TEMPLATE.replace(/\n/gu, '\r\n');
    expect(releaseBuildType(releaseSigningGradle(crlf).replace(/\r\n/gu, '\n'))).toContain(
      'signingConfigs.release',
    );
  });
});
