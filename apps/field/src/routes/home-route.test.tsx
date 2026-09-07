import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { BodyText as mockBodyText } from '@fieldforce/ui';

const mockSession = jest.fn();
jest.mock('../session', () => ({ useSession: () => mockSession() }));

// The MR branch is the day view now, and it fetches. Mocked at the client boundary
// like the doctors route does — importing the real one pulls in `src/config`, which
// validates EXPO_PUBLIC_* at module load and throws under jest.
const mockListVisits = jest.fn<() => Promise<unknown>>();
const mockListDoctors = jest.fn<() => Promise<unknown>>();
jest.mock('../api', () => ({
  createClientForScenario: () => ({ listVisits: mockListVisits, listDoctors: mockListDoctors }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  // Rendered through @fieldforce/ui rather than react-native's Text: apps/field is
  // barred from importing visual primitives, and the rule applies to test files too.
  // The alias is `mock`-prefixed because a jest.mock factory may only close over
  // variables named that way.
  Redirect: ({ href }: { href: string }) => mockBodyText({ children: `redirect:${href}` }),
}));

import Home from '../../app/(tabs)/home';

const signedInAs = (role: string) => ({ status: 'signed-in', role, signOut: jest.fn() });

describe('app/home.tsx — the role-aware shell', () => {
  it('shows the MR their own day, not a row promising one later', async () => {
    // "My day — FE-W3" was a placeholder for exactly this screen; B1 replaces it.
    // The MR's home IS the day, so the assertion is that the day rendered.
    mockSession.mockReturnValue(signedInAs('mr'));
    mockListVisits.mockResolvedValue({ items: [] });
    mockListDoctors.mockResolvedValue({ items: [] });
    await render(<Home />);
    // The day view's own furniture, not a navigation row that leads to one.
    expect(await screen.findByText('Nothing planned for today')).toBeTruthy();
    expect(screen.queryByText('My day')).toBeNull();
    expect(screen.queryByText('Team')).toBeNull();
    expect(screen.queryByText('Administration')).toBeNull();
  });

  it("shows a field manager their team, not the MR's day view", async () => {
    mockSession.mockReturnValue(signedInAs('field_manager'));
    await render(<Home />);
    expect(screen.getByText('Team')).toBeTruthy();
    expect(screen.queryByText('Nothing planned for today')).toBeNull();
  });

  it('shows an admin the administration surface', async () => {
    mockSession.mockReturnValue(signedInAs('admin'));
    await render(<Home />);
    expect(screen.getByText('Administration')).toBeTruthy();
    expect(screen.queryByText('Nothing planned for today')).toBeNull();
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
    'renders a surface for %s rather than redirecting them away',
    async (role) => {
      // The shared Doctors destination used to be a row here and is now a tab.
      // `app/(tabs)/_layout.tsx` lists it unconditionally — there is no role branch
      // in that file — so the guarantee it carried ("hiding a row is a courtesy;
      // the server decides what a role may do") is now structural rather than
      // something this test can observe. What home still owes every signed-in role
      // is a screen of their own, which is what this asserts.
      mockSession.mockReturnValue(signedInAs(role));
      await render(<Home />);
      expect(screen.queryByText('redirect:/sign-in')).toBeNull();
    },
  );

  it('sends a signed-out session back to sign-in instead of rendering a shell', async () => {
    mockSession.mockReturnValue({ status: 'signed-out', role: null, signOut: jest.fn() });
    await render(<Home />);
    expect(screen.getByText('redirect:/sign-in')).toBeTruthy();
  });
});
