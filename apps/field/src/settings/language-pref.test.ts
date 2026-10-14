import { describe, expect, it } from 'vitest';
import { createLanguageStore } from '@fieldforce/ui/i18n';
import { LANGUAGE_KEY, chooseAppLanguage, loadAppLanguage } from './language-pref';
import type { KeyValue } from './data-prefs';

/**
 * `FE-W142` — the app language is kept per phone, and a stored language that is no longer
 * complete is not applied.
 */
const memory = (
  initial: Record<string, string> = {},
): KeyValue & { values: Record<string, string> } => {
  const values = { ...initial };
  return {
    values,
    getItem: (key) => Promise.resolve(values[key] ?? null),
    setItem: (key, value) => {
      values[key] = value;
      return Promise.resolve();
    },
  };
};

const en = { 'a.one': 'One', 'a.two': 'Two' };
const complete = () => createLanguageStore({ en, hi: { 'a.one': 'एक', 'a.two': 'दो' }, mr: {} });
const halfDone = () => createLanguageStore({ en, hi: { 'a.one': 'एक', 'a.two': '' }, mr: {} });

describe('loadAppLanguage', () => {
  it('applies a stored language whose catalogue is complete', async () => {
    const store = complete();
    expect(await loadAppLanguage(memory({ [LANGUAGE_KEY]: 'hi' }), store)).toBe('hi');
    expect(store.t('a.one' as never)).toBe('एक');
  });

  it('stays in English when the stored language is no longer complete', async () => {
    // A later build adds a key the translators have not done: the app opens in English, not a mix.
    const store = halfDone();
    expect(await loadAppLanguage(memory({ [LANGUAGE_KEY]: 'hi' }), store)).toBe('en');
  });

  it('stays in English on nothing stored, on junk, and on a failed read', async () => {
    expect(await loadAppLanguage(memory(), complete())).toBe('en');
    expect(await loadAppLanguage(memory({ [LANGUAGE_KEY]: 'fr' }), complete())).toBe('en');
    const broken: KeyValue = {
      getItem: () => Promise.reject(new Error('disk')),
      setItem: () => Promise.resolve(),
    };
    expect(await loadAppLanguage(broken, complete())).toBe('en');
  });
});

describe('chooseAppLanguage', () => {
  it('switches and keeps a complete language', async () => {
    const storage = memory();
    const store = complete();
    expect(await chooseAppLanguage('hi', storage, store)).toBe('saved');
    expect(store.current()).toBe('hi');
    expect(storage.values[LANGUAGE_KEY]).toBe('hi');
  });

  it('refuses an incomplete language, and stores nothing', async () => {
    const storage = memory();
    const store = halfDone();
    expect(await chooseAppLanguage('hi', storage, store)).toBe('refused');
    expect(store.current()).toBe('en');
    expect(storage.values[LANGUAGE_KEY]).toBeUndefined();
  });

  it('says so when the switch took effect but the phone could not keep it', async () => {
    const store = complete();
    const full: KeyValue = {
      getItem: () => Promise.resolve(null),
      setItem: () => Promise.reject(new Error('full')),
    };
    expect(await chooseAppLanguage('hi', full, store)).toBe('unsaved');
    expect(store.current()).toBe('hi');
  });
});
