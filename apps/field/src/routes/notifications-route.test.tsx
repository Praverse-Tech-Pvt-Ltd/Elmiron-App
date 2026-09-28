import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PermissionsAndroid, Platform } from 'react-native';

/**
 * FE-D2 first run — A3, bound to the real screen. "Allow notifications" raises the system prompt
 * (on Android 13+); "Not now" raises nothing. Both then continue first run.
 *
 * Until now both buttons called the same `next`, which only navigated: "Allow" asked for nothing.
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

import NotificationsRationale from '../../app/onboarding/notifications';

// Created per test: `restoreAllMocks` below would otherwise undo a module-level spy after the first.
const spyOnRequest = () => jest.spyOn(PermissionsAndroid, 'request');
let request: ReturnType<typeof spyOnRequest>;

/** The phone's Android API level. `Platform.Version` is a getter, so it is spied, not replaced. */
const onApi = (level: number): void => {
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(Platform, 'Version', 'get').mockReturnValue(level);
};

beforeEach(() => {
  request = spyOnRequest();
});

afterEach(() => {
  jest.restoreAllMocks();
  mockPush.mockReset();
});

describe('A3 — notifications', () => {
  it('Android 13+: "Allow notifications" requests POST_NOTIFICATIONS, then continues', async () => {
    onApi(33);
    request.mockResolvedValue('granted');
    await render(<NotificationsRationale />);

    await fireEvent.press(screen.getByText('Allow notifications'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledTimes(1);
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('android.permission.POST_NOTIFICATIONS');
  });

  it('Android 13+: a refusal still continues — the app works without notifications', async () => {
    onApi(34);
    request.mockResolvedValue('denied');
    await render(<NotificationsRationale />);

    await fireEvent.press(screen.getByText('Allow notifications'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledTimes(1);
    });
  });

  it('below Android 13: "Allow notifications" requests nothing, and continues', async () => {
    onApi(32);
    await render(<NotificationsRationale />);

    await fireEvent.press(screen.getByText('Allow notifications'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledTimes(1);
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('"Not now" requests nothing, on any version, and continues', async () => {
    for (const level of [32, 33]) {
      onApi(level);
      const view = await render(<NotificationsRationale />);
      await fireEvent.press(screen.getByText('Not now'));
      await view.unmount();
    }

    expect(request).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledTimes(2);
  });
});
