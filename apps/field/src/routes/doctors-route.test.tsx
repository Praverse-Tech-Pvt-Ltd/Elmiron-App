import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react-native';

/**
 * MR-14 B2. The list reads the store the pull maintains, not the mock API client, so the
 * boundary this route is mocked at moved with it.
 *
 * **Every property this file guarded before the conversion is still guarded here**, and
 * that is the point of rewriting it rather than replacing it. The first draft of
 * `pulled-store.tsx` collapsed "the server refused" and "nothing answered" into one
 * failure field, and the case below named *separates a transport failure from a denial*
 * is what caught it.
 *
 * Mocked rather than wrapped in a real provider because `pulled-store.tsx` imports
 * `../session`, which imports `../supabase` and then `../config`, whose `loadAppConfig`
 * throws at module load on a missing EXPO_PUBLIC_* value. That is correct for the app and
 * wrong for a unit test with no `.env`. The PROVIDER is exercised for real, with injected
 * dependencies and no config, in `src/sync/pulled-store.test.tsx`.
 */
const mockStore = jest.fn();
jest.mock('../sync/pulled-store', () => ({ usePulledStore: () => mockStore() }));

// The list opens a profile, so the route reads the router. Mocked because the real module
// pulls in `standard-navigation`, which ships untransformed ESM that jest's
// transformIgnorePatterns does not cover.
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

import Doctors from '../../app/(tabs)/doctors';

const emptyLocalStore = () => ({
  visit: new Map(),
  doctor: new Map(),
  beat_plan: new Map(),
  clinic_address: new Map(),
});

const pulled = (over: Record<string, unknown> = {}) => ({
  store: emptyLocalStore(),
  status: 'ready',
  notice: null,
  failure: null,
  resynced: false,
  removals: [],
  refresh: jest.fn(),
  ...over,
});

/** 42501 — the server considered the request and refused it. */
const denial = {
  kind: 'refused',
  refusal: { code: 'not_permitted', sqlState: '42501', actionable: false },
};

beforeEach(() => {
  mockStore.mockReturnValue(pulled());
});

describe('app/doctors.tsx — how the client presents a server decision', () => {
  it('renders a denial as a denial, never as an empty list', async () => {
    // The whole point of the screen. An empty list is what a client-side filter looks
    // like, and the client never decides what an MR may see. This asserts the two are
    // distinguishable on screen.
    mockStore.mockReturnValue(pulled({ status: 'failed', failure: denial }));
    await render(<Doctors />);
    await waitFor(() => {
      expect(screen.getByText('You do not have access to this list')).toBeTruthy();
    });
    expect(screen.queryByText('No doctors in your territory yet.')).toBeNull();
  });

  it('distinguishes an empty territory from a refused one', async () => {
    // Same screen, different server answer, different words. If these two collapsed into
    // one state the MR could not tell "you have none" from "you may not look".
    mockStore.mockReturnValue(pulled());
    await render(<Doctors />);
    await waitFor(() => {
      expect(screen.getByText('No doctors in your territory yet.')).toBeTruthy();
    });
    expect(screen.queryByText('You do not have access to this list')).toBeNull();
  });

  it('names what is loading rather than showing a bare spinner', async () => {
    mockStore.mockReturnValue(pulled({ status: 'loading' }));
    await render(<Doctors />);
    expect(screen.getByLabelText('Getting your doctor list')).toBeTruthy();
  });

  it('separates a transport failure from a denial', async () => {
    // A network error is not a permission problem, and telling an MR they lack access
    // when the wifi dropped is how trust in the app dies.
    //
    // **This case caught a real regression during MR-14 B2.** The conversion's first draft
    // gave the provider a single `refusal` field, so an unreachable server and a 42501
    // rendered the same words. `PullFailure` is a discriminated union because of this test.
    mockStore.mockReturnValue(pulled({ status: 'failed', failure: { kind: 'unreachable' } }));
    await render(<Doctors />);
    await waitFor(() => {
      expect(screen.getByText('Could not load doctors')).toBeTruthy();
    });
    expect(screen.queryByText('You do not have access to this list')).toBeNull();
  });

  it('does not offer "On plan", because the pull cannot answer it', async () => {
    // MR-14 B9. `sync_pull` has no `beat_plan_entry` entity, so `BeatPlanRecord` omits
    // `entries` and the client cannot know who is on today's plan. The chip would filter
    // against an empty set and show NO DOCTORS — the client presenting its own gap as a
    // fact about the day, which is the same failure as rendering a denial as an empty
    // list. Asserted so that adding the entity is a change to this test rather than a
    // chip quietly reappearing with nothing behind it.
    mockStore.mockReturnValue(pulled());
    await render(<Doctors />);
    expect(screen.getByText('All')).toBeTruthy();
    expect(screen.queryByText('On plan')).toBeNull();
  });
});
