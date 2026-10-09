import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import type * as ReactModule from 'react';
import type * as UiModule from '@fieldforce/ui';

/**
 * `BE-W150` — the root layout no longer gates on `EXPO_PUBLIC_API_BASE_URL`, the address of the
 * retired `services/mock` API. FE-D2 2 stopped a release build without it; nothing the app runs
 * uses it, so that gate stopped a correct production build. These tests keep the old mock of
 * `apiTarget` and set it to the old refusal: the app must start anyway.
 *
 * The values the app DOES need -- the Supabase URL and publishable key -- are still enforced, at
 * import, by `loadAppConfig` (`src/config-required.test.ts`).
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

describe('app/_layout.tsx — BE-W150, no gate on the retired mock API address', () => {
  it('a release build with NO EXPO_PUBLIC_API_BASE_URL starts the app, and shows no error', async () => {
    mockTarget = {
      kind: 'misconfigured',
      reason: 'EXPO_PUBLIC_API_BASE_URL is not set in this release build.',
    };
    await render(<RootLayout />);

    expect(await screen.findByText('APP STACK')).toBeTruthy();
    expect(screen.queryByText('This copy of the app is not set up')).toBeNull();
  });

  it('and a build that does set it starts exactly the same way', async () => {
    mockTarget = { kind: 'ok', baseUrl: 'https://api.example.com' };
    await render(<RootLayout />);

    expect(await screen.findByText('APP STACK')).toBeTruthy();
  });
});
