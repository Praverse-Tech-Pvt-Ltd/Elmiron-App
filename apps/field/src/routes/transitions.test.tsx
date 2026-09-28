import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import type { ReactNode } from 'react';
import type * as ReactModule from 'react';
import type * as UiModule from '@fieldforce/ui';

/**
 * FE-D7 3 — one screen transition everywhere, and none when the phone says so.
 *
 * The design files specify no screen transitions (no `transition` rule in any of the four), so
 * "match the design" leaves consistency. The native stack's `'default'` is whatever the Android
 * version does, which differs between the API 36 emulator and a rep's phone; the stack now names
 * ONE animation for every screen. And Android's "Remove animations" — which sets the global
 * transition animation scale to 0, the value React Native's `isReduceMotionEnabled` reads — turns
 * it off entirely.
 */

let mockScreenOptions: Record<string, unknown> | undefined;

jest.mock('../config', () => ({ apiTarget: { kind: 'ok', baseUrl: 'https://api.example.com' } }));
jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof ReactModule>('react');
  const ui = jest.requireActual<typeof UiModule>('@fieldforce/ui');
  return {
    Stack: ({ screenOptions }: { screenOptions: Record<string, unknown> }): ReactNode => {
      mockScreenOptions = screenOptions;
      return React.createElement(
        ui.BodyText,
        null,
        `ANIMATION ${String(screenOptions['animation'])}`,
      );
    },
  };
});
jest.mock('../session', () => ({
  SessionProvider: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('../auth-gate', () => ({
  AuthGate: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('../sync/flusher', () => ({
  OutboxFlusher: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('../sync/pulled-store', () => ({
  PulledStoreProvider: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('../today/ZoneCaveatBanner', () => ({ ZoneCaveatBanner: () => null }));
jest.mock('@expo-google-fonts/dm-sans', () => ({
  useFonts: () => [true, null],
  DMSans_400Regular: 0,
  DMSans_500Medium: 0,
  DMSans_600SemiBold: 0,
  DMSans_700Bold: 0,
}));
jest.mock('@expo-google-fonts/cormorant-garamond', () => ({ CormorantGaramond_500Medium: 0 }));

import RootLayout from '../../app/_layout';

const spyOnReduceMotion = () => jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled');
let reduceMotion: ReturnType<typeof spyOnReduceMotion>;

beforeEach(() => {
  mockScreenOptions = undefined;
  reduceMotion = spyOnReduceMotion();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('FE-D7 3 — screen transitions', () => {
  it('every stack screen uses ONE named animation, not the platform default', async () => {
    reduceMotion.mockResolvedValue(false);
    await render(<RootLayout />);

    expect(await screen.findByText('ANIMATION slide_from_right')).toBeTruthy();
    expect(mockScreenOptions?.['headerShown']).toBe(false);
  });

  it('with Android "Remove animations" on, there is no animation at all', async () => {
    reduceMotion.mockResolvedValue(true);
    await render(<RootLayout />);

    await waitFor(() => {
      expect(mockScreenOptions?.['animation']).toBe('none');
    });
    expect(screen.getByText('ANIMATION none')).toBeTruthy();
  });

  it('follows the setting when it changes while the app is open', async () => {
    reduceMotion.mockResolvedValue(false);
    const listeners: Array<(enabled: boolean) => void> = [];
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((
      event: string,
      listener: (enabled: boolean) => void,
    ) => {
      if (event === 'reduceMotionChanged') listeners.push(listener);
      return { remove: () => undefined };
    }) as typeof AccessibilityInfo.addEventListener);
    await render(<RootLayout />);
    await screen.findByText('ANIMATION slide_from_right');

    listeners.forEach((listener) => {
      listener(true);
    });

    expect(await screen.findByText('ANIMATION none')).toBeTruthy();
  });
});
