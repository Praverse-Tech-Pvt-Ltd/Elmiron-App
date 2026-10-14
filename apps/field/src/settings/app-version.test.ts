import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({
  default: { expoConfig: { version: '0.1.0', android: { versionCode: 12 } } },
}));

const { appVersionFrom, readAppVersion } = await import('./app-version');

/** `FE-W192`. The version line at the bottom of Me. */
describe('appVersionFrom', () => {
  it('reads the version and the Android version code', () => {
    expect(appVersionFrom({ version: '1.2.0', android: { versionCode: 7 } }, 'android')).toEqual({
      version: '1.2.0',
      build: '7',
    });
  });

  it('reads the iOS build number on an iPhone', () => {
    expect(
      appVersionFrom({ version: '1.2.0', ios: { buildNumber: '31' }, android: {} }, 'ios'),
    ).toEqual({ version: '1.2.0', build: '31' });
  });

  it('has no build number in a development build without one', () => {
    expect(appVersionFrom({ version: '0.1.0' }, 'android')).toEqual({
      version: '0.1.0',
      build: null,
    });
  });

  it('shows nothing rather than an empty version', () => {
    expect(appVersionFrom(null, 'android')).toBeNull();
    expect(appVersionFrom({ version: '  ' }, 'android')).toBeNull();
  });

  it('reads the config the app was built with (expo-constants)', () => {
    expect(readAppVersion()).toEqual({ version: '0.1.0', build: '12' });
  });
});
