import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * `FE-W142` — the day the translators' Hindi file arrives complete.
 *
 * Nothing in the app changes: this suite stands in a FULL `hi.json` (every English value with
 * "हि " in front, placeholders intact) and drives Me as a rep would. Hindi becomes pressable, the
 * screen repaints in place, and the choice is kept on the phone. Marathi, still empty, stays
 * waiting.
 */
jest.mock('../../../../packages/ui/src/i18n/hi.json', () => {
  const english = jest.requireActual<Record<string, string>>(
    '../../../../packages/ui/src/i18n/en.json',
  );
  return Object.fromEntries(Object.entries(english).map(([key, value]) => [key, `हि ${value}`]));
});
jest.mock('../session', () => ({
  useSession: () => ({ signOut: jest.fn(), status: 'signed-in', session: null }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

import { languageStore } from '@fieldforce/ui/i18n';
import Me from '../../app/(tabs)/me';
import { LANGUAGE_KEY, loadAppLanguage } from '../settings/language-pref';

afterEach(async () => {
  await act(() => {
    languageStore.choose('en');
  });
  await AsyncStorage.clear();
});

describe('a complete Hindi file, with no code change', () => {
  it('makes Hindi pressable; pressing it repaints Me in Hindi and keeps the choice', async () => {
    await render(<Me />);
    expect(screen.getByText('Settings')).toBeTruthy();
    expect(screen.queryByText(/^Hindi: waiting/u)).toBeNull();
    expect(screen.getByText(/^Marathi: waiting for translation/u)).toBeTruthy();

    await fireEvent.press(screen.getByText('हिन्दी'));

    expect(await screen.findByText('हि Settings')).toBeTruthy();
    expect(screen.getByText('हि Sign out')).toBeTruthy();
    // Every language is still named in its own script, so the way back is always readable.
    expect(screen.getByText('English')).toBeTruthy();
    expect(await AsyncStorage.getItem(LANGUAGE_KEY)).toBe('hi');
  });

  it('opens in the kept language on the next start', async () => {
    await AsyncStorage.setItem(LANGUAGE_KEY, 'hi');
    await act(async () => {
      expect(await loadAppLanguage()).toBe('hi');
    });
    await render(<Me />);
    expect(screen.getByText('हि Settings')).toBeTruthy();
  });

  it('never opens in a stored language that is incomplete', async () => {
    await AsyncStorage.setItem(LANGUAGE_KEY, 'mr');
    await act(async () => {
      expect(await loadAppLanguage()).toBe('en');
    });
    await render(<Me />);
    expect(screen.getByText('Settings')).toBeTruthy();
  });
});
