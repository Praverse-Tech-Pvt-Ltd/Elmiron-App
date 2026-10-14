import { CATALOGUES } from './catalogue';
import type { TextKey } from './catalogue';
import { progressOf, translate } from './translate';
import type { Catalogues, Language, Params, Progress } from './translate';

/**
 * `FE-W141` — which language the app is in, and the global `t()`.
 *
 * **One module-level choice, not a React context.** Strings are built in plain modules as well as
 * in components (`settings/content.ts`, `sync/indicator.ts`, `errors/plain.ts`), and threading a
 * `t` through every one of them would touch every signature for no gain. So `t()` reads the
 * current language here, and `useT()` (`useT.ts`) subscribes a component to changes so it renders
 * again — which re-runs every plain module it calls.
 *
 * **An incomplete language cannot be chosen.** `choose` refuses one: a rep reading half Hindi and
 * half English is worse served than one reading English, and an app that lets them pick it would
 * be claiming a translation that does not exist. The rows still show the language, with how far
 * the translators have got (`progress`), and it becomes choosable the moment the file is full —
 * with no code change, because completeness is read from the file.
 */
export interface LanguageStore {
  readonly current: () => Language;
  readonly subscribe: (listener: () => void) => () => void;
  readonly progress: (language: Language) => Progress;
  readonly selectable: (language: Language) => boolean;
  /** Switches to `language` if it is selectable; answers whether the app is now in it. */
  readonly choose: (language: Language) => boolean;
  readonly t: (key: TextKey, params?: Params) => string;
}

export const createLanguageStore = (catalogues: Catalogues): LanguageStore => {
  let current: Language = 'en';
  const listeners = new Set<() => void>();

  const progress = (language: Language): Progress =>
    progressOf(catalogues.en, catalogues[language]);
  const selectable = (language: Language): boolean => {
    if (language === 'en') return true;
    const { done, total } = progress(language);
    return total > 0 && done === total;
  };

  return {
    current: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    progress,
    selectable,
    choose: (language) => {
      if (!selectable(language)) return current === language;
      if (language !== current) {
        current = language;
        for (const listener of listeners) listener();
      }
      return true;
    },
    t: (key, params) => translate(catalogues, current, key, params),
  };
};

/** The app's one store, over the shipped catalogues. */
export const languageStore: LanguageStore = createLanguageStore(CATALOGUES);

/**
 * The text for `key` in the app's current language, English where that language has no value.
 * Call it during render (or from a function called during render) so a language change reaches it.
 */
export const t = (key: TextKey, params?: Params): string => languageStore.t(key, params);

/** Whether `code` is one of the app's languages — for a value read back from storage. */
export const isLanguage = (code: unknown): code is Language =>
  code === 'en' || code === 'hi' || code === 'mr';
