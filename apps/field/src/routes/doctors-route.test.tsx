import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react-native';
import { ApiRequestError } from '@fieldforce/core';

const mockListDoctors = jest.fn<() => Promise<unknown>>();
// The list ranks by how long since the last visit, so the route reads both
// collections. Visits default to empty in every case below; the assertions here are
// about how a server DECISION is presented, and an empty visit list keeps that the
// only variable.
const mockListVisits = jest.fn<() => Promise<unknown>>();
// The "On plan" chip filters against the server's approved beat plan, so the route
// reads that too. Empty by default here: these cases are about how a server
// DECISION is presented, and an empty plan keeps that the only variable.
const mockListBeatPlans = jest.fn<() => Promise<unknown>>();
jest.mock('../api', () => ({
  createClientForScenario: () => ({
    listDoctors: mockListDoctors,
    listVisits: mockListVisits,
    listBeatPlans: mockListBeatPlans,
  }),
}));
// The list opens a profile, so the route reads the router. Mocked because the real
// module pulls in `standard-navigation`, which ships untransformed ESM that jest's
// transformIgnorePatterns does not cover.
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

import Doctors from '../../app/(tabs)/doctors';

beforeEach(() => {
  mockListVisits.mockResolvedValue({ items: [], nextCursor: null });
  mockListBeatPlans.mockResolvedValue({ items: [], nextCursor: null });
});

const denial = new ApiRequestError(403, {
  code: 'permission_denied',
  message: 'You are not assigned to this territory.',
  requestId: 'req-1',
  fieldErrors: null,
});

describe('app/doctors.tsx — how the client presents a server decision', () => {
  it('renders a denial as a denial, never as an empty list', async () => {
    // The whole point of the screen. An empty list is what a client-side filter looks
    // like, and the client never decides what an MR may see. This asserts the two are
    // distinguishable on screen.
    mockListDoctors.mockRejectedValue(denial);
    await render(<Doctors />);
    await waitFor(() => {
      expect(screen.getByText('You do not have access to this list')).toBeTruthy();
    });
    expect(screen.queryByText('No doctors in your territory yet.')).toBeNull();
  });

  it("shows the server's sentence verbatim, not a rewritten one", async () => {
    mockListDoctors.mockRejectedValue(denial);
    await render(<Doctors />);
    await waitFor(() => {
      expect(screen.getByText('You are not assigned to this territory.')).toBeTruthy();
    });
  });

  it('distinguishes an empty territory from a refused one', async () => {
    // Same screen, different server answer, different words. If these two collapsed
    // into one state the MR could not tell "you have none" from "you may not look".
    mockListDoctors.mockResolvedValue({ items: [], nextCursor: null });
    await render(<Doctors />);
    await waitFor(() => {
      expect(screen.getByText('No doctors in your territory yet.')).toBeTruthy();
    });
    expect(screen.queryByText('You do not have access to this list')).toBeNull();
  });

  it('names what is loading rather than showing a bare spinner', async () => {
    mockListDoctors.mockReturnValue(new Promise(() => undefined));
    mockListVisits.mockReturnValue(new Promise(() => undefined));
    mockListBeatPlans.mockReturnValue(new Promise(() => undefined));
    await render(<Doctors />);
    expect(screen.getByLabelText('Getting your doctor list')).toBeTruthy();
  });

  it('separates a transport failure from a denial', async () => {
    // A network error is not a permission problem, and telling an MR they lack access
    // when the wifi dropped is how trust in the app dies.
    mockListDoctors.mockRejectedValue(new Error('Network request failed'));
    await render(<Doctors />);
    await waitFor(() => {
      expect(screen.getByText('Could not load doctors')).toBeTruthy();
    });
    expect(screen.queryByText('You do not have access to this list')).toBeNull();
  });
});
