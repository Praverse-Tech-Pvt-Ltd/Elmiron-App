import { describe, expect, it } from 'vitest';
import plugin from '../plugins/screen-off-tracking.cjs';
import androidRelease from '../plugins/android-release.cjs';

const { SCREEN_OFF_PERMISSIONS, withScreenOffTracking } = plugin;
const { BLOCKED_PERMISSIONS, withAndroidRelease } = androidRelease;

interface Out {
  readonly android?: { readonly permissions?: string[]; readonly blockedPermissions?: string[] };
}

const ON = { EXPO_PUBLIC_LIVE_TRACKING: 'true', EXPO_PUBLIC_LIVE_TRACKING_SCREEN_OFF: 'true' };

describe('FE-W207 the foreground-service permissions', () => {
  it('adds both, and keeps what was there, in a screen-off build', () => {
    const out = withScreenOffTracking(
      { name: 'x', slug: 'x', android: { permissions: ['android.permission.POST_NOTIFICATIONS'] } },
      ON,
    ) as Out;
    expect(out.android?.permissions).toEqual([
      'android.permission.POST_NOTIFICATIONS',
      ...SCREEN_OFF_PERMISSIONS,
    ]);
  });

  it('adds nothing unless BOTH flags are exactly "true"', () => {
    const config = { name: 'x', slug: 'x', android: { permissions: [] as string[] } };
    for (const env of [
      {},
      { EXPO_PUBLIC_LIVE_TRACKING: 'true' },
      { EXPO_PUBLIC_LIVE_TRACKING_SCREEN_OFF: 'true' },
      { EXPO_PUBLIC_LIVE_TRACKING: 'true', EXPO_PUBLIC_LIVE_TRACKING_SCREEN_OFF: '1' },
    ]) {
      expect(withScreenOffTracking(config, env)).toBe(config);
    }
  });

  it('never needs, and never unblocks, background location', () => {
    expect(SCREEN_OFF_PERMISSIONS).not.toContain('android.permission.ACCESS_BACKGROUND_LOCATION');
    const out = withAndroidRelease(withScreenOffTracking({ name: 'x', slug: 'x' }, ON), {}) as Out;
    expect(out.android?.blockedPermissions).toEqual(
      expect.arrayContaining([...BLOCKED_PERMISSIONS]),
    );
    expect(out.android?.blockedPermissions).toContain(
      'android.permission.ACCESS_BACKGROUND_LOCATION',
    );
  });
});
