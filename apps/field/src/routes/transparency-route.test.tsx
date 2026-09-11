import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

/**
 * MR-28 C2 — the last screen of first run must let the MR out of it.
 *
 * `onContinue` was `void markFirstRunComplete(...).then(() => router.replace('/home'))`
 * with no `.catch`, and `markFirstRunComplete` writes AsyncStorage, which can fail. When
 * it did, the MR pressed Continue on the LAST screen of onboarding and stayed on it, with
 * no way forward and nothing said.
 *
 * The navigation now happens either way, and the asymmetry is the point: failing to record
 * that first run finished means seeing this screen again next launch, which is annoying and
 * recoverable. Being trapped on it is neither.
 */

const mockReplace = jest.fn();
const mockComplete = jest.fn<(at: string) => Promise<void>>();
const mockHasCompleted = jest.fn<() => Promise<boolean>>();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn() }),
}));
jest.mock('../onboarding/progress', () => ({
  hasCompletedFirstRun: () => mockHasCompleted(),
  markFirstRunComplete: (at: string) => mockComplete(at),
}));

import Transparency from '../../app/transparency';

/** In first run, which is the only state that renders a Continue at all. */
const firstRun = (): void => {
  mockReplace.mockClear();
  mockComplete.mockReset();
  mockHasCompleted.mockReset();
  mockHasCompleted.mockResolvedValue(false);
};

describe('app/transparency.tsx — Continue is never a dead end', () => {
  it('MOVES ON even when the first-run flag could not be written', async () => {
    firstRun();
    mockComplete.mockRejectedValue(new Error('disk full'));
    await render(<Transparency />);

    await fireEvent.press(await screen.findByText('Start my first day'));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/home');
    });
  });

  it('THE POSITIVE CONTROL: still records the flag when the write works', async () => {
    // Without this, a `catch` that swallowed the write entirely would satisfy the case
    // above and quietly make every launch a first run.
    firstRun();
    mockComplete.mockResolvedValue(undefined);
    await render(<Transparency />);

    await fireEvent.press(await screen.findByText('Start my first day'));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/home');
    });
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });
});
