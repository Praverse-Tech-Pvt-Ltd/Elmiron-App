/**
 * `FE-W143` — the translators' file: the catalogue out to CSV, and back in with validation.
 *
 * **Self-contained on purpose: no imports.** `scripts/i18n-export.mjs` and `scripts/i18n-import.mjs`
 * load this file directly under Node 24's type stripping, so it must not import anything a bare
 * Node resolve cannot find. The tests (`csv.test.ts`) exercise the same functions under vitest.
 *
 * One row per key: `key, english, context, max_length, hindi, marathi`. The file is UTF-8 with a
 * byte-order mark, because without one Excel opens Devanagari as mojibake — and Excel is what a
 * translator will open it in.
 *
 * **What the import refuses, all at once rather than one at a time:**
 * - a key the app does not have (a typo, or a row from an older file);
 * - the same key twice;
 * - an `english` cell that is not today's English — the file is older than the app, and a
 *   translation of words the app no longer shows is not a translation of anything;
 * - a translation whose `{placeholders}` differ from English's — `{count}` renamed or dropped
 *   would print a raw brace on a rep's screen, or lose the number;
 * - a translation longer than `max_length`, where the layout set one.
 *
 * Nothing is written unless every row passes.
 */
export type Strings = Readonly<Record<string, string>>;

export interface KeyNote {
  readonly note?: string;
  readonly max?: number;
}

export interface Notes {
  /** Key prefix (`today`, `settings`) → where the words appear, for the context column. */
  readonly screens: Readonly<Record<string, string>>;
  readonly keys: Readonly<Record<string, KeyNote>>;
}

export const HEADER = ['key', 'english', 'context', 'max_length', 'hindi', 'marathi'] as const;

const BOM = '﻿';

const PLACEHOLDER = /\{(\w+)\}/gu;

const placeholders = (text: string): string =>
  [...new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? ''))].sort().join(',');

/** `{count}, {doctor}` for a message, or `none`. */
const braces = (text: string): string => {
  const names = placeholders(text);
  return names === '' ? 'none' : `{${names.split(',').join('}, {')}}`;
};

/** Line endings as a spreadsheet may have rewritten them, compared as `\n`. */
const normalise = (text: string): string => text.replace(/\r\n?/gu, '\n');

/**
 * Length as a reader sees it: grapheme clusters, not UTF-16 units. A Devanagari conjunct is
 * several code points and one shape, so counting code points would refuse a translation that fits.
 */
export const visibleLength = (text: string): number =>
  [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length;

const quote = (cell: string): string =>
  /[",\r\n]/u.test(cell) || cell !== cell.trim() ? `"${cell.replace(/"/gu, '""')}"` : cell;

export const toCsv = (rows: readonly (readonly string[])[]): string =>
  BOM + rows.map((row) => row.map(quote).join(',')).join('\r\n') + '\r\n';

/** RFC 4180: quoted fields may hold commas, doubled quotes and line breaks. */
export const parseCsv = (input: string): string[][] => {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] ?? '';
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // A spreadsheet often leaves blank lines at the end; they are not rows.
  return rows.filter((each) => each.some((value) => value.trim() !== ''));
};

const contextFor = (key: string, notes: Notes): string => {
  const prefix = key.split('.')[0] ?? key;
  const screen = notes.screens[prefix] ?? prefix;
  const note = notes.keys[key]?.note;
  return note === undefined ? screen : `${screen} — ${note}`;
};

export const exportRows = (input: {
  readonly en: Strings;
  readonly hi: Strings;
  readonly mr: Strings;
  readonly notes: Notes;
}): string[][] => [
  [...HEADER],
  ...Object.keys(input.en).map((key) => [
    key,
    input.en[key] ?? '',
    contextFor(key, input.notes),
    String(input.notes.keys[key]?.max ?? ''),
    input.hi[key] ?? '',
    input.mr[key] ?? '',
  ]),
];

export interface ImportResult {
  readonly errors: readonly string[];
  readonly hi: Strings;
  readonly mr: Strings;
  /** Keys in the app that the file had no row for; their values are left as they were. */
  readonly missing: readonly string[];
  readonly changed: number;
}

export const importRows = (input: {
  readonly en: Strings;
  readonly hi: Strings;
  readonly mr: Strings;
  readonly notes: Notes;
  readonly rows: readonly (readonly string[])[];
}): ImportResult => {
  const errors: string[] = [];
  const [header, ...body] = input.rows;
  const headerText = (header ?? []).map((cell) => cell.trim().toLowerCase()).join(',');
  if (headerText !== HEADER.join(',')) {
    return {
      errors: [`The first row must be exactly: ${HEADER.join(',')} — it is: ${headerText}`],
      hi: input.hi,
      mr: input.mr,
      missing: [],
      changed: 0,
    };
  }

  const hi: Record<string, string> = { ...input.hi };
  const mr: Record<string, string> = { ...input.mr };
  const seen = new Set<string>();
  let changed = 0;

  body.forEach((cells, index) => {
    const row = index + 2; // the spreadsheet's own row number: the header is row 1
    const key = (cells[0] ?? '').trim();
    const english = cells[1] ?? '';
    const hindi = normalise((cells[4] ?? '').trim());
    const marathi = normalise((cells[5] ?? '').trim());
    const translations: readonly ['hindi' | 'marathi', string][] = [
      ['hindi', hindi],
      ['marathi', marathi],
    ];
    const source = input.en[key];

    if (source === undefined) {
      errors.push(`row ${String(row)}: "${key}" is not a key in the app.`);
      return;
    }
    if (seen.has(key)) {
      errors.push(`row ${String(row)}: "${key}" appears more than once.`);
      return;
    }
    seen.add(key);
    if (normalise(english) !== normalise(source)) {
      errors.push(
        `row ${String(row)}: the English for "${key}" is not what the app shows now. Export a fresh file and translate that.`,
      );
      return;
    }

    const max = input.notes.keys[key]?.max;
    for (const [column, value] of translations) {
      if (value === '') continue;
      if (placeholders(value) !== placeholders(source)) {
        errors.push(
          `row ${String(row)}: the ${column} for "${key}" must keep the placeholders ${braces(source)} exactly — it has ${braces(value)}.`,
        );
      }
      if (max !== undefined && visibleLength(value) > max) {
        errors.push(
          `row ${String(row)}: the ${column} for "${key}" is ${String(visibleLength(value))} characters; the layout allows ${String(max)}.`,
        );
      }
    }

    if ((hi[key] ?? '') !== hindi) changed += 1;
    if ((mr[key] ?? '') !== marathi) changed += 1;
    hi[key] = hindi;
    mr[key] = marathi;
  });

  const ordered = (values: Record<string, string>): Strings =>
    Object.fromEntries(Object.keys(input.en).map((key) => [key, values[key] ?? '']));

  return errors.length > 0
    ? { errors, hi: input.hi, mr: input.mr, missing: [], changed: 0 }
    : {
        errors,
        hi: ordered(hi),
        mr: ordered(mr),
        missing: Object.keys(input.en).filter((key) => !seen.has(key)),
        changed,
      };
};

/** The catalogue file as it is committed: English's key order, two-space JSON, final newline. */
export const catalogueJson = (values: Strings): string => `${JSON.stringify(values, null, 2)}\n`;
