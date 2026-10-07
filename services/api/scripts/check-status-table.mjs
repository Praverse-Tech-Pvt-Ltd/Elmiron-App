#!/usr/bin/env node
/**
 * W2-F C3 (`BE-C75`) — the status table is complete BY CONSTRUCTION, not by memory.
 *
 * **The failure this exists for.** The table in `docs/log/backend.md` is built from measurement, and
 * the failure mode of that is exact: you measure what you touched, so a module nobody is working on
 * stops being visible. LMS had a row on 6 October and none by 7 October; so had Day End, Mileage,
 * Real backend and the four "should not destabilise" items — nine of the operator's fourteen were in
 * none of the W2-C, W2-D and W2-E tables, and nobody noticed.
 *
 * **What it checks, on the LAST status table in the log** (the last `#### ` heading whose text
 * contains "status", and the first markdown table under it):
 *
 *   1. every item in `docs/operator/must-haves.json` is cited by at least one row, as `[OP-n]` in the
 *      MODULE cell — an item with nothing started still needs a row that says so;
 *   2. every STATUS is one of the operator's four (item 17);
 *   3. a DONE row's BLOCKER is `—`;
 *   4. no cell names Dev, who has left the project.
 *
 * Pure (`checkStatusTable`), so each failure is provable on a modified copy without touching the log.
 */
import { readFileSync } from 'node:fs';

/** The rows of the last status table, as cells, or null when there is none. */
export const lastStatusTable = (log) => {
  const lines = log.split(/\r?\n/);
  let start = -1;
  lines.forEach((line, i) => {
    if (/^#### /.test(line) && /status/i.test(line)) start = i;
  });
  if (start === -1) return null;
  const rows = [];
  let seenTable = false;
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,4} /.test(line)) break;
    if (/^\|/.test(line)) {
      seenTable = true;
      rows.push(
        line
          .replace(/^\|/, '')
          .replace(/\|\s*$/, '')
          .split('|')
          .map((cell) => cell.trim()),
      );
    } else if (seenTable) {
      break;
    }
  }
  // Drop the header and the `---` separator.
  return rows.filter((cells) => !/^-+$/.test(cells[0] ?? '') && cells[0] !== 'MODULE');
};

export const checkStatusTable = (log, mustHaves) => {
  const rows = lastStatusTable(log);
  if (rows === null || rows.length === 0) return ['no status table found in the log'];
  const failures = [];
  for (const { key, item } of mustHaves.items) {
    const tag = `[${key}]`;
    if (!rows.some((cells) => (cells[0] ?? '').includes(tag))) {
      failures.push(
        `${key} "${item}" has no row (cite ${tag} in the MODULE cell of at least one row)`,
      );
    }
  }
  for (const cells of rows) {
    const [module = '', status = '', owner = '', blocker = ''] = cells;
    if (!mustHaves.statuses.includes(status)) {
      failures.push(
        `"${module}": status "${status}" is not one of ${mustHaves.statuses.join(', ')}`,
      );
    }
    if (status === 'DONE' && blocker !== '—') {
      failures.push(`"${module}": a DONE row may not carry a blocker ("${blocker}")`);
    }
    if (cells.some((cell) => /\bDev\b/.test(cell))) {
      failures.push(`"${module}": names Dev (owner "${owner}")`);
    }
  }
  return failures;
};

/**
 * W2-G C (`BE-C76`) — the plan documents people re-planned against are RETIRED, and stay so. Each file
 * in `mustHaves.retiredPlans` must begin with the retirement banner that names the single list; a file
 * that loses it, or is missing, fails. So a second list cannot quietly come back as "the plan".
 */
export const checkRetiredPlans = (files, mustHaves) =>
  (mustHaves.retiredPlans ?? []).flatMap((path) => {
    const file = files.find((f) => f.path === path);
    if (file === undefined) return [`${path}: listed as a retired plan but not found`];
    const head = file.text.split(/\r?\n/).slice(0, 5).join('\n');
    return /^> \*\*RETIRED/.test(head) && head.includes('docs/operator/must-haves.json')
      ? []
      : [
          `${path}: a retired plan must begin with the RETIRED banner naming docs/operator/must-haves.json`,
        ];
  });

const repoFile = (rel) =>
  new URL(`../../../${rel}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// CLI entry. Importing this module does not run anything.
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
) {
  const log = readFileSync(repoFile('docs/log/backend.md'), 'utf8');
  const mustHaves = JSON.parse(readFileSync(repoFile('docs/operator/must-haves.json'), 'utf8'));
  const retired = (mustHaves.retiredPlans ?? []).flatMap((path) => {
    try {
      return [{ path, text: readFileSync(repoFile(path), 'utf8') }];
    } catch {
      return [];
    }
  });
  const failures = [...checkStatusTable(log, mustHaves), ...checkRetiredPlans(retired, mustHaves)];
  if (failures.length === 0) {
    console.log(
      `The last status table has a row for every one of the operator's ${String(mustHaves.items.length)} items, and keeps the format's rules; ${String(retired.length)} retired plan documents still say so.`,
    );
  } else {
    for (const f of failures) console.log(`::error title=Status table incomplete::${f}`);
    process.exit(1);
  }
}
