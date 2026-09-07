import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { BodyText as mockBodyText } from '@fieldforce/ui';

/**
 * Route tests live in `src/routes/`, NOT beside the routes in `app/`.
 * expo-router treats every file under `app/` as a route, so `app/index.test.tsx`
 * would become a navigable screen called `/index.test`.
 */

const mockSession = jest.fn();
jest.mock('../session', () => ({ useSession: () => mockSession() }));
jest.mock('expo-router', () => ({
  // Rendered through @fieldforce/ui rather than react-native's Text: apps/field is
  // barred from importing visual primitives, and the rule applies to test files too.
  // The alias is `mock`-prefixed because a jest.mock factory may only close over
  // variables named that way.
  Redirect: ({ href }: { href: string }) => mockBodyText({ children: `redirect:${href}` }),
}));

import Index from '../../app/index';
import { forgetOnboarding, markFirstRunComplete } from '../onboarding/progress';

beforeEach(async () => {
  await forgetOnboarding();
});

describe('app/index.tsx — where a cold start lands', () => {
  it('shows a named restoring state rather than guessing, while the session loads', async () => {
    // Pins that the route renders a *third* state instead of picking a destination.
    // Guessing flashes the login screen at an MR who is already signed in.
    mockSession.mockReturnValue({ status: 'loading' });
    await render(<Index />);
    expect(screen.getByText('Restoring your session')).toBeTruthy();
  });

  it('sends a first-time MR through setup rather than straight to their day', async () => {
    // The gap this closes: Flow A was built and unreachable. Signing in went
    // directly to Today, so a new MR never saw the battery setup — the screen that
    // keeps their check-ins working when the OEM sleeps the app.
    mockSession.mockReturnValue({ status: 'signed-in' });
    await render(<Index />);
    expect(await screen.findByText('redirect:/onboarding/notifications')).toBeTruthy();
  });

  /*
    There is deliberately no test here for "renders the spinner until the flag
    resolves". By the time `render` settles, the effect has run and the redirect has
    happened, so any such test asserts the spinner it can still see rather than the
    wait — it would pass with the guard removed. The guarantee is the early return in
    the route, and the two tests either side of this comment are what would break if
    it went: with no wait, the returning MR below would be redirected to setup on the
    first pass.
  */
  it('sends a returning MR to their day, not through setup again', async () => {
    await markFirstRunComplete('2026-09-02T09:00:00+05:30');
    mockSession.mockReturnValue({ status: 'signed-in' });
    await render(<Index />);
    expect(await screen.findByText('redirect:/home')).toBeTruthy();
  });

  it('sends an absent session to /sign-in', async () => {
    mockSession.mockReturnValue({ status: 'signed-out' });
    await render(<Index />);
    expect(screen.getByText('redirect:/sign-in')).toBeTruthy();
  });
});
