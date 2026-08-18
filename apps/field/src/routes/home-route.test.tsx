import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { BodyText as mockBodyText } from '@fieldforce/ui';

const mockSession = jest.fn();
jest.mock('../session', () => ({ useSession: () => mockSession() }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  // Rendered through @fieldforce/ui rather than react-native's Text: apps/field is
  // barred from importing visual primitives, and the rule applies to test files too.
  // The alias is `mock`-prefixed because a jest.mock factory may only close over
  // variables named that way.
  Redirect: ({ href }: { href: string }) => mockBodyText({ children: `redirect:${href}` }),
}));

import Home from '../../app/home';

const signedInAs = (role: string) => ({ status: 'signed-in', role, signOut: jest.fn() });

describe('app/home.tsx — the role-aware shell', () => {
  it('shows the MR their own day', async () => {
    mockSession.mockReturnValue(signedInAs('mr'));
    await render(<Home />);
    expect(screen.getByText('My day')).toBeTruthy();
    expect(screen.queryByText('Team')).toBeNull();
    expect(screen.queryByText('Administration')).toBeNull();
  });

  it("shows a field manager their team, not the MR's day view", async () => {
    mockSession.mockReturnValue(signedInAs('field_manager'));
    await render(<Home />);
    expect(screen.getByText('Team')).toBeTruthy();
    expect(screen.queryByText('My day')).toBeNull();
  });

  it('shows an admin the administration surface', async () => {
    mockSession.mockReturnValue(signedInAs('admin'));
    await render(<Home />);
    expect(screen.getByText('Administration')).toBeTruthy();
    expect(screen.queryByText('My day')).toBeNull();
  });

  it('names the role it read from the token rather than inferring one', async () => {
    // The role comes from the JWT claim Backend's auth hook installs. Displaying it
    // is how an MR and a support engineer can both see which role the server issued.
    mockSession.mockReturnValue(signedInAs('field_manager'));
    await render(<Home />);
    expect(screen.getByText(/Signed in as field_manager/u)).toBeTruthy();
  });

  // One render per case. Rendering repeatedly inside a single test leaves the earlier
  // trees un-cleaned and `screen` then reports on the wrong one — which also breaks
  // the NEXT test in the file, not this one.
  it.each(['mr', 'field_manager', 'admin'])(
    'gives %s the shared destination — this is navigation, not permission',
    async (role) => {
      // Hiding a row is a courtesy. The server denies what a role may not do whether
      // or not the row is on screen, so no role loses the shared surface here.
      mockSession.mockReturnValue(signedInAs(role));
      await render(<Home />);
      expect(screen.getAllByText('Doctors').length).toBeGreaterThan(0);
    },
  );

  it('sends a signed-out session back to sign-in instead of rendering a shell', async () => {
    mockSession.mockReturnValue({ status: 'signed-out', role: null, signOut: jest.fn() });
    await render(<Home />);
    expect(screen.getByText('redirect:/sign-in')).toBeTruthy();
  });
});
