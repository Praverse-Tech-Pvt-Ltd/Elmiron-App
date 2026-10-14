import { describe, expect, it } from 'vitest';
import { interpolate, placeholdersOf, pluralCategory, progressOf, translate } from './translate';
import type { Catalogues } from './translate';

/** `FE-W140` — lookup, placeholders, plurals, and the per-key English fallback. */

const catalogues: Catalogues = {
  en: {
    'a.hello': 'Hello {name}',
    'a.plain': 'Plain',
    'a.stops_one': '1 stop',
    'a.stops_other': '{count} stops',
  },
  hi: {
    'a.hello': 'नमस्ते {name}',
    'a.plain': '   ',
    'a.stops_one': '{count} पड़ाव',
    'a.stops_other': '{count} पड़ाव (कई)',
  },
  mr: { 'a.hello': '' },
};

describe('translate — the fallback is per key, never a blank or a raw key', () => {
  it('uses the language when it has a value', () => {
    expect(translate(catalogues, 'hi', 'a.hello', { name: 'Asha' })).toBe('नमस्ते Asha');
  });

  it('falls back to English for an empty value, a whitespace value and a missing key', () => {
    expect(translate(catalogues, 'mr', 'a.hello', { name: 'Asha' })).toBe('Hello Asha');
    expect(translate(catalogues, 'hi', 'a.plain')).toBe('Plain');
    expect(translate(catalogues, 'mr', 'a.plain')).toBe('Plain');
  });

  it('never returns an empty string for a key English has', () => {
    for (const language of ['en', 'hi', 'mr'] as const) {
      for (const key of ['a.hello', 'a.plain', 'a.stops']) {
        expect(translate(catalogues, language, key, { count: 2, name: 'x' }).trim()).not.toBe('');
      }
    }
  });
});

describe('translate — plurals', () => {
  it('picks English one/other', () => {
    expect(translate(catalogues, 'en', 'a.stops', { count: 1 })).toBe('1 stop');
    expect(translate(catalogues, 'en', 'a.stops', { count: 0 })).toBe('0 stops');
    expect(translate(catalogues, 'en', 'a.stops', { count: 5 })).toBe('5 stops');
  });

  it('uses Hindi’s own rule — 0 takes the singular form', () => {
    expect(translate(catalogues, 'hi', 'a.stops', { count: 0 })).toBe('0 पड़ाव');
    expect(translate(catalogues, 'hi', 'a.stops', { count: 1 })).toBe('1 पड़ाव');
    expect(translate(catalogues, 'hi', 'a.stops', { count: 3 })).toBe('3 पड़ाव (कई)');
  });

  it('falls back to English with ENGLISH’s rule when the language has no plural forms', () => {
    expect(translate(catalogues, 'mr', 'a.stops', { count: 1 })).toBe('1 stop');
    expect(translate(catalogues, 'mr', 'a.stops', { count: 0 })).toBe('0 stops');
  });

  it('knows the three CLDR rules for whole numbers', () => {
    expect([0, 1, 2].map((n) => pluralCategory('en', n))).toEqual(['other', 'one', 'other']);
    expect([0, 1, 2].map((n) => pluralCategory('hi', n))).toEqual(['one', 'one', 'other']);
    expect([0, 1, 2].map((n) => pluralCategory('mr', n))).toEqual(['other', 'one', 'other']);
  });
});

describe('placeholders', () => {
  it('fills by name and leaves an unfilled one visible rather than blank', () => {
    expect(interpolate('{a} and {b}', { a: 1 })).toBe('1 and {b}');
  });

  it('lists distinct names, sorted', () => {
    expect(placeholdersOf('{b} {a} {b}')).toEqual(['a', 'b']);
    expect(placeholdersOf('none')).toEqual([]);
  });
});

describe('progressOf', () => {
  it('counts only keys with a real value', () => {
    expect(progressOf(catalogues.en, catalogues.hi)).toEqual({ done: 3, total: 4 });
    expect(progressOf(catalogues.en, catalogues.mr)).toEqual({ done: 0, total: 4 });
  });
});
