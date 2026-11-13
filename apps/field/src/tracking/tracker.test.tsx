import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';
import type { LiveTrackingStatus } from '@fieldforce/core';

/**
 * `FE-W217` — the screen-off service is ASKED whether it is running, not assumed to be.
 *
 * Only the order of events is proved here, with the phone replaced by doubles: that a service
 * Android ended is noticed when the app comes back on screen, and started again. That a real
 * service survives a real screen-off is a handset's to prove.
 */
const mockStart = jest.fn<() => Promise<void>>();
const mockStop = jest.fn<() => Promise<void>>();
const mockHasStarted = jest.fn<() => Promise<boolean>>();

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: () => Promise.resolve({ granted: true }),
  requestForegroundPermissionsAsync: () => Promise.resolve({ granted: true }),
  startLocationUpdatesAsync: () => mockStart(),
  stopLocationUpdatesAsync: () => mockStop(),
  hasStartedLocationUpdatesAsync: () => mockHasStarted(),
  watchPositionAsync: jest.fn(),
}));
jest.mock('../features', () => ({
  liveTrackingEnabled: true,
  liveTrackingScreenOffEnabled: true,
}));
jest.mock('./screen-off', () => ({
  ...jest.requireActual<object>('./screen-off'),
  usesScreenOffService: () => true,
}));
jest.mock('./day-store', () => ({
  readOpenedDay: () => Promise.resolve('2026-10-13'),
  writeOpenedDay: () => Promise.resolve(),
}));
jest.mock('../session', () => ({
  useSession: () => ({ status: 'signed-in', session: { user: { id: 'rep-1' } }, role: 'mr' }),
}));

import { LiveTrackingProvider, useLiveTracker } from './tracker';
import type { LiveTracker } from './tracker';
import type { LiveTrackingBackend } from './live';

const NOTICE = '4e86b49c-05fc-4bd8-9f75-16e22a64309a';
const sharing: LiveTrackingStatus = {
  companyEnabled: true,
  intervalSeconds: 300,
  notice: { id: NOTICE, versionLabel: 'v1', body: 'The notice.', isDraft: false },
  accepted: true,
  acceptedNoticeVersionId: NOTICE,
  withinWorkingHours: true,
  shiftEnd: '18:00:00',
  timeZone: 'Asia/Kolkata',
  today: '2026-10-13',
  serverTime: '2026-10-13T05:38:23+00:00',
};

const backend = {
  status: () => Promise.resolve(sharing),
  ping: jest.fn(),
  accept: jest.fn(),
  withdraw: jest.fn(),
} as unknown as LiveTrackingBackend;

let seen: LiveTracker | null = null;
const Probe = (): null => {
  seen = useLiveTracker();
  return null;
};

const settle = async (): Promise<void> => {
  await act(async () => {
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  });
};

let appState: ((next: AppStateStatus) => void) | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  seen = null;
  mockStart.mockResolvedValue(undefined);
  mockStop.mockResolvedValue(undefined);
  mockHasStarted.mockResolvedValue(true);
  // The test renderer's AppState has no state of its own; the app starts on screen.
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    appState = handler;
    return { remove: () => undefined };
  });
});

const comeBackOnScreen = async (): Promise<void> => {
  await act(() => {
    appState?.('background');
  });
  await act(() => {
    appState?.('active');
  });
  await settle();
};

describe('FE-W217 — a screen-off service Android ended is noticed and started again', () => {
  it('POSITIVE CONTROL: a service still running is left alone', async () => {
    await render(
      <LiveTrackingProvider backend={backend}>
        <Probe />
      </LiveTrackingProvider>,
    );
    await settle();
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(seen?.readingNow).toBe(true);

    await comeBackOnScreen();

    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(seen?.readingNow).toBe(true);
  });

  it('a service that is gone when the app comes back is started again', async () => {
    await render(
      <LiveTrackingProvider backend={backend}>
        <Probe />
      </LiveTrackingProvider>,
    );
    await settle();
    expect(mockStart).toHaveBeenCalledTimes(1);

    mockHasStarted.mockResolvedValue(false);
    await comeBackOnScreen();

    expect(mockStart).toHaveBeenCalledTimes(2);
  });
});
