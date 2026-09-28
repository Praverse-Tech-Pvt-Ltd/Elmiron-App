import { describe, expect, it, vi } from 'vitest';
import {
  POST_NOTIFICATIONS,
  POST_NOTIFICATIONS_MIN_API,
  requestNotificationPermission,
} from './notification-permission';

/**
 * FE-D2 first run — A3's "Allow notifications" actually asks, and only where there is a question.
 *
 * `POST_NOTIFICATIONS` is a runtime permission from Android 13 (API 33). Below that it does not
 * exist: notifications are allowed by default, and there is nothing to request. The operator's
 * ruling: below 33, do not request it and treat it as allowed; test both branches.
 */
describe('requestNotificationPermission', () => {
  it('Android 13+ (API 33): asks, for POST_NOTIFICATIONS and nothing else', async () => {
    const request = vi.fn(() => Promise.resolve('granted' as const));
    const state = await requestNotificationPermission({ apiLevel: 33, request });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(POST_NOTIFICATIONS);
    expect(POST_NOTIFICATIONS).toBe('android.permission.POST_NOTIFICATIONS');
    expect(state).toBe('granted');
  });

  it('Android 13+: a refusal is denied, and "never ask again" is denied too', async () => {
    expect(
      await requestNotificationPermission({
        apiLevel: 34,
        request: () => Promise.resolve('denied' as const),
      }),
    ).toBe('denied');
    expect(
      await requestNotificationPermission({
        apiLevel: 34,
        request: () => Promise.resolve('never_ask_again' as const),
      }),
    ).toBe('denied');
  });

  it('below Android 13 (API 32): does NOT ask, and treats it as allowed', async () => {
    const request = vi.fn(() => Promise.resolve('denied' as const));
    const state = await requestNotificationPermission({ apiLevel: 32, request });

    expect(request).not.toHaveBeenCalled();
    expect(state).toBe('granted');
  });

  it('the boundary is exactly 33', () => {
    expect(POST_NOTIFICATIONS_MIN_API).toBe(33);
  });

  it('a request that throws is not a grant', async () => {
    // An activity gone or a request already in flight must not read as permission given.
    const state = await requestNotificationPermission({
      apiLevel: 33,
      request: () => Promise.reject(new Error('no activity')),
    });
    expect(state).toBe('undetermined');
  });
});
