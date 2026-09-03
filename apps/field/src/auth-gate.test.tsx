import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { BodyText } from '@fieldforce/ui';
import { AuthGate } from './auth-gate';

/**
 * The primary path of the application, asserted for the first time.
 *
 * Roughly six hundred tests existed before this file and none of them checked that a
 * successful sign-in takes the MR anywhere. It did not: GoTrue returned 200, the
 * claims were correct, and the screen sat still. Two real logins were recorded that
 * way before anyone noticed, because "nothing happened" is indistinguishable from
 * "still working" when neither outcome changes the screen.
 *
 * The lesson is not that a redirect was missing. It is that the most-exercised path
 * in the product had no test at all, so the whole suite could be green while the
 * front door was welded shut.
 */

const mockReplace = jest.fn();
let mockSegments: readonly string[] = [];
let mockStatus: 'loading' | 'signed-in' | 'signed-out' = 'loading';

// Jest hoists these factories above the declarations, so every variable they
// close over must be `mock`-prefixed. That is the rule, not a naming preference.
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSegments: () => mockSegments,
}));

jest.mock('./session', () => ({
  useSession: () => ({ status: mockStatus }),
}));

const mount = async (): Promise<void> => {
  await render(
    <AuthGate>
      <BodyText>behind the gate</BodyText>
    </AuthGate>,
  );
};

beforeEach(() => {
  mockReplace.mockClear();
});

describe('AuthGate', () => {
  it('sends a signed-in user off the sign-in screen — the defect this exists for', async () => {
    mockStatus = 'signed-in';
    mockSegments = ['sign-in'];

    await mount();

    // To the entry route, not straight to `/home`: `app/index.tsx` chooses between
    // first-run setup and the day, and it reads that flag off disk. Replacing with
    // `/home` here skipped setup for a brand-new MR.
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('sends a signed-out user on a protected route to sign-in', async () => {
    mockStatus = 'signed-out';
    mockSegments = ['home'];

    await mount();

    expect(mockReplace).toHaveBeenCalledWith('/sign-in');
  });

  it('leaves a signed-out user on the sign-in screen alone', async () => {
    mockStatus = 'signed-out';
    mockSegments = ['sign-in'];

    await mount();

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('leaves a signed-in user on a protected route alone', async () => {
    mockStatus = 'signed-in';
    mockSegments = ['doctors'];

    await mount();

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('does nothing while the stored session is still being read', async () => {
    // Redirecting before the session resolves throws a signed-in MR back to the
    // login screen on every cold start — the flash this provider was written to
    // avoid, reintroduced one layer up.
    mockStatus = 'loading';
    mockSegments = ['home'];

    await mount();

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('does not fight the entry route for the redirect', async () => {
    // `app/index.tsx` does its own redirect. Two redirects racing on the same frame
    // is a flicker between login and home on every launch.
    mockStatus = 'signed-out';
    mockSegments = [];

    await mount();

    expect(mockReplace).not.toHaveBeenCalled();
  });
});
