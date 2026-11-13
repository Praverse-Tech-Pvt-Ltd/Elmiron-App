import { describe, expect, it } from 'vitest';
import { HEADER, exportRows, importRows, parseCsv, toCsv, visibleLength } from './csv';
import type { Notes } from './csv';

/** `FE-W143` — the translators' CSV, out and back, and what the import refuses. */

const en = {
  'tabs.today': 'Today',
  'today.startVisit': 'Start the visit to {doctor}',
  'today.note': 'Line one\nline two, with "quotes"',
};
const empty = { 'tabs.today': '', 'today.startVisit': '', 'today.note': '' };
const notes: Notes = {
  screens: { tabs: 'The tab bar', today: 'Today' },
  keys: { 'tabs.today': { note: 'Tab label', max: 6 } },
};

const roundTrip = (rows: string[][]): string[][] => parseCsv(toCsv(rows));

const filled = (hindi: Readonly<Record<string, string>>): string[][] =>
  exportRows({ en, hi: empty, mr: empty, notes }).map((row, index) =>
    index === 0
      ? row
      : [row[0] ?? '', row[1] ?? '', row[2] ?? '', row[3] ?? '', hindi[row[0] ?? ''] ?? '', ''],
  );

describe('the export', () => {
  it('has the header, one row per key, context from the screen and the note, and the limit', () => {
    const rows = exportRows({ en, hi: empty, mr: empty, notes });
    expect(rows[0]).toEqual([...HEADER]);
    expect(rows).toHaveLength(4);
    expect(rows[1]).toEqual(['tabs.today', 'Today', 'The tab bar — Tab label', '6', '', '']);
    expect(rows[2]?.[2]).toBe('Today');
  });

  it('starts with a byte-order mark, so Excel reads Devanagari as Devanagari', () => {
    expect(toCsv([['a']]).charCodeAt(0)).toBe(0xfeff);
  });

  it('survives commas, quotes and line breaks inside a cell', () => {
    const rows = exportRows({ en, hi: empty, mr: empty, notes });
    expect(roundTrip(rows)).toEqual(rows);
  });
});

describe('the import', () => {
  it('takes translations and keeps English’s key order', () => {
    const result = importRows({
      en,
      hi: empty,
      mr: empty,
      notes,
      rows: roundTrip(filled({ 'tabs.today': 'आज', 'today.startVisit': '{doctor} से मिलें' })),
    });
    expect(result.errors).toEqual([]);
    expect(result.hi).toEqual({
      'tabs.today': 'आज',
      'today.startVisit': '{doctor} से मिलें',
      'today.note': '',
    });
    expect(Object.keys(result.hi)).toEqual(Object.keys(en));
    expect(result.changed).toBe(2);
  });

  it('refuses a dropped or renamed placeholder', () => {
    const result = importRows({
      en,
      hi: empty,
      mr: empty,
      notes,
      rows: filled({ 'today.startVisit': '{name} से मिलें' }),
    });
    expect(result.errors.join('\n')).toMatch(
      /must keep the placeholders \{doctor\} exactly — it has \{name\}/u,
    );
    expect(result.hi).toBe(empty);
  });

  it('refuses a key the app does not have, and a key given twice', () => {
    const rows = filled({});
    const result = importRows({
      en,
      hi: empty,
      mr: empty,
      notes,
      rows: [...rows, ['tabs.nope', 'x', '', '', 'y', ''], rows[1] ?? []],
    });
    expect(result.errors.join('\n')).toMatch(/"tabs\.nope" is not a key in the app/u);
    expect(result.errors.join('\n')).toMatch(/"tabs\.today" appears more than once/u);
  });

  it('refuses a file whose English is not today’s — a translation of words the app no longer shows', () => {
    const rows = filled({ 'tabs.today': 'आज' });
    rows[1] = ['tabs.today', 'Today!', '', '', 'आज', ''];
    const result = importRows({ en, hi: empty, mr: empty, notes, rows });
    expect(result.errors.join('\n')).toMatch(/is not what the app shows now/u);
  });

  it('refuses a translation over the layout’s limit, counted as a reader sees it', () => {
    const result = importRows({
      en,
      hi: empty,
      mr: empty,
      notes,
      rows: filled({ 'tabs.today': 'आज का दिन है' }),
    });
    expect(result.errors.join('\n')).toMatch(/the layout allows 6/u);
    // A conjunct is several code points and one shape: क्षि is 4 code points, 1 grapheme.
    expect(visibleLength('क्षि')).toBe(1);
  });

  it('refuses a wrong header outright', () => {
    const result = importRows({ en, hi: empty, mr: empty, notes, rows: [['key', 'hindi']] });
    expect(result.errors[0]).toMatch(/first row must be exactly/u);
  });

  it('leaves keys the file has no row for as they were, and says how many', () => {
    const rows = filled({ 'tabs.today': 'आज' }).slice(0, 2);
    const result = importRows({
      en,
      hi: { ...empty, 'today.note': 'पहले से' },
      mr: empty,
      notes,
      rows,
    });
    expect(result.errors).toEqual([]);
    expect(result.missing).toEqual(['today.startVisit', 'today.note']);
    expect(result.hi['today.note']).toBe('पहले से');
  });
});
