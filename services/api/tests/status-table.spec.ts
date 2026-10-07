import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkStatusTable, lastStatusTable } from '../scripts/check-status-table.mjs';
import type { MustHaves } from '../scripts/check-status-table.mjs';

/**
 * W2-F C3 (`BE-C75`) — the status table cannot lose a must-have silently. Synthetic logs, so each rule
 * is shown failing on its own; the real log is checked by the CI step of the same name.
 */
const mustHaves = JSON.parse(
  readFileSync(new URL('../../../docs/operator/must-haves.json', import.meta.url), 'utf8'),
) as MustHaves;

const header = '| MODULE | STATUS | OWNER | BLOCKER | ETA |\n| --- | --- | --- | --- | --- |';
const row = (module: string, status = 'BLOCKED', owner = 'Operator', blocker = 'Q-1') =>
  `| ${module} | ${status} | ${owner} | ${blocker} | — |`;
const allRows = (): string[] => mustHaves.items.map(({ key, item }) => row(`${item} [${key}]`));
const log = (rows: string[], heading = '#### E — status') =>
  `### W9 — earlier\n\n#### Status\n\n${header}\n${row('Old [OP-1]')}\n\n### W10 — now\n\n${heading}\n\n${header}\n${rows.join('\n')}\n\nAfter the table.\n`;

describe('W2-F C3 — every operator must-have has a row, by construction', () => {
  it('the list is the operator’s fourteen, keyed OP-1 … OP-14', () => {
    expect(mustHaves.items.map((i) => i.key)).toEqual(
      Array.from({ length: 14 }, (_, i) => `OP-${String(i + 1)}`),
    );
    expect(mustHaves.items.find((i) => i.key === 'OP-6')?.item).toBe('LMS');
  });

  it('POSITIVE: a table citing every item, in the format, passes', () => {
    expect(checkStatusTable(log(allRows()), mustHaves)).toEqual([]);
  });

  it('a missing item fails, naming it — the LMS case', () => {
    const rows = allRows().filter((r) => !r.includes('[OP-6]'));
    expect(checkStatusTable(log(rows), mustHaves)).toEqual([
      'OP-6 "LMS" has no row (cite [OP-6] in the MODULE cell of at least one row)',
    ]);
  });

  it('only the LAST status table counts — an older complete one does not cover for a newer one', () => {
    const earlierComplete = `#### Status\n\n${header}\n${allRows().join('\n')}\n\n### W10\n\n`;
    const text = earlierComplete + log(allRows().slice(1));
    expect(checkStatusTable(text, mustHaves)).toEqual([
      'OP-1 "Core MR workflow" has no row (cite [OP-1] in the MODULE cell of at least one row)',
    ]);
  });

  it('a DONE row carrying a blocker fails', () => {
    const rows = [...allRows(), row('Something [OP-1]', 'DONE', 'Maanav', 'waits on Q-1')];
    expect(checkStatusTable(log(rows), mustHaves)).toEqual([
      '"Something [OP-1]": a DONE row may not carry a blocker ("waits on Q-1")',
    ]);
  });

  it('a status outside the operator’s four fails', () => {
    const rows = [...allRows(), row('Something [OP-1]', 'NOT STARTED')];
    expect(checkStatusTable(log(rows), mustHaves)).toEqual([
      '"Something [OP-1]": status "NOT STARTED" is not one of DONE, IN PROGRESS, BLOCKED, POST-4-OCT',
    ]);
  });

  it('a row naming Dev fails', () => {
    const rows = [...allRows(), row('Something [OP-1]', 'BLOCKED', 'Dev')];
    expect(checkStatusTable(log(rows), mustHaves)).toEqual([
      '"Something [OP-1]": names Dev (owner "Dev")',
    ]);
  });

  it('no table at all fails, rather than passing on nothing', () => {
    expect(checkStatusTable('### W1\n\nNo table here.\n', mustHaves)).toEqual([
      'no status table found in the log',
    ]);
  });

  it('the parser reads the table under the heading, and stops where the table does', () => {
    const rows = lastStatusTable(log([row('Only [OP-1]')]));
    expect(rows).toEqual([['Only [OP-1]', 'BLOCKED', 'Operator', 'Q-1', '—']]);
  });
});
