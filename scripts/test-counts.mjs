#!/usr/bin/env node
/**
 * Counts test cases per workspace AND per runner, and FAILS if a configured runner
 * reports nothing.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 *
 * Every session of this project reports "counts split by workspace and runner", and until
 * MR-08 that meant a human reading scrolled-back output and matching summary lines by eye.
 * MR-06 reported `@fieldforce/ui` as **4 tests**. It has two runners — `vitest run && jest`
 * — and the jest half is **221 cases in 20 suites**. They ran. They were invisible,
 * because vitest prints
 *
 *     Test Files  1 passed (1)
 *           Tests  4 passed (4)
 *
 * and jest prints
 *
 *     Test Suites: 20 passed, 20 total
 *     Tests:       221 passed, 221 total
 *
 * and the pattern being read matched only the first. The number was wrong in the record
 * for two sessions and nothing could have caught it, because **a workspace that
 * contributes zero looks exactly like a workspace that has no tests.**
 *
 * That is the same shape as a guard with no positive control, which this repository has
 * now met twelve times: the absence of a signal was read as the absence of a problem.
 * So the rule here is the positive control, made structural —
 *
 *     **a runner that is configured must report a non-zero count, or this exits 1.**
 *
 * ---------------------------------------------------------------------------
 * HOW IT DECIDES WHAT SHOULD RUN
 * ---------------------------------------------------------------------------
 *
 * From the workspace's own `package.json`, never from a list kept here. A list of
 * workspaces maintained in this file is a list that will be left off one, which is the
 * defect it is trying to prevent, one level up. `test: "vitest run && jest"` declares two
 * runners; `test: "vitest run"` declares one; no `test` script declares none and the
 * workspace is reported as having no runner rather than skipped silently.
 *
 * Usage:
 *   node scripts/test-counts.mjs           # run everything, print the table, exit 1 on a gap
 *   node scripts/test-counts.mjs --json    # the same as machine-readable JSON
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** Every workspace directory, derived from pnpm-workspace.yaml's three globs. */
const workspaceDirs = () => {
  const dirs = [];
  for (const group of ['packages', 'apps', 'services']) {
    const base = join(ROOT, group);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      const pkg = join(base, name, 'package.json');
      if (existsSync(pkg)) dirs.push({ dir: join(base, name), pkg });
    }
  }
  return dirs;
};

/**
 * Which runners a workspace declares, read from its own `test` script.
 *
 * Deliberately literal: it looks for the two runner names this repo actually uses rather
 * than trying to parse a shell command in general. A third runner would appear here as a
 * missing entry rather than as a silent zero, which is the failure mode being closed.
 */
const runnersOf = (testScript) => {
  if (typeof testScript !== 'string') return [];
  const runners = [];
  if (/\bvitest\b/.test(testScript)) runners.push('vitest');
  if (/\bjest\b/.test(testScript)) runners.push('jest');
  return runners;
};

/**
 * The runners' JS entry points, invoked with this process's own `node`.
 *
 * Not `npx`, and not `node_modules/.bin/*`. On Windows those are `.cmd` shims, and Node
 * refuses to `execFileSync` a `.cmd` without `shell: true` (EINVAL) -- while `shell: true`
 * concatenates arguments rather than escaping them. Pointing at the real entry avoids
 * both, and behaves the same on every platform.
 */
const RUNNER_COMMANDS = {
  vitest: [
    join(ROOT, 'node_modules', 'vitest', 'vitest.mjs'),
    ['run', '--reporter=json', '--silent'],
  ],
  jest: [join(ROOT, 'node_modules', 'jest', 'bin', 'jest.js'), ['--json', '--silent']],
};

/** Runs one runner in one workspace and returns { tests, files } or throws. */
const countFor = (dir, runner) => {
  const [entry, args] = RUNNER_COMMANDS[runner];
  if (!existsSync(entry)) {
    throw new Error(`${runner}'s entry point is missing at ${entry}`);
  }
  let stdout;
  try {
    stdout = execFileSync(process.execPath, [entry, ...args], {
      cwd: dir,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    // A failing suite still writes its JSON report to stdout; a runner that could not
    // start writes nothing, and those are different problems.
    stdout = error.stdout ?? '';
    if (stdout.trim() === '') {
      throw new Error(
        `${runner} in ${dir} produced no report at all:\n${String(error.stderr ?? error.message).slice(0, 800)}`,
      );
    }
  }

  // Both runners print a JSON object; vitest may precede it with warnings.
  const start = stdout.indexOf('{');
  if (start === -1) throw new Error(`${runner} in ${dir} printed no JSON report`);
  const report = JSON.parse(stdout.slice(start));

  return {
    tests: report.numTotalTests ?? 0,
    passed: report.numPassedTests ?? 0,
    failed: report.numFailedTests ?? 0,
    skipped: (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0),
    // `testResults` is one entry per FILE in both runners. `numTotalTestSuites` is not
    // comparable across them -- vitest counts `describe` blocks there and jest counts
    // files -- so reading it would have reported api as 139 "files" against 26 real ones.
    // A column whose meaning changes per row is the same defect this script was written
    // to close, one column over.
    files: Array.isArray(report.testResults) ? report.testResults.length : 0,
  };
};

const rows = [];
const gaps = [];

for (const { dir, pkg } of workspaceDirs()) {
  const manifest = JSON.parse(readFileSync(pkg, 'utf8'));
  const runners = runnersOf(manifest.scripts?.test);

  if (runners.length === 0) {
    rows.push({ workspace: manifest.name, runner: '(none configured)', tests: 0, files: 0 });
    continue;
  }

  for (const runner of runners) {
    let result;
    try {
      result = countFor(dir, runner);
    } catch (error) {
      gaps.push(`${manifest.name} / ${runner}: ${error.message}`);
      continue;
    }
    rows.push({ workspace: manifest.name, runner, ...result });

    // **The guard.** A configured runner that reports nothing is the failure this script
    // exists for: it is indistinguishable, in a scrolled-back log, from a workspace that
    // has no tests.
    if (result.tests === 0) {
      gaps.push(
        `${manifest.name} / ${runner} is configured in package.json and reported ZERO cases`,
      );
    }
    if (result.skipped > 0) {
      // A skipped suite is not a green one — this repo's own standing rule.
      gaps.push(`${manifest.name} / ${runner} reported ${result.skipped} SKIPPED case(s)`);
    }
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ rows, gaps }, null, 2));
} else {
  const w = (s, n) => String(s).padEnd(n);
  console.log(`\n${w('workspace', 26)}${w('runner', 20)}${w('tests', 8)}${w('files', 8)}`);
  console.log('-'.repeat(62));
  for (const r of rows) {
    console.log(`${w(r.workspace, 26)}${w(r.runner, 20)}${w(r.tests, 8)}${w(r.files, 8)}`);
  }
  const total = rows.reduce((n, r) => n + r.tests, 0);
  console.log('-'.repeat(62));
  console.log(`${w('TOTAL', 46)}${w(total, 8)}\n`);
}

if (gaps.length > 0) {
  console.error('TEST COUNT REPORT FAILED:\n' + gaps.map((g) => `  - ${g}`).join('\n'));
  process.exit(1);
}
