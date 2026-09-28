import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking, PermissionsAndroid } from 'react-native';
import type { ReactNode } from 'react';
import type * as ReactModule from 'react';
import type * as UiModule from '@fieldforce/ui';

/**
 * FE-D2 first run — A2 back in the design's order, and S4 where the rep lands on a denial.
 *
 * Operator rulings: design order (A1 sign in → A2 location → A3 notifications → battery → A9);
 * foreground location only, asked with `PermissionsAndroid`, no position read at onboarding;
 * approximate counts as granted; a denial lands on S4; S4's "Turn location back on" asks again and
 * opens Settings when Android will not show the prompt; "Carry on by hand" continues first run.
 */

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof ReactModule>('react');
  const ui = jest.requireActual<typeof UiModule>('@fieldforce/ui');
  return {
    useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn() }),
    Redirect: ({ href }: { href: string }): ReactNode =>
      React.createElement(ui.BodyText, null, `REDIRECT ${href}`),
  };
});

let mockFirstRunDone = false;
jest.mock('../onboarding/progress', () => ({
  hasCompletedFirstRun: () => Promise.resolve(mockFirstRunDone),
}));
jest.mock('../session', () => ({ useSession: () => ({ status: 'signed-in' }) }));

// A2 must not read a position: `takeFix` is how this screen used to ask, and it took a fix.
const mockTakeFix = jest.fn();
jest.mock('../capture/location', () => ({ takeFix: () => mockTakeFix() }));

import Index from '../../app/index';
import LocationRationale from '../../app/onboarding/location';
import LocationDenied from '../../app/onboarding/location-denied';

const FINE = 'android.permission.ACCESS_FINE_LOCATION';
const COARSE = 'android.permission.ACCESS_COARSE_LOCATION';

const answers = (fine: string, coarse: string): Record<string, string> => ({
  [FINE]: fine,
  [COARSE]: coarse,
});

const spyOnRequestMultiple = () => jest.spyOn(PermissionsAndroid, 'requestMultiple');
let requestMultiple: ReturnType<typeof spyOnRequestMultiple>;
const spyOnOpenSettings = () => jest.spyOn(Linking, 'openSettings');
let openSettings: ReturnType<typeof spyOnOpenSettings>;

beforeEach(() => {
  mockFirstRunDone = false;
  requestMultiple = spyOnRequestMultiple();
  openSettings = spyOnOpenSettings().mockResolvedValue(undefined);
  // jest-expo already mocks `Linking.openSettings` as a `jest.fn`, and spying on a mock returns
  // that same function, so `restoreAllMocks` does not reset its calls. Without this, the
  // "never ask again" case leaked its call into the next test.
  openSettings.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
  mockPush.mockReset();
  mockBack.mockReset();
  mockTakeFix.mockReset();
});

describe('first run order — A2 is the second screen', () => {
  it('a signed-in rep who has not finished first run starts at A2, location', async () => {
    await render(<Index />);
    expect(await screen.findByText('REDIRECT /onboarding/location')).toBeTruthy();
  });

  it('POSITIVE CONTROL: after first run, home', async () => {
    mockFirstRunDone = true;
    await render(<Index />);
    expect(await screen.findByText('REDIRECT /home')).toBeTruthy();
  });
});

describe('A2 — "Turn location on" asks for foreground location, and reads no position', () => {
  it('asks for exactly fine and coarse; granted goes on to A3', async () => {
    requestMultiple.mockResolvedValue(answers('granted', 'granted') as never);
    await render(<LocationRationale />);

    await fireEvent.press(screen.getByText('Turn location on'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/onboarding/notifications');
    });
    expect(requestMultiple).toHaveBeenCalledTimes(1);
    expect(requestMultiple).toHaveBeenCalledWith([FINE, COARSE]);
    expect(mockTakeFix).not.toHaveBeenCalled();
  });

  it('approximate only is granted, and goes on to A3', async () => {
    requestMultiple.mockResolvedValue(answers('denied', 'granted') as never);
    await render(<LocationRationale />);

    await fireEvent.press(screen.getByText('Turn location on'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/onboarding/notifications');
    });
  });

  it('a denial lands on S4', async () => {
    requestMultiple.mockResolvedValue(answers('denied', 'denied') as never);
    await render(<LocationRationale />);

    await fireEvent.press(screen.getByText('Turn location on'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/onboarding/location-denied');
    });
    expect(mockPush).not.toHaveBeenCalledWith('/onboarding/notifications');
  });

  it('"Not now" asks nothing and goes on to A3', async () => {
    await render(<LocationRationale />);

    await fireEvent.press(screen.getByText('Not now'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/onboarding/notifications');
    });
    expect(requestMultiple).not.toHaveBeenCalled();
  });

  it('OUTSIDE first run (opened from Me), "Not now" goes back, not into first run', async () => {
    mockFirstRunDone = true;
    await render(<LocationRationale />);

    await fireEvent.press(screen.getByText('Not now'));

    await waitFor(() => {
      expect(mockBack).toHaveBeenCalledTimes(1);
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('S4 — reached on a denial', () => {
  it('"Turn location back on" asks again; granted continues first run', async () => {
    requestMultiple.mockResolvedValue(answers('granted', 'granted') as never);
    await render(<LocationDenied />);

    await fireEvent.press(screen.getByText('Turn location back on'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/onboarding/notifications');
    });
    expect(requestMultiple).toHaveBeenCalledWith([FINE, COARSE]);
    expect(openSettings).not.toHaveBeenCalled();
  });

  it('when Android will not ask again, it opens this app’s settings instead', async () => {
    requestMultiple.mockResolvedValue(answers('never_ask_again', 'never_ask_again') as never);
    await render(<LocationDenied />);

    await fireEvent.press(screen.getByText('Turn location back on'));

    await waitFor(() => {
      expect(openSettings).toHaveBeenCalledTimes(1);
    });
  });

  it('"Carry on by hand" asks nothing and continues first run', async () => {
    await render(<LocationDenied />);

    await fireEvent.press(screen.getByText('Carry on by hand'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/onboarding/notifications');
    });
    expect(requestMultiple).not.toHaveBeenCalled();
    expect(openSettings).not.toHaveBeenCalled();
  });
});
