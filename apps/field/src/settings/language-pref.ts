import AsyncStorage from '@react-native-async-storage/async-storage';
import { isLanguage, languageStore } from '@fieldforce/ui/i18n';
import type { Language, LanguageStore } from '@fieldforce/ui/i18n';
import type { KeyValue } from './data-prefs';

/**
 * `FE-W142` — the app language, kept per PHONE.
 *
 * Not per account, for the same reason the "Your data" switches are not: this app runs on shared
 * handsets, and the language is a property of the person holding the phone at the sign-in screen,
 * before anybody is signed in. It is read once at start-up, before the first paint
 * (`app/_layout.tsx`), so a Hindi reader never sees a flash of English first.
 *
 * **A stored language that is not selectable is not applied.** If a later build ships a
 * catalogue with new, untranslated keys, Hindi stops being complete; the app then opens in
 * English rather than in a mixture, and the row says how far the translators have got.
 */
export const LANGUAGE_KEY = 'settings.appLanguage';

/** Reads the stored choice and applies it if it can be. Never throws: a failed read is English. */
export const loadAppLanguage = async (
  storage: KeyValue = AsyncStorage,
  store: LanguageStore = languageStore,
): Promise<Language> => {
  const raw = await storage.getItem(LANGUAGE_KEY).catch(() => null);
  if (isLanguage(raw)) store.choose(raw);
  return store.current();
};

/**
 * Switches the app to `language` and keeps the choice. Answers what happened, so the screen can
 * say so: `refused` for an incomplete language (the row should not have offered it), `unsaved`
 * when the switch took effect but the phone could not keep it — it holds until the app restarts.
 */
export const chooseAppLanguage = async (
  language: Language,
  storage: KeyValue = AsyncStorage,
  store: LanguageStore = languageStore,
): Promise<'saved' | 'unsaved' | 'refused'> => {
  if (!store.choose(language)) return 'refused';
  try {
    await storage.setItem(LANGUAGE_KEY, language);
    return 'saved';
  } catch {
    return 'unsaved';
  }
};
