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
    // MR-39 A1. **The numbers the `Tests:` line cannot see.**
    //
    // A suite that fails to COLLECT contributes zero cases and zero failures, so every
    // test-level number stays clean while the suite silently does not exist. MR-38 hit
    // exactly this: `Tests: 237 passed, 237 total` with `Test Suites: 2 failed`, and the
    // only evidence was the total being 6 lower than usual -- which nothing was comparing.
    //
    // Both runners emit these; `numRuntimeErrorTestSuites` is jest-only and is read
    // defensively rather than assumed, because vitest omits it entirely.
    totalSuites: report.numTotalTestSuites ?? 0,
    failedSuites: report.numFailedTestSuites ?? 0,
    errorSuites: report.numRuntimeErrorTestSuites ?? 0,
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

    // **MR-39 A1. A SUITE THAT NEVER RAN, WHICH NO TEST-LEVEL NUMBER CAN SEE.**
    //
    // Checked before `failed`, because this is the one that looks green: the cases inside
    // a suite that did not collect are not counted anywhere, so `tests`, `passed` and
    // `failed` are all consistent with each other and all wrong together.
    if (result.failedSuites > 0 || result.errorSuites > 0) {
      gaps.push(
        `${manifest.name} / ${runner}: ${String(result.failedSuites)} suite(s) FAILED and ` +
          `${String(result.errorSuites)} errored out of ${String(result.totalSuites)} -- the ` +
          `case counts are from the suites that DID run and cannot be trusted`,
      );
    }

    // And a plain failing test, which the old version captured into `result.failed` and
    // then never looked at. A reporter that prints a failure count it does not act on is
    // a reporter that reports failures as green.
    if (result.failed > 0) {
      gaps.push(`${manifest.name} / ${runner} reported ${String(result.failed)} FAILING case(s)`);
    }
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ rows, gaps }, null, 2));
} else {
  const w = (s, n) => String(s).padEnd(n);
  // MR-39 A1. `passed` and a SUITE column, both deliberately.
  //
  // The old table printed DISCOVERED cases and no suite column at all, which is why the
  // record has said for six sessions to read the runners rather than this script. A
  // discovered count and a passed count are the same number right up until they are not,
  // and the suite column is the only one that can see a suite that never ran.
  console.log(
    `\n${w('workspace', 24)}${w('runner', 9)}${w('passed', 8)}${w('failed', 8)}${w('suites', 10)}${w('files', 7)}`,
  );
  console.log('-'.repeat(66));
  for (const r of rows) {
    // Only the BAD count. `numTotalTestSuites` is not comparable across runners -- vitest
    // counts `describe` blocks there and jest counts files, as the comment on `files`
    // above records -- so printing it side by side would be a column whose meaning
    // changes per row. The bad count means the same thing in both.
    // MAX, not sum. Jest counts a suite that threw during collection in BOTH
    // `numFailedTestSuites` and `numRuntimeErrorTestSuites`, so adding them reports one
    // bad suite as two -- measured against the MR-39 A2 control, which produced
    // "1 failed, 1 errored" for a single file.
    const bad = Math.max(r.failedSuites ?? 0, r.errorSuites ?? 0);
    const suites = r.totalSuites === undefined ? '-' : bad === 0 ? 'ok' : `${String(bad)} BAD`;
    console.log(
      `${w(r.workspace, 24)}${w(r.runner, 9)}${w(r.passed ?? 0, 8)}${w(r.failed ?? 0, 8)}${w(suites, 10)}${w(r.files ?? 0, 7)}`,
    );
  }
  const total = rows.reduce((n, r) => n + (r.passed ?? 0), 0);
  console.log('-'.repeat(66));
  console.log(`${w('TOTAL PASSING', 33)}${w(total, 8)}\n`);
}

if (gaps.length > 0) {
  console.error('TEST COUNT REPORT FAILED:\n' + gaps.map((g) => `  - ${g}`).join('\n'));
  process.exit(1);
}
