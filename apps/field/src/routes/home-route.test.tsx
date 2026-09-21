import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
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
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
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
  zone: { timeZone: 'Asia/Kolkata', source: 'territory' },
  // A settled store after a quiet sync HAS a day -- it was undefined here before, which
  // made `today === null` false and ran `summariseDay` on `undefined`. The looseness was
  // load-bearing, which is its own small lesson.
  today: '2026-09-14',
  serverTime: '2026-09-14T17:45:00.000Z',
  // FE-W40. The default a live, quiet sync produces nothing worth disclosing from.
  dayOrigin: { kind: 'live' },
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

/**
 * `FE-W40` B5 — nothing on this screen may assert a fact the server did not give.
 *
 * The restored day is true as of an instant and unconfirmed since. The "as of" line is what
 * makes that a statement rather than an implication, and the expired case must explain
 * ITSELF rather than borrowing the generic "could not reach the server", which is true and
 * useless when the MR is holding a phone full of their own visits.
 */
describe('app/home.tsx — FE-W40, a day restored from disk says so', () => {
  const ANCHORED_AT = '2026-09-14T17:45:00.000Z';

  it('an ANCHORED day carries its age, in the TERRITORY zone', async () => {
    mockSession.mockReturnValue(signedInAs('mr'));
    mockStore.mockReturnValue({
      ...emptyPulled(),
      today: '2026-09-14',
      serverTime: ANCHORED_AT,
      dayOrigin: { kind: 'anchored', asOf: ANCHORED_AT },
    });

    await render(<Home />);

    // 17:45Z is 23:15 in IST. Asserting the CONTENT -- the rendered time -- and not merely
    // that some label exists, because a label reading 17:45 would be the MR-14 defect.
    expect(await screen.findByText('Your day as of 23:15 — not confirmed since')).toBeTruthy();
  });

  it('a LIVE day says nothing, because there is nothing to disclose', async () => {
    // The positive control for the case above: if the label rendered unconditionally it
    // would be noise on every ordinary day, and noise is how a true sentence stops being read.
    mockSession.mockReturnValue(signedInAs('mr'));
    mockStore.mockReturnValue({
      ...emptyPulled(),
      today: '2026-09-14',
      serverTime: ANCHORED_AT,
      dayOrigin: { kind: 'live' },
    });

    await render(<Home />);

    expect(await screen.findByText('Nothing planned for today')).toBeTruthy();
    expect(screen.queryByText(/Your day as of/)).toBeNull();
  });

  it('an EXPIRED anchor explains ITSELF rather than blaming the network', async () => {
    mockSession.mockReturnValue(signedInAs('mr'));
    mockStore.mockReturnValue({
      ...emptyPulled(),
      today: null,
      serverTime: ANCHORED_AT,
      dayOrigin: { kind: 'expired', asOf: ANCHORED_AT },
      failure: { kind: 'unreachable' },
    });

    await render(<Home />);

    expect(
      await screen.findByText(
        'Your last sync was 14 Sep at 23:15, which was a different day. This app shows a day only once the server has confirmed it.',
      ),
    ).toBeTruthy();
    // The assertion that fails if the expired case falls through to the generic branch.
    expect(
      screen.queryByText(
        'The app could not reach the server. It will try again when you come back to it.',
      ),
    ).toBeNull();
  });

  it('THE POSITIVE CONTROL: an ordinary unreachable server still gets the generic message', async () => {
    // Without this, the expired case above is satisfiable by deleting the generic branch,
    // which would lose the right message for every failure that is NOT a stale anchor.
    mockSession.mockReturnValue(signedInAs('mr'));
    mockStore.mockReturnValue({
      ...emptyPulled(),
      today: null,
      dayOrigin: { kind: 'none' },
      failure: { kind: 'unreachable' },
    });

    await render(<Home />);

    expect(
      await screen.findByText(
        'The app could not reach the server. It will try again when you come back to it.',
      ),
    ).toBeTruthy();
  });
});

/**
 * MR-48 — `FE-W57`, the case the Pixel 10 found. Checked in on the 21st to a visit scheduled
 * for the 16th, the MR saw "Nothing planned for today · 0 of 0". Today's next-visit card is the
 * only way into a visit, so check-out was unreachable.
 */
describe('app/home.tsx — the visit the MR is standing inside is never hidden', () => {
  const DOCTOR = {
    id: '33333333-3333-4333-8333-333333333301',
    fullName: 'Dr Asha Deshpande',
    registrationNumber: null,
    specialty: 'Urology',
    qualification: null,
    territoryId: '11111111-1111-4111-8111-111111111103',
    assignedMrId: null,
    clinicAddresses: [],
    isActive: true,
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-01T08:00:00.000Z',
  };
  const visitOf = (status: string, id: string) => ({
    id,
    mrId: '22222222-2222-4222-8222-222222222202',
    doctorId: DOCTOR.id,
    beatPlanId: null,
    clinicAddressId: null,
    status,
    notMetReason: null,
    scheduledFor: '2026-09-09T07:30:00.000Z',
    startedAt: status === 'in_progress' ? '2026-09-09T07:35:00.000Z' : null,
    completedAt: null,
    // The server's day: an earlier one than Today's 2026-09-14.
    visitDay: '2026-09-09',
    receivedAt: '2026-09-09T07:35:01.000Z',
    createdAt: '2026-09-08T08:00:00.000Z',
    updatedAt: '2026-09-09T07:35:01.000Z',
  });
  const withVisit = (visit: ReturnType<typeof visitOf>) => {
    const base = emptyPulled();
    return {
      ...base,
      store: {
        ...base.store,
        visit: new Map([[visit.id, visit]]),
        doctor: new Map([[DOCTOR.id, DOCTOR]]),
      },
    };
  };

  it('offers the in-progress visit from an earlier day, and opens THAT visit', async () => {
    mockSession.mockReturnValue(signedInAs('mr'));
    mockStore.mockReturnValue(
      withVisit(visitOf('in_progress', '66666666-6666-4666-8666-666666666606')),
    );
    mockPush.mockClear();
    await render(<Home />);

    await fireEvent.press(await screen.findByText('Start the visit to Dr Asha Deshpande'));
    expect(mockPush).toHaveBeenCalledWith('/visit/66666666-6666-4666-8666-666666666606');
    expect(screen.queryByText('Nothing planned for today')).toBeNull();
  });

  it('NEGATIVE CONTROL: the same visit still PLANNED on that earlier day is not offered', async () => {
    mockSession.mockReturnValue(signedInAs('mr'));
    mockStore.mockReturnValue(
      withVisit(visitOf('planned', '66666666-6666-4666-8666-666666666607')),
    );
    await render(<Home />);

    expect(await screen.findByText('Nothing planned for today')).toBeTruthy();
    expect(screen.queryByText('Start the visit to Dr Asha Deshpande')).toBeNull();
  });
});
