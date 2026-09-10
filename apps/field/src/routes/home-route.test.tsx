import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { BodyText as mockBodyText } from '@fieldforce/ui';

const mockSession = jest.fn();
jest.mock('../session', () => ({ useSession: () => mockSession() }));

// MR-14 B2. The MR branch reads the day from the store the pull maintains, so the
// boundary this route is mocked at moved from the API client to that store.
//
// Mocked for the same reason the client was: `pulled-store.tsx` imports `../session`,
// which imports `../supabase` and then `../config`, and `loadAppConfig` throws at module
// load on a missing EXPO_PUBLIC_* value. That throw is correct for the app — a
// misconfigured build should fail on the first screen — and wrong for a unit test that
// has no `.env` and needs none to check how a screen presents a value.
//
// The PROVIDER itself is exercised for real, with injected dependencies, in
// `src/sync/pulled-store.test.tsx`. This file is about the screen.
const mockStore = jest.fn();
jest.mock('../sync/pulled-store', () => ({ usePulledStore: () => mockStore() }));
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

/** An empty, settled store — the shape `usePulledStore` returns after a quiet sync. */
const emptyPulled = () => ({
  store: { visit: new Map(), doctor: new Map(), beat_plan: new Map(), clinic_address: new Map() },
  status: 'ready',
  notice: null,
  failure: null,
  resynced: false,
  removals: [],
  refresh: jest.fn(),
});

describe('app/home.tsx — the role-aware shell', () => {
  it('shows the MR their own day, not a row promising one later', async () => {
    // "My day — FE-W3" was a placeholder for exactly this screen; B1 replaces it.
    // The MR's home IS the day, so the assertion is that the day rendered.
    mockSession.mockReturnValue(signedInAs('mr'));
    mockStore.mockReturnValue(emptyPulled());
    await render(<Home />);
    // The day view's own furniture, not a navigation row that leads to one.
    expect(await screen.findByText('Nothing planned for today')).toBeTruthy();
    expect(screen.queryByText('My day')).toBeNull();
    expect(screen.queryByText('Team')).toBeNull();
    expect(screen.queryByText('Administration')).toBeNull();
  });

  it("shows a field manager their team, not the MR's day view", async () => {
    mockSession.mockReturnValue(signedInAs('field_manager'));
    mockStore.mockReturnValue(emptyPulled());
    await render(<Home />);
    expect(screen.getByText('Team')).toBeTruthy();
    expect(screen.queryByText('Nothing planned for today')).toBeNull();
  });

  it('shows an admin the administration surface', async () => {
    mockSession.mockReturnValue(signedInAs('admin'));
    mockStore.mockReturnValue(emptyPulled());
    await render(<Home />);
    expect(screen.getByText('Administration')).toBeTruthy();
    expect(screen.queryByText('Nothing planned for today')).toBeNull();
  });

  it('names the role it read from the token rather than inferring one', async () => {
    // The role comes from the JWT claim Backend's auth hook installs. Displaying it
    // is how an MR and a support engineer can both see which role the server issued.
    mockSession.mockReturnValue(signedInAs('field_manager'));
    mockStore.mockReturnValue(emptyPulled());
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
      mockStore.mockReturnValue(emptyPulled());
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
