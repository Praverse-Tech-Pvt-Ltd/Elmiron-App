import { describe, expect, it, jest } from '@jest/globals';
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

describe('app/index.tsx — where a cold start lands', () => {
  it('shows a named restoring state rather than guessing, while the session loads', async () => {
    // Pins that the route renders a *third* state instead of picking a destination.
    // Guessing flashes the login screen at an MR who is already signed in.
    mockSession.mockReturnValue({ status: 'loading' });
    await render(<Index />);
    expect(screen.getByText('Restoring your session')).toBeTruthy();
  });

  it('sends a restored session to /home', async () => {
    mockSession.mockReturnValue({ status: 'signed-in' });
    await render(<Index />);
    expect(screen.getByText('redirect:/home')).toBeTruthy();
  });

  it('sends an absent session to /sign-in', async () => {
    mockSession.mockReturnValue({ status: 'signed-out' });
    await render(<Index />);
    expect(screen.getByText('redirect:/sign-in')).toBeTruthy();
  });
});
