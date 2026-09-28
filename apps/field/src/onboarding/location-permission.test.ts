import { describe, expect, it, vi } from 'vitest';
import {
  ACCESS_COARSE_LOCATION,
  ACCESS_FINE_LOCATION,
  requestLocationPermission,
} from './location-permission';

/**
 * FE-D2 first run — A2 asks for FOREGROUND location, the permission only.
 *
 * Operator rulings: `PermissionsAndroid`, foreground only, no position read at onboarding; an
 * approximate-only grant (Android 12+) counts as granted; a denial lands on S4, and "never ask
 * again" is told apart so S4 can open Settings instead of re-asking into silence.
 */
describe('requestLocationPermission', () => {
  it('asks for exactly fine and coarse — foreground, nothing else', async () => {
    const requestMultiple = vi.fn(() =>
      Promise.resolve({
        [ACCESS_FINE_LOCATION]: 'granted' as const,
        [ACCESS_COARSE_LOCATION]: 'granted' as const,
      }),
    );
    await requestLocationPermission({ requestMultiple });

    expect(requestMultiple).toHaveBeenCalledTimes(1);
    expect(requestMultiple).toHaveBeenCalledWith([ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION]);
    expect(ACCESS_FINE_LOCATION).toBe('android.permission.ACCESS_FINE_LOCATION');
    expect(ACCESS_COARSE_LOCATION).toBe('android.permission.ACCESS_COARSE_LOCATION');
  });

  it('precise location is granted', async () => {
    expect(
      await requestLocationPermission({
        requestMultiple: () =>
          Promise.resolve({
            [ACCESS_FINE_LOCATION]: 'granted',
            [ACCESS_COARSE_LOCATION]: 'granted',
          }),
      }),
    ).toBe('granted');
  });

  it('APPROXIMATE only (coarse without fine) is granted — the rep said yes', async () => {
    expect(
      await requestLocationPermission({
        requestMultiple: () =>
          Promise.resolve({
            [ACCESS_FINE_LOCATION]: 'denied',
            [ACCESS_COARSE_LOCATION]: 'granted',
          }),
      }),
    ).toBe('granted');
  });

  it('a refusal is denied', async () => {
    expect(
      await requestLocationPermission({
        requestMultiple: () =>
          Promise.resolve({ [ACCESS_FINE_LOCATION]: 'denied', [ACCESS_COARSE_LOCATION]: 'denied' }),
      }),
    ).toBe('denied');
  });

  it('"never ask again" is BLOCKED: Android will not show the prompt again', async () => {
    expect(
      await requestLocationPermission({
        requestMultiple: () =>
          Promise.resolve({
            [ACCESS_FINE_LOCATION]: 'never_ask_again',
            [ACCESS_COARSE_LOCATION]: 'never_ask_again',
          }),
      }),
    ).toBe('blocked');
  });

  it('a request that throws was not answered — not a grant, not a refusal', async () => {
    expect(
      await requestLocationPermission({
        requestMultiple: () => Promise.reject(new Error('no activity')),
      }),
    ).toBe('unanswered');
  });
});
