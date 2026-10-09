import { describe, expect, it } from 'vitest';
import { releaseBuildProblems } from '../scripts/release-build-checks.mjs';

/**
 * `BE-W177` — what `build-release-apk.ps1` refuses before Gradle starts. The values are made up; no
 * real key, password or keystore is in this file.
 */
const STORE = 'C:\\keys\\fieldforce-upload.jks';
const READY: Record<string, string | undefined> = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',
  EXPO_PUBLIC_SUPABASE_KEY: 'sb_publishable_example',
  EXPO_PUBLIC_APP_JWT_AUDIENCE: 'authenticated',
  EXPO_PUBLIC_APP_SITE_URL: 'https://fieldforce.example.com',
  EXPO_PUBLIC_APP_DEEP_LINK_SCHEME: 'com.praversetech.fieldforce',
  FIELD_ANDROID_VERSION_CODE: '7',
  FIELDFORCE_UPLOAD_STORE_FILE: STORE,
  FIELDFORCE_UPLOAD_STORE_PASSWORD: 'store-password-example',
  FIELDFORCE_UPLOAD_KEY_ALIAS: 'fieldforce-upload',
  FIELDFORCE_UPLOAD_KEY_PASSWORD: 'key-password-example',
};
const exists = (path: string): boolean => path === STORE;
const problems = (overrides: Record<string, string | undefined>): string[] =>
  releaseBuildProblems({ ...READY, ...overrides }, { exists });

describe('BE-W177 — a production APK build is refused before Gradle unless', () => {
  it('accepts a complete production configuration, with no API base URL', () => {
    expect(problems({})).toEqual([]);
    expect(READY).not.toHaveProperty('EXPO_PUBLIC_API_BASE_URL');
  });

  it('the Supabase URL is set, https, and not a local stack', () => {
    expect(problems({ EXPO_PUBLIC_SUPABASE_URL: undefined }).join('\n')).toMatch(/supabaseUrl/u);
    expect(problems({ EXPO_PUBLIC_SUPABASE_URL: 'http://192.168.1.5:54321' }).join('\n')).toMatch(
      /not https/u,
    );
    expect(problems({ EXPO_PUBLIC_SUPABASE_URL: 'https://localhost:54321' }).join('\n')).toMatch(
      /local stack/u,
    );
  });

  it('the publishable key is set, and is not a secret key', () => {
    expect(problems({ EXPO_PUBLIC_SUPABASE_KEY: undefined }).join('\n')).toMatch(
      /EXPO_PUBLIC_SUPABASE_KEY is not set/u,
    );
    expect(problems({ EXPO_PUBLIC_SUPABASE_KEY: 'sb_secret_example' }).join('\n')).toMatch(
      /SECRET key/u,
    );
    const serviceRole = `x.${Buffer.from('{"role":"service_role"}').toString('base64url')}.y`;
    expect(problems({ EXPO_PUBLIC_SUPABASE_KEY: serviceRole }).join('\n')).toMatch(/SECRET key/u);
  });

  it('a version code is given and well formed', () => {
    expect(problems({ FIELD_ANDROID_VERSION_CODE: undefined }).join('\n')).toMatch(/not set/u);
    expect(problems({ FIELD_ANDROID_VERSION_CODE: '12a' }).join('\n')).toMatch(/whole number/u);
    expect(problems({ FIELD_ANDROID_VERSION_CODE: '0' }).join('\n')).toMatch(/from 1 to/u);
  });

  it('every release-signing value is set and the keystore exists', () => {
    expect(
      problems({ FIELDFORCE_UPLOAD_KEY_ALIAS: undefined, FIELDFORCE_UPLOAD_KEY_PASSWORD: '' }),
    ).toContain(
      'release signing not set: FIELDFORCE_UPLOAD_KEY_ALIAS, FIELDFORCE_UPLOAD_KEY_PASSWORD',
    );
    expect(problems({ FIELDFORCE_UPLOAD_STORE_FILE: 'C:\\keys\\missing.jks' }).join('\n')).toMatch(
      /does not exist/u,
    );
  });

  it('nothing is the public Android debug key', () => {
    const debug = problems({
      FIELDFORCE_UPLOAD_STORE_FILE: 'C:\\app\\android\\app\\debug.keystore',
      FIELDFORCE_UPLOAD_KEY_ALIAS: 'androiddebugkey',
      FIELDFORCE_UPLOAD_STORE_PASSWORD: 'android',
      FIELDFORCE_UPLOAD_KEY_PASSWORD: 'android',
    }).join('\n');
    expect(debug).toMatch(/DEBUG keystore/u);
    expect(debug).toMatch(/DEBUG key alias/u);
    expect(debug).toMatch(/FIELDFORCE_UPLOAD_STORE_PASSWORD is the Android DEBUG/u);
    expect(debug).toMatch(/FIELDFORCE_UPLOAD_KEY_PASSWORD is the Android DEBUG/u);
  });

  it('demo, recording and coaching switches are unset', () => {
    const all = problems({
      DEMO_CLEARTEXT_HOSTS: '192.168.1.5',
      EXPO_PUBLIC_RECORDING_ENABLED: 'true',
      EXPO_PUBLIC_COACHING_ENABLED: 'true',
    }).join('\n');
    expect(all).toMatch(/DEMO_CLEARTEXT_HOSTS is set/u);
    expect(all).toMatch(/EXPO_PUBLIC_RECORDING_ENABLED is set/u);
    expect(all).toMatch(/EXPO_PUBLIC_COACHING_ENABLED is set/u);
  });

  it('never repeats a password or key in what it reports', () => {
    const report = problems({
      EXPO_PUBLIC_SUPABASE_KEY: 'sb_secret_DO_NOT_PRINT',
      FIELDFORCE_UPLOAD_STORE_FILE: 'C:\\keys\\missing.jks',
      FIELD_ANDROID_VERSION_CODE: undefined,
    }).join('\n');
    expect(report).not.toContain('DO_NOT_PRINT');
    expect(report).not.toContain('store-password-example');
    expect(report).not.toContain('key-password-example');
  });
});
