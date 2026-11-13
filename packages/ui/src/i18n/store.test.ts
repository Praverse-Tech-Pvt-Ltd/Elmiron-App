import { describe, expect, it } from 'vitest';
import { createLanguageStore, isLanguage, languageStore } from './store';
import { CATALOGUES } from './catalogue';

/**
 * `FE-W141` — an incomplete language is shown but cannot be chosen, and becomes choosable the
 * moment its file is full, with no code change: completeness is read from the catalogue.
 */
const en = { 'a.one': 'One', 'a.two': 'Two' };

describe('the language store', () => {
  it('refuses a language whose catalogue is not complete, and stays where it was', () => {
    const store = createLanguageStore({ en, hi: { 'a.one': 'एक', 'a.two': '' }, mr: {} });
    expect(store.selectable('hi')).toBe(false);
    expect(store.choose('hi')).toBe(false);
    expect(store.current()).toBe('en');
    expect(store.progress('hi')).toEqual({ done: 1, total: 2 });
  });

  it('accepts the same language once every key has a value — nothing else changes', () => {
    const store = createLanguageStore({ en, hi: { 'a.one': 'एक', 'a.two': 'दो' }, mr: {} });
    expect(store.selectable('hi')).toBe(true);
    expect(store.choose('hi')).toBe(true);
    expect(store.current()).toBe('hi');
    expect(store.t('a.two' as never)).toBe('दो');
  });

  it('tells subscribers once per real change, and not for a refusal', () => {
    const store = createLanguageStore({ en, hi: { 'a.one': 'एक', 'a.two': 'दो' }, mr: {} });
    let heard = 0;
    const stop = store.subscribe(() => {
      heard += 1;
    });
    store.choose('mr'); // refused: empty
    store.choose('hi');
    store.choose('hi'); // already there
    store.choose('en');
    stop();
    store.choose('hi');
    expect(heard).toBe(2);
  });

  it('English is always selectable', () => {
    expect(createLanguageStore({ en, hi: {}, mr: {} }).selectable('en')).toBe(true);
  });

  it('isLanguage accepts only the three codes', () => {
    expect(['en', 'hi', 'mr', 'fr', '', null].map(isLanguage)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});

describe('the shipped catalogues, today', () => {
  it('a shipped language is selectable exactly when its file has every key filled', () => {
    // Needs no edit the day the translators' files arrive: the rule is the file's completeness,
    // so a half-filled file can never be mistaken for a finished one.
    const full = (values: Readonly<Record<string, string>>): boolean =>
      Object.keys(CATALOGUES.en).every((key) => (values[key] ?? '').trim() !== '');
    expect(languageStore.selectable('hi')).toBe(full(CATALOGUES.hi));
    expect(languageStore.selectable('mr')).toBe(full(CATALOGUES.mr));
    expect(languageStore.current()).toBe('en');
  });
});
