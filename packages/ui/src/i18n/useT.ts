import { useSyncExternalStore } from 'react';
import { languageStore, t } from './store';
import type { Language } from './translate';

/**
 * `FE-W141` — the app's current language, as a value a component re-renders on.
 *
 * Every component that shows catalogue text calls this (directly or through `useT`), so a choice
 * made on Settings repaints every mounted screen — the tabs behind the one in view included —
 * without remounting the navigator and losing where the rep was.
 */
export const useLanguage = (): Language =>
  useSyncExternalStore(languageStore.subscribe, languageStore.current, languageStore.current);

/** `t`, plus a subscription: a component that calls this renders again when the language changes. */
export const useT = (): { readonly t: typeof t; readonly language: Language } => {
  const language = useLanguage();
  return { t, language };
};
