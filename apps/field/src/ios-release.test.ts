import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import plugin from '../plugins/ios-release.cjs';

/** `FE-W161` — iOS release readiness: the build number rule, and no background location. */
const { backgroundLocationProblems, iosBuildNumber, withIosRelease } = plugin;

interface AppJson {
  readonly expo: {
    readonly platforms: readonly string[];
    readonly android: { readonly package: string };
    readonly ios: {
      readonly bundleIdentifier: string;
      readonly infoPlist: Readonly<Record<string, unknown>>;
    };
  };
}
const appJson = (): AppJson =>
  JSON.parse(readFileSync(join(__dirname, '..', 'app.json'), 'utf8')) as AppJson;

describe('iosBuildNumber', () => {
  it('is "1" when the build does not supply one (development, demo)', () => {
    expect(iosBuildNumber(undefined)).toBe('1');
    expect(iosBuildNumber('')).toBe('1');
  });

  it('takes a whole number from the build, as a string (CFBundleVersion is one)', () => {
    expect(iosBuildNumber('42')).toBe('42');
    expect(iosBuildNumber(' 7 ')).toBe('7');
  });

  it('refuses anything else rather than coercing it', () => {
    expect(() => iosBuildNumber('12a')).toThrow(/whole number/u);
    expect(() => iosBuildNumber('1.5')).toThrow(/whole number/u);
    expect(() => iosBuildNumber('0')).toThrow(/from 1/u);
    expect(() => iosBuildNumber('2100000001')).toThrow(/from 1/u);
  });
});

describe('withIosRelease', () => {
  it('sets the build number and keeps the rest of the iOS config', () => {
    const out = withIosRelease(
      { name: 'x', slug: 'x', ios: { bundleIdentifier: 'b', infoPlist: { A: 1 } } },
      { FIELD_IOS_BUILD_NUMBER: '9' },
    ) as { readonly ios: { buildNumber: string; bundleIdentifier: string; infoPlist: object } };
    expect(out.ios.buildNumber).toBe('9');
    expect(out.ios.bundleIdentifier).toBe('b');
    expect(out.ios.infoPlist).toEqual({ A: 1 });
  });

  it('refuses the "Always" location strings and the location background mode', () => {
    expect(() => {
      withIosRelease(
        {
          name: 'x',
          slug: 'x',
          ios: { infoPlist: { NSLocationAlwaysAndWhenInUseUsageDescription: 'x' } },
        },
        {},
      );
    }).toThrow(/never asks for location in the background/u);
    expect(() => {
      withIosRelease(
        { name: 'x', slug: 'x', ios: { infoPlist: { UIBackgroundModes: ['audio', 'location'] } } },
        {},
      );
    }).toThrow(/UIBackgroundModes/u);
  });

  it('POSITIVE CONTROL: "While Using" location alone is not a problem', () => {
    expect(backgroundLocationProblems({ NSLocationWhenInUseUsageDescription: 'x' })).toEqual([]);
  });

  it('is applied by app.config.ts', () => {
    const source = readFileSync(join(__dirname, '..', 'app.config.ts'), 'utf8');
    expect(source).toMatch(/withIosRelease\(/u);
  });
});

describe('app.json — the iOS app', () => {
  it('builds for iOS as well as Android, under the same identifier', () => {
    const { expo } = appJson();
    expect(expo.platforms).toEqual(['android', 'ios']);
    // The identifier is permanent once anything is published: one name for both stores.
    expect(expo.ios.bundleIdentifier).toBe(expo.android.package);
  });

  it('says why it asks for location, and asks for nothing in the background', () => {
    const { infoPlist } = appJson().expo.ios;
    expect(infoPlist['NSLocationWhenInUseUsageDescription']).toMatch(/check in or check out/u);
    expect(backgroundLocationProblems(infoPlist)).toEqual([]);
  });
});
