import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

/**
 * FE-D15 — the assistant is reachable by navigation, not only by deep link.
 *
 * From Today, the tab bar's "Me" is one tap; the assistant is a row on Me. With the flag off the
 * row does not exist at all, so a demo build carries no trace of it.
 */

let mockAssistantEnabled = false;
jest.mock('../features', () => ({
  get assistantEnabled() {
    return mockAssistantEnabled;
  },
  coachingEnabled: false,
}));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('../session', () => ({
  useSession: () => ({ signOut: jest.fn(), status: 'signed-in', session: null }),
}));

import Me from '../../app/(tabs)/me';

beforeEach(() => {
  mockPush.mockReset();
});

describe('FE-D15 — Me → Assistant', () => {
  it('with the flag on, Me lists the assistant — no longer "sample data" — and opens it', async () => {
    mockAssistantEnabled = true;
    await render(<Me />);

    expect(screen.getByText('Assistant')).toBeTruthy();
    expect(screen.getByText('Ask how to do something in this app.')).toBeTruthy();
    expect(screen.queryByText(/Sample data/u)).toBeNull();
    await fireEvent.press(screen.getByText('Assistant'));
    expect(mockPush).toHaveBeenCalledWith('/assistant');
  });

  it('with the flag off, there is no assistant row at all', async () => {
    mockAssistantEnabled = false;
    await render(<Me />);

    expect(screen.queryByText('Assistant')).toBeNull();
  });
});
