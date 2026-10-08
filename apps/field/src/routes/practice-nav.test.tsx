import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

/**
 * FE-D17 — AI Doctor practice is reachable by navigation: Today → Me (the tab bar) → the row.
 * With the flag off the row does not exist, so a demo build carries no trace of it.
 */

let mockPracticeEnabled = false;
jest.mock('../features', () => ({
  get practiceEnabled() {
    return mockPracticeEnabled;
  },
  assistantEnabled: false,
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

describe('FE-D17 — Me → AI Doctor practice', () => {
  it('with the flag on, Me lists it — no longer "sample data" — and opens it', async () => {
    mockPracticeEnabled = true;
    await render(<Me />);

    expect(screen.getByText('AI Doctor practice')).toBeTruthy();
    expect(screen.getByText('Practise a visit with an AI doctor and get feedback.')).toBeTruthy();
    expect(screen.queryByText(/Sample data/u)).toBeNull();
    await fireEvent.press(screen.getByText('AI Doctor practice'));
    expect(mockPush).toHaveBeenCalledWith('/practice');
  });

  it('with the flag off, there is no practice row at all', async () => {
    mockPracticeEnabled = false;
    await render(<Me />);

    expect(screen.queryByText('AI Doctor practice')).toBeNull();
  });
});
