import { describe, expect, it, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react-native';
import { ApiRequestError } from '@fieldforce/core';

const mockListDoctors = jest.fn<() => Promise<unknown>>();
jest.mock('../api', () => ({ createClientForScenario: () => ({ listDoctors: mockListDoctors }) }));

import Doctors from '../../app/doctors';

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
    await render(<Doctors />);
    expect(screen.getByLabelText('Loading doctors')).toBeTruthy();
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
