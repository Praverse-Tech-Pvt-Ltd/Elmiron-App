import type { CoverageRow } from './manager-rows';
import { dayLabel } from './india-date';

/**
 * `FE-W203` — visit coverage: what was planned and what was done, per rep, for a day or a week.
 *
 * **Plain numbers, in the order of the reps' names.** No percentage, no colour for good or bad, and
 * no sorting by any figure: a coverage table sorted by "visits done" is a league table, which this
 * product does not have. The figures are `coverage()`'s, added up over the days chosen; nothing is
 * derived beyond that sum.
 *
 * Pure date arithmetic on `YYYY-MM-DD` strings — no clock is read here — so it is tested as is.
 */
export interface Refusal {
  readonly code?: string | null;
  readonly message: string;
}

export type Span = 'day' | 'week';

export const asSpan = (value: string | undefined): Span => (value === 'week' ? 'week' : 'day');

export interface Period {
  readonly from: string;
  readonly to: string;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/u;

const shift = (day: string, by: number): string => {
  const m = DAY.exec(day);
  if (m === null) return day;
  const at = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + by));
  return at.toISOString().slice(0, 10);
};

/** The Monday-to-Sunday week that holds `day`. */
export const weekOf = (day: string): Period => {
  const m = DAY.exec(day);
  if (m === null) return { from: day, to: day };
  const weekday = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  const monday = shift(day, -((weekday + 6) % 7));
  return { from: monday, to: shift(monday, 6) };
};

export const periodOf = (day: string, span: Span): Period =>
  span === 'week' ? weekOf(day) : { from: day, to: day };

/** The period opening a sentence: "On 14 Oct 2026", or "From 12 Oct 2026 to 18 Oct 2026". */
export const periodPhrase = ({ from, to }: Period): string =>
  from === to ? `On ${dayLabel(from)}` : `From ${dayLabel(from)} to ${dayLabel(to)}`;

/** "14 Oct 2026", or "12 Oct 2026 to 18 Oct 2026". */
export const periodLabel = ({ from, to }: Period): string =>
  from === to ? dayLabel(from) : `${dayLabel(from)} to ${dayLabel(to)}`;

export interface RepFacts {
  readonly name: string;
  readonly active: boolean;
}

export interface CoverageLine {
  readonly mrId: string;
  readonly name: string;
  readonly planned: number;
  readonly completed: number;
  readonly notSeen: number;
  /** The rep's territory has no working hours, so their days are counted on the UTC date. */
  readonly utcDays: boolean;
}

/**
 * One line per rep, the period's days added up, **sorted by name**. A rep who is no longer active
 * and had nothing planned or done in the period is left out; one with anything in it stays.
 */
export const coverageLines = (
  rows: readonly CoverageRow[],
  reps: ReadonlyMap<string, RepFacts>,
): readonly CoverageLine[] => {
  const totals = new Map<string, CoverageLine>();
  for (const row of rows) {
    const was = totals.get(row.mrId);
    totals.set(row.mrId, {
      mrId: row.mrId,
      name: reps.get(row.mrId)?.name ?? 'Unknown rep',
      planned: (was?.planned ?? 0) + row.planned,
      completed: (was?.completed ?? 0) + row.completed,
      notSeen: (was?.notSeen ?? 0) + row.notSeen,
      utcDays: (was?.utcDays ?? false) || row.zoneSource === 'fallback_utc',
    });
  }
  return [...totals.values()]
    .filter(
      (line) => reps.get(line.mrId)?.active !== false || line.planned > 0 || line.completed > 0,
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'en') || a.mrId.localeCompare(b.mrId));
};

export const coverageRefusal = ({ code, message }: Refusal): string =>
  code === '28000' || /not authenticated/u.test(message)
    ? 'Your session has ended. Sign in again to see visit coverage.'
    : `Visit coverage could not be read. The server said: ${message}`;
