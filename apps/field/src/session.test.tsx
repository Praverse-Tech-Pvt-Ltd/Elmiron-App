import { describe, expect, it, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { BodyText } from '@fieldforce/ui';

/**
 * MR-28 C2 — the worst outcome the discarded-outcome sweep turned up.
 *
 * `void supabase.auth.getSession().then(({ data }) => { setSession(...); setReady(true); })`
 * had no `.catch`. `getSession` reads AsyncStorage; if that read REJECTS — a corrupt store,
 * a keychain the OS will not open — `setReady(true)` never runs and the app sits on its
 * splash forever. Every other site on the sweep costs a repeated press. This one is a
 * handset that will not start, with no message and nothing to press.
 *
 * Treated as signed out, which is both the safe direction and the true one: a session that
 * cannot be read is a session this app does not have. The MR signs in again, which works.
 */

const mockGetSession = jest.fn<() => Promise<unknown>>();
const mockOnAuthStateChange = jest.fn<(fn: unknown) => unknown>(() => ({
  data: { subscription: { unsubscribe: jest.fn() } },
}));

jest.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: (fn: unknown) => mockOnAuthStateChange(fn),
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
    },
  },
}));

import { SessionProvider, useSession } from './session';

const Probe = (): ReactNode => {
  const { status } = useSession();
  return <BodyText>{`status:${status}`}</BodyText>;
};

describe('SessionProvider — a session that cannot be READ is not a hung app', () => {
  it('finishes loading and reports SIGNED OUT when getSession rejects', async () => {
    mockGetSession.mockReset();
    mockGetSession.mockRejectedValue(new Error('AsyncStorage is unavailable'));

    await render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('status:signed-out')).toBeTruthy();
    });
    // The assertion that names the defect: it must not still be loading. `loading` is what
    // the splash renders, and staying there is the failure.
    expect(screen.queryByText('status:loading')).toBeNull();
  });

  it('THE POSITIVE CONTROL: a real stored session still signs the MR in', async () => {
    // Without this, a `catch` that discarded the session on every path would satisfy the
    // case above while signing everybody out on every cold start.
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          // A real, decodable JWT payload rather than a placeholder string. `readAppClaims`
          // base64-decodes it, and a fake one throws -- which is the first version of this
          // case, failing on `Unexpected token` rather than on the behaviour under test.
          access_token:
            'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI5OTk5OTk5OS05OTk5LTQ5OTktODk5OS05OTk5OTk5OTk5MDEiLCJhcHBfcm9sZSI6Im1yIiwidGVycml0b3J5X2lkIjoiOTk5OTk5OTktOTk5OS00OTk5LTg5OTktOTk5OTk5OTk5OWNjIn0.sig',
          user: { id: '99999999-9999-4999-8999-999999999901' },
        },
      },
    });

    await render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('status:signed-in')).toBeTruthy();
    });
  });
});
