#!/usr/bin/env node
/**
 * W1-Q C2 — every `BE-`/`FE-` id is minted once, by its own track, and never reused.
 *
 * ## Why this is a check and not a paragraph
 *
 * The id rule has been written down three times, and the collision happened three times:
 *
 *   1. 28 Sep — two sessions both minted `C20` (`BE-W118`). Fixed by per-track prefixes (`BE-C3`).
 *   2. 29 Sep — the frontend filed a voice note as `CR-5`, already the practice API. Fixed by
 *      extending the prefixes to contract requests (`BE-C4`) — which itself named the voice note
 *      `FE-CR-1`, an id in the OTHER track's space.
 *   3. 1 Oct — the frontend renamed CR-1..CR-4 to `FE-CR-1`..`FE-CR-4` (FE-D13), so `FE-CR-1` named
 *      two things.
 *
 * Each fix was a convention in `CLAUDE.md`. A rule nobody can enforce is the inert control this
 * repository keeps finding, so this script is the rule.
 *
 * ## What it enforces, against `docs/ids.md`
 *
 *   1. **Once.** Every id has exactly one row.
 *   2. **Never reused.** Every row in the BASE's ledger is still present and unchanged. Renumbering
 *      or re-meaning an id means editing a row, so it fails here.
 *   3. **Registered before cited.** Every id cited in a tracked file has a row — so minting is an act
 *      (adding a row), and taking a number that exists fails rule 1.
 *   4. **Own space.** A row's "minted by" track matches its prefix (`BE-` backend, `FE-` frontend).
 *
 * What it cannot catch: citing an EXISTING id to mean something new without touching the ledger.
 *
 * Usage: `node scripts/check-ids.mjs [base-ref]` — base defaults to `origin/main`. When the base has
 * no ledger, rule 2 has nothing to compare and the script SAYS so rather than passing quietly.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const LEDGER = 'docs/ids.md';
const ID = /(BE|FE)-(CR-[0-9]+|C[0-9]+|W[0-9]+|D[0-9]+)/u;
const base = process.argv[2] ?? 'origin/main';

const git = (args) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });

/** Ledger rows as `id -> full row text`, plus every id seen (duplicates included). */
const parse = (text) => {
  const rows = new Map();
  const seen = [];
  for (const line of text.split('\n')) {
    const m = /^\| `([^`]+)` \| (backend|frontend) \|/u.exec(line);
    if (!m) continue;
    seen.push(m[1]);
    rows.set(m[1], { line: line.trimEnd(), track: m[2] });
  }
  return { rows, seen };
};

const failures = [];
const { rows, seen } = parse(readFileSync(LEDGER, 'utf8'));

// 1. Once.
const counts = new Map();
for (const id of seen) counts.set(id, (counts.get(id) ?? 0) + 1);
for (const [id, n] of counts) if (n > 1) failures.push(`rule 1: ${id} has ${String(n)} rows`);

// 2. Never reused.
let baseText = null;
try {
  baseText = git(['show', `${base}:${LEDGER}`]);
} catch {
  console.log(`rule 2: ${base} has no ${LEDGER} yet, so there is nothing to compare against.`);
}
if (baseText !== null) {
  const was = parse(baseText).rows;
  for (const [id, row] of was) {
    const now = rows.get(id);
    if (now === undefined)
      failures.push(`rule 2: ${id} was in ${base}'s ledger and has been removed`);
    else if (now.line !== row.line)
      failures.push(`rule 2: ${id} was changed\n    was: ${row.line}\n    now: ${now.line}`);
  }
  console.log(`rule 2: compared ${String(was.size)} rows against ${base}.`);
}

// 3. Registered before cited.
const cited = git(['grep', '-nowE', ID.source, '--', '.', `:!${LEDGER}`]);
const unregistered = new Map();
for (const line of cited.split('\n')) {
  const m = /^(.+?):(\d+):(.+)$/u.exec(line);
  if (!m || rows.has(m[3])) continue;
  if (!unregistered.has(m[3])) unregistered.set(m[3], `${m[1]}:${m[2]}`);
}
for (const [id, where] of unregistered)
  failures.push(`rule 3: ${id} is cited at ${where} and has no row`);

// 4. Own space.
for (const [id, row] of rows) {
  const want = id.startsWith('BE-') ? 'backend' : 'frontend';
  if (row.track !== want)
    failures.push(`rule 4: ${id} is minted by ${row.track}; its prefix belongs to ${want}`);
}

console.log(
  `${String(rows.size)} ids in ${LEDGER}; ${String(cited.split('\n').filter(Boolean).length)} citations read.`,
);
if (failures.length > 0) {
  for (const f of failures) console.error(`::error file=${LEDGER}::${f}`);
  console.error(`${String(failures.length)} id rule violation(s).`);
  process.exit(1);
}
console.log('Every id is registered once, by its own track, and none was reused.');
