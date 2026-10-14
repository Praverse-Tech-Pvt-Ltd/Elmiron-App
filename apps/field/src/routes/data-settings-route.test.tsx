import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * `FE-W139` — the Mobile data screen, bound to the phone: it shows the switches where the phone has
 * them (WiFi-only ON on a phone never asked), a press is kept across a fresh mount, and the month's
 * figure is the SERVER's month.
 */

const mockStore = jest.fn();
jest.mock('../sync/pulled-store', () => ({ usePulledStore: () => mockStore() }));
// `FE-W188`. The screen's Back control asks for the router.
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, canGoBack: () => true, replace: jest.fn() }),
}));

import DataSettings from '../../app/data-settings';
import { WIFI_ONLY_KEY } from '../settings/data-prefs';
import { DATA_USE_KEY } from '../sync/data-use-store';

beforeEach(async () => {
  await AsyncStorage.clear();
  mockStore.mockReset();
  mockStore.mockReturnValue({ serverTime: '2026-10-14T06:00:00.000Z' });
});

const switches = () => screen.getAllByRole('switch');

describe('FE-W139 — the Mobile data screen', () => {
  it('opens with WiFi-only ON and the warning OFF on a phone never asked', async () => {
    await render(<DataSettings />);
    await waitFor(() => {
      expect(switches()).toHaveLength(2);
    });
    expect(switches()[0]?.props['accessibilityState']).toMatchObject({ checked: true });
    expect(switches()[1]?.props['accessibilityState']).toMatchObject({ checked: false });
  });

  it('a press is kept on the phone', async () => {
    await render(<DataSettings />);
    await waitFor(() => {
      expect(switches()).toHaveLength(2);
    });
    await fireEvent.press(screen.getByRole('switch', { name: /Send audio on WiFi only/u }));
    await waitFor(() => {
      expect(switches()[0]?.props['accessibilityState']).toMatchObject({ checked: false });
    });
    await expect(AsyncStorage.getItem(WIFI_ONLY_KEY)).resolves.toBe('off');
  });

  it('opens with what the phone kept, not the default', async () => {
    await AsyncStorage.setItem(WIFI_ONLY_KEY, 'off');
    await render(<DataSettings />);
    await waitFor(() => {
      expect(switches()[0]?.props['accessibilityState']).toMatchObject({ checked: false });
    });
  });

  it('shows this month’s count by the server’s month', async () => {
    await AsyncStorage.setItem(
      DATA_USE_KEY,
      JSON.stringify({ month: '2026-10', bytes: 12_400_000 }),
    );
    await render(<DataSettings />);
    expect(await screen.findByText('12.4 MB')).toBeTruthy();
  });

  it('last month’s count is nothing this month', async () => {
    await AsyncStorage.setItem(
      DATA_USE_KEY,
      JSON.stringify({ month: '2026-10', bytes: 12_400_000 }),
    );
    mockStore.mockReturnValue({ serverTime: '2026-11-02T06:00:00.000Z' });
    await render(<DataSettings />);
    expect(await screen.findByText('0.0 MB')).toBeTruthy();
  });

  it('with no server time yet, names no figure', async () => {
    mockStore.mockReturnValue({ serverTime: null });
    await render(<DataSettings />);
    expect(await screen.findByText('Shown once this phone has synced today.')).toBeTruthy();
  });
});
