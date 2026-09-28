import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import type * as ReactModule from 'react';
import type * as UiModule from '@fieldforce/ui';

/**
 * FE-D2 2 — the ROOT LAYOUT stops at a configuration error when the build has no real API
 * address. `api-target.test.ts` covers the decision; this covers that the app acts on it: no
 * session, no pull, no outbox and no screen mount behind the error, because each of those would
 * start talking to an address that does not exist.
 */

let mockTarget: unknown;

jest.mock('../config', () => ({
  get apiTarget() {
    return mockTarget;
  },
}));

// The app behind the gate. Each is replaced by a marker, so the test can say what mounted.
jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof ReactModule>('react');
  const ui = jest.requireActual<typeof UiModule>('@fieldforce/ui');
  return { Stack: () => React.createElement(ui.BodyText, null, 'APP STACK') };
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

describe('app/_layout.tsx — FE-D2 2, a release build with no real API address', () => {
  it('shows the configuration error and mounts nothing behind it', async () => {
    mockTarget = {
      kind: 'misconfigured',
      reason: 'EXPO_PUBLIC_API_BASE_URL is not set in this release build.',
    };
    await render(<RootLayout />);

    expect(await screen.findByText('This copy of the app is not set up')).toBeTruthy();
    expect(screen.getByText(/EXPO_PUBLIC_API_BASE_URL is not set/u)).toBeTruthy();
    expect(screen.queryByText('APP STACK')).toBeNull();
  });

  it('POSITIVE CONTROL: a configured build renders the app and no error', async () => {
    mockTarget = { kind: 'ok', baseUrl: 'https://api.example.com' };
    await render(<RootLayout />);

    expect(await screen.findByText('APP STACK')).toBeTruthy();
    expect(screen.queryByText('This copy of the app is not set up')).toBeNull();
  });
});
