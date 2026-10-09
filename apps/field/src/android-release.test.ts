import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import plugin from '../plugins/android-release.cjs';

/** Android release readiness: the version code rule, and the permissions blocked in every build. */
const { BLOCKED_PERMISSIONS, androidVersionCode, withAndroidRelease } = plugin;

describe('androidVersionCode', () => {
  it('is 1 when the build does not supply one (development, demo)', () => {
    expect(androidVersionCode(undefined)).toBe(1);
    expect(androidVersionCode('')).toBe(1);
  });

  it('takes a whole number from the build', () => {
    expect(androidVersionCode('42')).toBe(42);
    expect(androidVersionCode(' 7 ')).toBe(7);
  });

  it('refuses anything else rather than coercing it', () => {
    expect(() => androidVersionCode('12a')).toThrow(/whole number/u);
    expect(() => androidVersionCode('1.5')).toThrow(/whole number/u);
    expect(() => androidVersionCode('0')).toThrow(/from 1/u);
    expect(() => androidVersionCode('2100000001')).toThrow(/from 1/u);
  });
});

describe('withAndroidRelease', () => {
  it('sets the version code and blocks the permissions, keeping what the config already blocked', () => {
    const out = withAndroidRelease(
      {
        name: 'x',
        slug: 'x',
        android: { package: 'p', blockedPermissions: ['android.permission.CAMERA'] },
      },
      { FIELD_ANDROID_VERSION_CODE: '9' },
    ) as {
      readonly android: {
        readonly versionCode: number;
        readonly package: string;
        readonly blockedPermissions: readonly string[];
      };
    };
    expect(out.android.versionCode).toBe(9);
    expect(out.android.package).toBe('p');
    expect(out.android.blockedPermissions).toEqual(
      expect.arrayContaining(['android.permission.CAMERA', ...BLOCKED_PERMISSIONS]),
    );
  });

  it('blocks background location, storage and drawing over other apps', () => {
    expect(BLOCKED_PERMISSIONS).toEqual(
      expect.arrayContaining([
        'android.permission.ACCESS_BACKGROUND_LOCATION',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.SYSTEM_ALERT_WINDOW',
      ]),
    );
  });

  it('is applied by app.config.ts', () => {
    const source = readFileSync(join(__dirname, '..', 'app.config.ts'), 'utf8');
    expect(source).toMatch(/withAndroidRelease\(/u);
  });

  it('no blocked permission is also requested in app.json', () => {
    const json = JSON.parse(readFileSync(join(__dirname, '..', 'app.json'), 'utf8')) as {
      expo: { android: { permissions?: string[] } };
    };
    for (const permission of json.expo.android.permissions ?? []) {
      expect(BLOCKED_PERMISSIONS).not.toContain(permission);
    }
  });
});
