import { describe, expect, it } from 'vitest';
import {
  asSpan,
  coverageLines,
  coverageRefusal,
  periodLabel,
  periodOf,
  periodPhrase,
  weekOf,
} from './coverage-text';
import type { CoverageRow } from './manager-rows';

const row = (mrId: string, day: string, planned: number, completed: number, notSeen: number) =>
  ({
    mrId,
    day,
    planned,
    completed,
    notSeen,
    zone: 'Asia/Kolkata',
    zoneSource: 'territory',
  }) satisfies CoverageRow;

describe('FE-W203 — the period chosen', () => {
  it('takes a week as Monday to Sunday, across a month end', () => {
    // 15 Oct 2026 is a Thursday.
    expect(weekOf('2026-10-15')).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(weekOf('2026-10-12')).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(weekOf('2026-10-18')).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(weekOf('2026-11-01')).toEqual({ from: '2026-10-26', to: '2026-11-01' });
  });

  it('reads the span, and names the period as people say dates', () => {
    expect(asSpan('week')).toBe('week');
    expect(asSpan('month')).toBe('day');
    expect(asSpan(undefined)).toBe('day');
    expect(periodOf('2026-10-15', 'day')).toEqual({ from: '2026-10-15', to: '2026-10-15' });
    expect(periodLabel(periodOf('2026-10-15', 'day'))).toBe('15 Oct 2026');
    expect(periodLabel(periodOf('2026-10-15', 'week'))).toBe('12 Oct 2026 to 18 Oct 2026');
    expect(periodPhrase(periodOf('2026-10-15', 'day'))).toBe('On 15 Oct 2026');
    expect(periodPhrase(periodOf('2026-10-15', 'week'))).toBe('From 12 Oct 2026 to 18 Oct 2026');
  });
});

describe('FE-W203 — per rep, by name, added up, never ranked', () => {
  const reps = new Map([
    ['b', { name: 'Bina Shah', active: true }],
    ['a', { name: 'Arun Iyer', active: true }],
    ['gone', { name: 'Old Rep', active: false }],
    ['gone-busy', { name: 'Left Last Week', active: false }],
  ]);

  it('adds the days up and lists reps by name, whatever their figures', () => {
    const lines = coverageLines(
      [
        row('b', '2026-10-12', 5, 5, 0),
        row('b', '2026-10-13', 4, 4, 0),
        row('a', '2026-10-12', 3, 1, 2),
        row('a', '2026-10-13', 0, 0, 0),
      ],
      reps,
    );
    expect(lines.map((l) => [l.name, l.planned, l.completed, l.notSeen])).toEqual([
      ['Arun Iyer', 3, 1, 2],
      ['Bina Shah', 9, 9, 0],
    ]);
  });

  it('leaves out a rep who has left and had nothing in the period, and keeps one who had', () => {
    const lines = coverageLines(
      [row('gone', '2026-10-12', 0, 0, 0), row('gone-busy', '2026-10-12', 2, 1, 1)],
      reps,
    );
    expect(lines.map((l) => l.name)).toEqual(['Left Last Week']);
  });

  it('marks a rep whose days are counted on UTC dates', () => {
    const [line] = coverageLines(
      [{ ...row('a', '2026-10-12', 1, 1, 0), zoneSource: 'fallback_utc' }],
      reps,
    );
    expect(line?.utcDays).toBe(true);
  });

  it('says why coverage could not be read', () => {
    expect(coverageRefusal({ message: 'boom' })).toMatch(/could not be read.*boom/u);
  });
});
