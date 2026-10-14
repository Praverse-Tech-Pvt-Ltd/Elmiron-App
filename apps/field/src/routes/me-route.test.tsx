import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

/**
 * MR-28 C2 — sign out, on a handset that is about to change hands.
 *
 * The sweep for discarded outcomes found `void signOut();` here: no result read, no
 * failure path, nothing on screen either way. It is the site on that list that matters
 * most, and not because signing out is complicated.
 *
 * **This app runs on shared handsets.** "I pressed sign out" is how an MR hands the phone
 * to somebody else. A sign-out that fails silently leaves the next person holding the
 * previous person's day — their visits, their doctors, their queue — while the screen
 * gives no sign that anything went wrong. Every other silent tap in this sweep costs a
 * repeated press; this one costs somebody else's data.
 */

const mockSignOut = jest.fn<() => Promise<void>>();
jest.mock('../session', () => ({
  useSession: () => ({ signOut: mockSignOut, status: 'signed-in', session: null }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

import { CATALOGUES, languageStore } from '@fieldforce/ui/i18n';
import Me from '../../app/(tabs)/me';
import { asyncStorageQueueStore, setQueueOwner } from '../sync/async-storage-store';
import { checkInQueueItem } from '../sync/outbox';
import { emptyQueue } from '../sync/reducer';

describe('app/(tabs)/me.tsx — sign out is never a silent tap', () => {
  it('says the MR is STILL SIGNED IN when it did not go through', async () => {
    mockSignOut.mockReset();
    mockSignOut.mockRejectedValue(new Error('no network'));
    await render(<Me />);

    await fireEvent.press(screen.getByText('Sign out'));

    expect(await screen.findByText('You are still signed in')).toBeTruthy();
    // The sentence has to carry the CONSEQUENCE, not just the failure. "Sign out failed"
    // is true and leaves an MR with no idea that handing the phone over is now unsafe.
    expect(screen.getByText(/do not until it does/u)).toBeTruthy();
  });

  it('THE POSITIVE CONTROL: says nothing when sign out worked', async () => {
    // A banner that renders unconditionally would satisfy the case above while telling
    // everybody who signs out successfully that they did not.
    mockSignOut.mockReset();
    mockSignOut.mockResolvedValue(undefined);
    await render(<Me />);

    await fireEvent.press(screen.getByText('Sign out'));

    expect(screen.queryByText('You are still signed in')).toBeNull();
  });
});

/**
 * W2-B C / `BE-W151` — "21 things have not been sent yet", told to a rep signing out after all 21
 * had been sent. The count is what they decide the handover on; it must be the queue as it is now.
 */
describe('app/(tabs)/me.tsx — W2-B C, the unsent count follows the queue while Me stays mounted', () => {
  it('a flush that empties the queue while Me is open removes the warning', async () => {
    setQueueOwner('22222222-2222-4222-8222-222222222298');
    const item = checkInQueueItem({
      id: '77777777-7777-4777-8777-777777777781',
      visitId: '77777777-7777-4777-8777-777777777782',
      coordinates: {
        latitude: 18.5204,
        longitude: 73.8567,
        accuracyMetres: 10,
        capturedAt: '2026-09-14T11:00:00+05:30',
      },
      source: 'manual',
      occurredAt: '2026-09-14T11:00:00+05:30',
    });
    await asyncStorageQueueStore.save({ ...emptyQueue, items: [item] });
    await render(<Me />);
    expect(
      await screen.findByText(/1 thing has not been sent|1 things? .*not been sent/u),
    ).toBeTruthy();

    await asyncStorageQueueStore.save(emptyQueue);

    await waitFor(() => {
      expect(screen.queryByText(/not been sent/u)).toBeNull();
    });
  });
});

/**
 * `FE-W142` — the language rows with the files this build ships: Hindi and Marathi are empty, so
 * they are shown, say how far the translation has got, and cannot be pressed. The language a
 * rep cannot read must never be one tap away from replacing the one they can.
 */
describe('app/(tabs)/me.tsx — the language rows, with empty translation files', () => {
  it('shows all three, English in use, the other two waiting and unpressable', async () => {
    mockSignOut.mockReset();
    await render(<Me />);
    const total = Object.keys(CATALOGUES.en).length;

    expect(screen.getByText('English')).toBeTruthy();
    expect(screen.getByText('In use')).toBeTruthy();
    expect(
      screen.getByText(`Hindi: waiting for translation (0 of ${String(total)} done)`),
    ).toBeTruthy();
    expect(
      screen.getByText(`Marathi: waiting for translation (0 of ${String(total)} done)`),
    ).toBeTruthy();

    await fireEvent.press(screen.getByText('हिन्दी'));
    await fireEvent.press(screen.getByText('मराठी'));
    expect(languageStore.current()).toBe('en');
    expect(screen.getByText('Settings')).toBeTruthy();
  });

  it('says consent is English only until an approved notice is published', async () => {
    await render(<Me />);
    expect(screen.getByText(/consent is in English only/u)).toBeTruthy();
  });
});
