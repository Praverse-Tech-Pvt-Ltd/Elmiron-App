import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PermissionsAndroid, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Handover polish, round 2 — Me, sign-in, first run and What this app records, bound to their
 * routes: `FE-W185` (the location screen's promise is true for the phone in hand), `FE-W186` (no
 * auth server string on sign-in), `FE-W188` (a way back where the screen was pushed), `FE-W192`.
 */

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => true,
  }),
}));

let mockFirstRunDone = false;
jest.mock('../onboarding/progress', () => ({
  hasCompletedFirstRun: () => Promise.resolve(mockFirstRunDone),
  markFirstRunComplete: () => Promise.resolve(),
  batteryStepsDone: () => Promise.resolve([]),
  saveBatteryStepsDone: () => Promise.resolve(),
}));

let mockLiveBuild = false;
jest.mock('../features', () => ({
  get liveTrackingEnabled() {
    return mockLiveBuild;
  },
  assistantEnabled: false,
  practiceEnabled: false,
  productQaEnabled: false,
  learningEnabled: false,
  coachingEnabled: false,
}));

let mockTrackerState: string | null = null;
jest.mock('../tracking/tracker', () => ({
  useLiveTracker: () => (mockTrackerState === null ? null : { state: mockTrackerState }),
}));

const mockSignIn = jest.fn<(email: string, password: string) => Promise<void>>();
jest.mock('../session', () => ({
  useSession: () => ({
    status: 'signed-in',
    signIn: mockSignIn,
    signOut: () => Promise.resolve(),
    session: {
      user: { email: 'asha@example.in', user_metadata: { full_name: 'Asha Patil' } },
    },
  }),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { version: '0.1.0', android: { versionCode: 12 }, ios: { buildNumber: '12' } },
  },
}));

import Me from '../../app/(tabs)/me';
import SignIn from '../../app/sign-in';
import LocationRationale from '../../app/onboarding/location';
import Transparency from '../../app/transparency';
import { WIFI_ONLY_KEY } from '../settings/data-prefs';

let check: jest.SpiedFunction<typeof PermissionsAndroid.check>;

beforeEach(async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  mockFirstRunDone = false;
  mockLiveBuild = false;
  mockTrackerState = null;
  check = jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
  mockPush.mockReset();
  mockBack.mockReset();
  mockReplace.mockReset();
  mockSignIn.mockReset();
});

describe('Me (FE-W192)', () => {
  it('is titled Me, says who is signed in, and ends with the app version', async () => {
    await render(<Me />);
    expect(screen.getByText('Me')).toBeTruthy();
    expect(screen.getByText('Signed in as Asha Patil · asha@example.in')).toBeTruthy();
    expect(screen.getByText('Version 0.1.0 (build 12)')).toBeTruthy();
  });

  it('shows each data switch’s position on its row, as the phone keeps it', async () => {
    await AsyncStorage.setItem(WIFI_ONLY_KEY, 'off');
    await render(<Me />);
    // WiFi-only off (kept), the 100 MB note off (its default).
    await waitFor(() => {
      expect(screen.getAllByText('Off')).toHaveLength(2);
    });
    expect(screen.queryByText('On')).toBeNull();
  });
});

describe('sign-in (FE-W186, FE-W192)', () => {
  it('says the app’s own sentence for a wrong password, never the server’s string', async () => {
    mockSignIn.mockRejectedValue(
      Object.assign(new Error('Invalid login credentials'), {
        code: 'invalid_credentials',
        status: 400,
      }),
    );
    await render(<SignIn />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'asha@example.in');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'wrong');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(
      await screen.findByText('That email and password don’t match. Check them and try again.'),
    ).toBeTruthy();
    expect(screen.queryByText('Invalid login credentials')).toBeNull();
  });

  it('keeps the reason line’s place when the button becomes pressable, so it does not move', async () => {
    await render(<SignIn />);
    expect(screen.getByText('Enter your email and password.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Email'), 'asha@example.in');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'secret');
    expect(screen.queryByText('Enter your email and password.')).toBeNull();
    // The reserved line: a no-break space in the same slot.
    expect(screen.getByText(' ')).toBeTruthy();
  });

  it('has a Show password control', async () => {
    await render(<SignIn />);
    expect(screen.getByRole('switch', { name: 'Show password' })).toBeTruthy();
  });
});

describe('first-run location (FE-W185, FE-W188, FE-W192)', () => {
  it('without live location, promises check-in and check-out only', async () => {
    await render(<LocationRationale />);
    expect(screen.getByText('Only when you press check in or check out')).toBeTruthy();
  });

  it('with live location in the build, never says "at any other moment"', async () => {
    mockLiveBuild = true;
    mockTrackerState = 'paused_day_closed';
    await render(<LocationRationale />);
    expect(
      screen.getByText('When you check in or out, and only if you share live location'),
    ).toBeTruthy();
    expect(screen.queryByText(/any other moment/u)).toBeNull();
  });

  it('while sharing live location, says so plainly', async () => {
    mockLiveBuild = true;
    mockTrackerState = 'active';
    await render(<LocationRationale />);
    expect(screen.getByText('You are sharing live location now')).toBeTruthy();
    expect(screen.getByText(/Stop sharing any time from Live location/u)).toBeTruthy();
  });

  it('in first run: a step line and no Back', async () => {
    await render(<LocationRationale />);
    expect(await screen.findByText(/^Step 1 of [34]$/u)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('from Me: a Back, and no step line', async () => {
    mockFirstRunDone = true;
    await render(<LocationRationale />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Back' }));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/^Step \d of \d$/u)).toBeNull();
  });

  it('already allowed: says location is on, and offers one way on instead of asking again', async () => {
    mockFirstRunDone = true;
    check.mockResolvedValue(true);
    await render(<LocationRationale />);
    expect(
      await screen.findByText('Location is on. Your check-ins will record where you were.'),
    ).toBeTruthy();
    expect(screen.queryByText('Turn location on')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('POSITIVE CONTROL: not allowed yet, both equal answers are there', async () => {
    await render(<LocationRationale />);
    expect(await screen.findByText('Turn location on')).toBeTruthy();
    expect(screen.getByText('Not now')).toBeTruthy();
  });
});

describe('What this app records (FE-W185, FE-W188, FE-W192)', () => {
  it('opened from Me or Today, it has a way back', async () => {
    mockFirstRunDone = true;
    await render(<Transparency />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Back' }));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('ending first run, it carries the last step and the way on', async () => {
    await render(<Transparency />);
    expect(await screen.findByText(/^Step ([34]) of \1$/u)).toBeTruthy();
    expect(screen.getByText('Start my first day')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('with live location in the build, does not say "never between visits"', async () => {
    mockLiveBuild = true;
    await render(<Transparency />);
    expect(screen.queryByText(/never between visits/u)).toBeNull();
    mockLiveBuild = false;
  });
});
