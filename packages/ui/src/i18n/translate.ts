/**
 * `FE-W140` — the pure half of the field app's string catalogue: look a key up, fill its
 * placeholders, pick its plural form, and fall back to English per key.
 *
 * **No dependency, on purpose.** The repo asks before adding one, and what this app needs is
 * small: `{name}` placeholders and a one/other plural. `Intl.PluralRules` would answer the plural
 * question, but Hermes' `Intl` coverage has varied by release and a missing constructor would
 * throw on the one screen that counts something; the three rules below are the CLDR rules for the
 * three languages this app ships, for the whole numbers it ever counts.
 *
 * **The fallback is per key, and it is never a blank or a raw key.** A Hindi catalogue with 40 of
 * 300 strings filled shows those 40 in Hindi and the rest in English — but that only matters in a
 * test, because an incomplete language cannot be chosen (`store.ts`). An empty or whitespace value
 * counts as missing, because that is what the translators' file holds for "not done yet".
 */
export type Language = 'en' | 'hi' | 'mr';

export type Catalogue = Readonly<Record<string, string>>;

export type Catalogues = Readonly<Record<Language, Catalogue>>;

export type Params = Readonly<Record<string, string | number>>;

export type PluralCategory = 'one' | 'other';

/**
 * CLDR's cardinal rules, restricted to whole numbers (every count this app shows is one).
 *
 * - English: one for 1.
 * - Hindi: one for 0 and 1 (`i = 0 or n = 1`) — "0 विज़िट" takes the singular form.
 * - Marathi: one for 1.
 */
export const pluralCategory = (language: Language, count: number): PluralCategory => {
  switch (language) {
    case 'hi':
      return count === 0 || count === 1 ? 'one' : 'other';
    case 'en':
    case 'mr':
      return count === 1 ? 'one' : 'other';
  }
};

/** `{name}` — letters, digits and underscore. Nothing else is a placeholder. */
const PLACEHOLDER = /\{(\w+)\}/gu;

/** The distinct placeholder names in a string, sorted — the shape a translation must keep. */
export const placeholdersOf = (text: string): readonly string[] =>
  [...new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? ''))].sort();

/**
 * Fills `{name}` from `params`. A placeholder with no value is left as written rather than
 * blanked: a visible `{doctor}` is a defect a test or a reviewer can see, a missing word is not.
 */
export const interpolate = (text: string, params: Params | undefined): string =>
  params === undefined
    ? text
    : text.replace(PLACEHOLDER, (whole, name: string) => {
        const value = params[name];
        return value === undefined ? whole : String(value);
      });

/** A value counts only if it has something in it — `""` is the translators' "not done yet". */
const present = (catalogue: Catalogue, key: string): string | null => {
  const value = catalogue[key];
  return value === undefined || value.trim() === '' ? null : value;
};

/** True when `key` is the base of a `key_one` / `key_other` pair in English. */
export const isPluralBase = (english: Catalogue, key: string): boolean =>
  english[`${key}_one`] !== undefined && english[`${key}_other`] !== undefined;

/**
 * The text for `key` in `language`, falling back to English for that key alone.
 *
 * A plural key is asked for by its base (`today.stopsLeft`) with a numeric `count`; the form is
 * chosen by each language's own rule, so a Hindi fallback to English uses English's rule.
 */
export const translate = (
  catalogues: Catalogues,
  language: Language,
  key: string,
  params?: Params,
): string => {
  const count = params?.['count'];
  const plural = typeof count === 'number' && isPluralBase(catalogues.en, key);
  const keyFor = (lang: Language): string =>
    plural ? `${key}_${pluralCategory(lang, count)}` : key;

  const text =
    present(catalogues[language], keyFor(language)) ??
    present(catalogues.en, keyFor('en')) ??
    // Unreachable for a typed key: `catalogue.test.ts` fails the build on any key used in code
    // that English lacks. Kept as the key rather than '' so the defect is visible if it happens.
    key;
  return interpolate(text, params);
};

export interface Progress {
  readonly done: number;
  readonly total: number;
}

/** How many of English's keys `target` has a value for. */
export const progressOf = (english: Catalogue, target: Catalogue): Progress => {
  const keys = Object.keys(english);
  return {
    done: keys.filter((key) => present(target, key) !== null).length,
    total: keys.length,
  };
};
