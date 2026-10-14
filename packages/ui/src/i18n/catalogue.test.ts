import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import en from './en.json';
import hi from './hi.json';
import mr from './mr.json';
import notes from './notes.json';
import { placeholdersOf } from './translate';
import { visibleLength } from './csv';

/**
 * `FE-W140` — the catalogue's shape, checked against the code that uses it.
 *
 * 1. Every key the code asks for exists in English (or is the base of an English plural pair).
 * 2. Every English key is used somewhere, so translators are never handed a dead string.
 * 3. `hi.json` and `mr.json` carry EXACTLY English's keys: none missing, none stale.
 * 4. A filled translation keeps English's `{placeholders}`.
 * 5. The consent screen's doctor-facing files never call the catalogue (`FE-W148`).
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SOURCES = ['apps/field/app', 'apps/field/src', 'packages/ui/src'];

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name.startsWith('.')) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/u.test(name) ? [path] : [];
  });

const files = SOURCES.flatMap((dir) => walk(join(ROOT, dir)));
const isTest = (path: string): boolean => /\.(test|spec)\.tsx?$/u.test(path) || path.includes('__');
const source = new Map(files.map((path) => [path, readFileSync(path, 'utf8')]));

const english: Readonly<Record<string, string>> = en;
const keys = Object.keys(english);
const pluralBases = new Set(
  keys.filter((key) => key.endsWith('_one')).map((key) => key.slice(0, -'_one'.length)),
);
const known = (key: string): boolean => key in english || pluralBases.has(key);

/** A call of the global `t(<literal key>)` — not a method such as `store.t(…)` in a store test. */
const T_CALL = /(?<![.\w])t\(\s*['"]([^'"]+)['"]/gu;

describe('every key the code uses exists in English', () => {
  it('has at least one t() call to check (a positive control on the scan)', () => {
    const calls = [...source.values()].join('\n').match(T_CALL) ?? [];
    expect(calls.length).toBeGreaterThan(100);
  });

  it('finds no t() call naming a key English lacks', () => {
    const missing: string[] = [];
    for (const [path, text] of source) {
      for (const match of text.matchAll(T_CALL)) {
        const key = match[1] ?? '';
        if (!known(key)) missing.push(`${path.slice(ROOT.length)}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('every English key is used', () => {
  it('appears as a literal somewhere in the app’s source — by itself, or as its plural base', () => {
    const code = [...source.entries()]
      .filter(([path]) => !isTest(path))
      .map(([, text]) => text)
      .join('\n');
    const unused = keys.filter((key) => {
      const base = key.replace(/_(one|other)$/u, '');
      return !code.includes(`'${base}'`) && !code.includes(`"${base}"`);
    });
    expect(unused).toEqual([]);
  });

  it('pairs every _one with an _other, and the reverse', () => {
    const others = new Set(
      keys.filter((key) => key.endsWith('_other')).map((key) => key.slice(0, -'_other'.length)),
    );
    expect([...pluralBases].filter((base) => !others.has(base))).toEqual([]);
    expect([...others].filter((base) => !pluralBases.has(base))).toEqual([]);
  });

  it('has no empty English value', () => {
    expect(keys.filter((key) => (english[key] ?? '').trim() === '')).toEqual([]);
  });
});

describe.each([
  ['hi', hi as Readonly<Record<string, string>>],
  ['mr', mr as Readonly<Record<string, string>>],
])('%s.json', (_name, catalogue) => {
  it('has exactly English’s keys, in English’s order', () => {
    expect(Object.keys(catalogue)).toEqual(keys);
  });

  it('keeps English’s placeholders in every value it has filled', () => {
    const broken = Object.entries(catalogue)
      .filter(([, value]) => value.trim() !== '')
      .filter(
        ([key, value]) =>
          placeholdersOf(value).join(',') !== placeholdersOf(english[key] ?? '').join(','),
      )
      .map(([key]) => key);
    expect(broken).toEqual([]);
  });
});

describe('notes.json', () => {
  it('describes only keys that exist', () => {
    expect(Object.keys(notes.keys).filter((key) => !(key in english))).toEqual([]);
  });

  it('names a screen for every key prefix', () => {
    const screens: Readonly<Record<string, string>> = notes.screens;
    const prefixes = new Set(keys.map((key) => key.split('.')[0] ?? key));
    expect([...prefixes].filter((prefix) => screens[prefix] === undefined)).toEqual([]);
  });

  it('sets no max_length the English itself breaks', () => {
    const limits: Readonly<Record<string, { readonly note?: string; readonly max?: number }>> =
      notes.keys;
    const over = Object.entries(limits)
      .filter(
        ([key, note]) => note.max !== undefined && visibleLength(english[key] ?? '') > note.max,
      )
      .map(([key]) => key);
    expect(over).toEqual([]);
  });
});

/**
 * `FE-W148`. The consent screen is the doctor's, and its words frame a legal notice. They are not
 * translated by the app: the notice comes only from a published, versioned `consent_text_versions`
 * row, and the framing stays English until an approved translation arrives the same way. A `t()`
 * call here would put translators' words — reviewed by nobody legal — in front of a doctor.
 */
describe('the consent screen stays out of the catalogue', () => {
  const CONSENT_FILES = [
    'apps/field/src/consent/content.ts',
    'apps/field/app/consent/[visitId].tsx',
    'packages/ui/src/ConsentScreen.tsx',
    'packages/ui/src/ConsentDetailsScreen.tsx',
  ];

  it.each(CONSENT_FILES)('%s neither calls t() nor imports the catalogue', (file) => {
    const text = readFileSync(join(ROOT, file), 'utf8');
    expect(text).not.toMatch(/\bt\(\s*['"]/u);
    expect(text).not.toMatch(/\buseT\b|\buseLanguage\b|from '[^']*i18n[^']*'/u);
  });
});

/**
 * `FE-W182`. Nothing the rep or a manager reads names the project's own bookkeeping. Home's two
 * rows for a manager and an administrator read "Exceptions and approvals — FE-W6" on a client's
 * phone. Placeholders are removed before the check, so `{count}` is not mistaken for anything.
 */
describe('no internal reference in a word the app shows', () => {
  const INTERNAL = [
    /\b(?:FE|BE)-(?:W|C|D|CR)-?\d/u, // a change, decision or contract-request id
    /\bMR-\d/u, // a review round
    /\b[QD]-\d/u, // an open question or a decision
    /\b[a-z]+_[a-z]+\b/u, // a schema name: a table, a column, an enum value
  ];

  it('finds none in any English value', () => {
    const leaks = Object.entries(english)
      .filter(([, value]) => {
        const words = value.replace(/\{\w+\}/gu, '');
        return INTERNAL.some((pattern) => pattern.test(words));
      })
      .map(([key, value]) => `${key}: ${value}`);
    expect(leaks).toEqual([]);
  });

  it('would catch the two that shipped (a positive control on the patterns)', () => {
    const caught = (text: string): boolean => INTERNAL.some((pattern) => pattern.test(text));
    expect(caught('Exceptions and approvals — FE-W6')).toBe(true);
    expect(caught('Signed in as field_manager')).toBe(true);
    expect(caught('{count} visits reviewed of {total}'.replace(/\{\w+\}/gu, ''))).toBe(false);
  });
});

/**
 * `FE-W183`. Learning, the lesson tutor and the lesson video were the last rep-facing screens with
 * their words written into the component. No English prop value and no English JSX text is left in
 * them: everything shown is a catalogue key or the server's content.
 */
describe('Learning is on the catalogue', () => {
  const FILES = [
    'packages/ui/src/LearningScreens.tsx',
    'packages/ui/src/TutorPanel.tsx',
    'packages/ui/src/LessonVideoFrame.tsx',
    'apps/field/src/learning/view.ts',
    'apps/field/src/learning/lesson-video-view.ts',
    'apps/field/app/learning/[courseId].tsx',
    'apps/field/app/learning/lesson/[lessonId].tsx',
  ];
  /** Comments say things in English on purpose; only code is checked. */
  const code = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');

  it.each(FILES)('%s calls the catalogue', (file) => {
    // `T_CALL` without its global flag: a `g` regex carries `lastIndex` from one test to the next.
    expect(code(readFileSync(join(ROOT, file), 'utf8'))).toMatch(/(?<![.\w])t\(\s*['"]/u);
  });

  it.each(FILES)('%s writes no English sentence into what it shows', (file) => {
    const text = code(readFileSync(join(ROOT, file), 'utf8'));
    // A prop given a literal ("label=\"Try again\""), JSX text between tags, or a string literal
    // that reads as words: two or more words, the first capitalised.
    expect(text).not.toMatch(
      /\b(?:label|title|detail|help|note|accessibilityLabel|accessibilityHint)="[^"]*[A-Za-z]/u,
    );
    expect(text).not.toMatch(/>\s*[A-Z][a-z]+(?: [a-z’']+)+[.…]?\s*</u);
    expect(text).not.toMatch(/['`"][A-Z][a-z]+(?: [a-z’']+){2,}/u);
  });
});
