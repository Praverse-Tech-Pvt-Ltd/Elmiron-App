#!/usr/bin/env node
/**
 * MR-14 A2 — one local command that runs exactly what CI runs, DERIVED from `ci.yml`.
 *
 * **The failure this exists to stop.** The MR-13 handover took five CI runs, each a
 * different cause, and one of them was `pnpm run lint` — a step that had never been run
 * locally while typecheck, tests and prettier were green throughout. There was no single
 * local command covering CI's list, so "everything passes" meant "the four things I
 * happened to run pass".
 *
 * **Why it parses `ci.yml` instead of listing the steps.** A hand-maintained parallel list
 * has already failed three times in this repository: `@fieldforce/console` had ten passing
 * cases and no CI line for several sessions, `ui-tokens` was "decorative in CI from the day
 * it was written" because its step did not exist, and `@fieldforce/ui`'s 221 jest cases were
 * read as 4. `ci.yml`'s own comments name the rule and then apply it by hand. A second
 * hand-kept list here would drift the same way, in the same direction, silently — and the
 * drift would make this command claim MORE coverage than it has, which is worse than having
 * no command at all.
 *
 * So the steps below are whatever `ci.yml` says today. Edit the workflow and this follows.
 *
 * **Read as text, not as parsed YAML.** `services/api/tests/ci-covers-every-suite.spec.ts`
 * already derives from `ci.yml` by reading it as a string, and no workspace declares a YAML
 * dependency — `yaml` and `js-yaml` exist in `node_modules` only transitively, so importing
 * one would be depending on another package's dependency under `node-linker=hoisted`. The
 * reader below is narrow on purpose: it understands the two step shapes this workflow uses
 * and asserts loudly when it stops recognising the file.
 *
 * Usage:
 *   node scripts/ci-local.mjs              # the `static` job — needs no database
 *   node scripts/ci-local.mjs --with-db    # also the `database` job — needs Docker + Supabase
 *   node scripts/ci-local.mjs --list       # print the derived step list and exit
 */

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = join(ROOT, '.github', 'workflows', 'ci.yml');

/**
 * GitHub-context expressions, supplied locally.
 *
 * **This is the one place a local value is invented, and it is deliberately the CONTEXT
 * rather than the step.** The append-only guard's body is executed exactly as `ci.yml`
 * writes it — the `git diff`, the line count, the failure message — so editing the guard in
 * the workflow changes what runs here. Only the two variables that describe the GitHub
 * event are filled in, because a local checkout has no event.
 *
 * `github.event.before` on a push is "the branch before this push". Locally the honest
 * equivalent is the merge-base with the remote: everything not yet pushed. That is the
 * comparison a developer wants before pushing, and it is what makes this guard able to
 * catch a deletion from PROJECT-OVERVIEW.md before CI does.
 */
const GITHUB_CONTEXT = {
  'github.event_name': 'push',
  'github.base_ref': 'main',
  'github.event.before': '$(git merge-base origin/main HEAD)',
};

const substituteContext = (body) =>
  body.replace(/\$\{\{\s*([^}\s]+)\s*\}\}/g, (match, expression) => {
    const value = GITHUB_CONTEXT[expression];
    if (value === undefined) {
      throw new Error(
        'ci-local does not know how to supply the GitHub expression ' +
          expression +
          '. Add it to GITHUB_CONTEXT in scripts/ci-local.mjs with a comment saying why ' +
          'that local value is the honest equivalent — do not guess.',
      );
    }
    return value;
  });

/** The lines of one top-level job, from `  <name>:` to the next key at that indent. */
const jobLines = (workflow, job) => {
  const lines = workflow.split(/\r?\n/);
  const start = lines.indexOf('  ' + job + ':');
  if (start === -1) {
    throw new Error('no job "' + job + '" in ci.yml — has the workflow been renamed?');
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}\S/.test(line));
  return end === -1 ? rest : rest.slice(0, end);
};

/**
 * Every step of a job, in order.
 *
 * Handles the two shapes this workflow uses: `- run: <command>` on one line, and
 * `- run: |` followed by an indented block. A step's `env:` map is collected too, because
 * the `database` job carries `SUPABASE_DB_URL` and friends per step and a step run without
 * them would fail for the wrong reason.
 */
const parseSteps = (lines) => {
  const steps = [];
  let current = null;
  let block = null;
  let inEnv = false;

  const flush = () => {
    if (current !== null) steps.push(current);
    current = null;
    block = null;
    inEnv = false;
  };

  for (const line of lines) {
    // Inside a `run: |` block: everything indented deeper than the block's anchor.
    if (block !== null) {
      if (line.trim() === '' || line.startsWith(block.indent)) {
        block.body.push(line.slice(block.indent.length));
        continue;
      }
      current.run = block.body.join('\n').replace(/\n+$/, '');
      block = null;
    }

    // Inside an `env:` map, whose entries sit deeper than the `env:` key itself.
    if (inEnv) {
      const entry = /^ {10,}([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
      if (entry !== null) {
        current.env[entry[1]] = entry[2].replace(/^['"]|['"]$/g, '');
        continue;
      }
      inEnv = false;
    }

    const item = /^ {6}- (.*)$/.exec(line);
    if (item !== null) {
      flush();
      current = { name: null, uses: null, run: null, env: {} };
      const key = /^(name|uses|run|if):\s*(.*)$/.exec(item[1]);
      if (key !== null) {
        if (key[1] === 'run' && key[2] === '|') block = { indent: ' '.repeat(10), body: [] };
        else if (key[1] === 'run') current.run = key[2];
        else if (key[1] === 'name') current.name = key[2];
        else if (key[1] === 'uses') current.uses = key[2];
      }
      continue;
    }

    if (current === null) continue;

    const key = /^ {8}(name|uses|run|env|if):\s*(.*)$/.exec(line);
    if (key === null) continue;
    if (key[1] === 'name') current.name = key[2];
    else if (key[1] === 'uses') current.uses = key[2];
    else if (key[1] === 'env') inEnv = true;
    else if (key[1] === 'run') {
      if (key[2] === '|') block = { indent: ' '.repeat(10), body: [] };
      else current.run = key[2];
    }
  }

  if (block !== null && current !== null) {
    current.run = block.body.join('\n').replace(/\n+$/, '');
  }
  flush();
  return steps;
};

/** Git Bash, not cmd and not WSL. Every `run:` body in this workflow is bash. */
const resolveShell = () => {
  if (process.platform !== 'win32') return '/bin/bash';
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ];
  const found = candidates.find((path) => existsSync(path));
  if (found === undefined) {
    throw new Error(
      'ci-local needs Git Bash to run the workflow steps, which are bash. Install Git for ' +
        'Windows, or run this script from a bash shell.',
    );
  }
  return found;
};

const main = () => {
  const withDb = process.argv.includes('--with-db');
  const listOnly = process.argv.includes('--list');
  const workflow = readFileSync(WORKFLOW, 'utf8');
  const shell = resolveShell();

  const jobs = withDb ? ['static', 'database'] : ['static'];
  const planned = [];

  for (const job of jobs) {
    const steps = parseSteps(jobLines(workflow, job));

    // A positive control on the derivation. If the reader stops recognising `ci.yml` it must
    // fail here, loudly, rather than report that an empty list of steps all passed — which
    // is the exact shape of every failure this script was written to prevent.
    const runnable = steps.filter((step) => step.run !== null);
    if (runnable.length < 5) {
      throw new Error(
        'ci-local parsed only ' +
          runnable.length +
          ' runnable step(s) from job "' +
          job +
          '". The reader has stopped understanding ci.yml — fix scripts/ci-local.mjs ' +
          'rather than trusting this run.',
      );
    }
    if (job === 'static' && !runnable.some((step) => step.run.includes('pnpm run lint'))) {
      throw new Error(
        'ci-local did not find `pnpm run lint` in the static job. That is the step whose ' +
          'absence locally cost the last session a CI run, and this command exists to ' +
          'cover it.',
      );
    }

    for (const step of steps) {
      if (step.run === null) {
        // `uses:` steps set up the GitHub runner — checkout, pnpm, node. A local checkout
        // already is the repository, and the toolchain is already installed. Reported so
        // the difference between this command and CI is stated rather than assumed.
        planned.push({ job, kind: 'skipped', label: step.uses ?? step.name ?? '(unnamed)' });
        continue;
      }
      planned.push({
        job,
        kind: 'run',
        label: step.name ?? step.run.split('\n')[0],
        body: substituteContext(step.run),
        env: step.env,
      });
    }
  }

  const total = planned.filter((entry) => entry.kind === 'run').length;
  const skipped = planned.length - total;

  console.log('ci-local — derived from .github/workflows/ci.yml');
  for (const entry of planned) {
    console.log((entry.kind === 'run' ? '  RUN  [' : '  skip [') + entry.job + '] ' + entry.label);
  }
  console.log(
    '\n' +
      total +
      ' step(s) to run, ' +
      skipped +
      ' runner-setup step(s) not applicable locally.' +
      (withDb ? '' : '  (--with-db also runs the database job.)'),
  );
  // MR-26 A4. **A green result that silently omits a CI job manufactures confidence.**
  //
  // Not hypothetical. MR-24 shipped four migrations with no rollback file and the push failed
  // on `Verify every migration can be rolled back` -- a step in the `database` job, which THIS
  // COMMAND RUNS under `--with-db`. The tool was not the hole; running the default and reading
  // its green as "CI will pass" was.
  //
  // The omission is DELIBERATE: the database job needs Docker and a Supabase stack, and
  // `verify:rollbacks` empties the public schema, so it cannot be the default. But the hint
  // saying so was printed with the PLAN, twelve steps of output earlier, and had scrolled away
  // by the time the green line appeared. A warning nobody is looking at when they form the
  // belief is not a warning.
  //
  // Repeated HERE, beside the word "passed", and naming the STEPS rather than the job --
  // "the database job" is abstract and "Verify every migration can be rolled back" is the one
  // that actually failed. On stderr, so it survives a pipe to a log.
  const omittedDbSteps = withDb
    ? []
    : (() => {
        const omitted = parseSteps(jobLines(workflow, 'database'))
          .filter((step) => step.run !== null)
          // `step.label` does not exist -- `parseSteps` yields `name` and `run`, and the
          // planner at line 227 is what derives a label. Read from the same two fields it
          // does, so this warning and `--list` can never name steps differently.
          .map((step) => step.name ?? step.run.split(String.fromCharCode(10))[0]);

        // A positive control on the warning itself. If the reader ever stops finding the database
        // job's steps this must fail loudly rather than print an empty list and look reassuring --
        // the same failure shape the derivation control above exists for.
        // **Two controls, because the first one was not enough.** The count check passed while
        // every label printed `undefined` -- it asserted the list was NON-EMPTY, not that it said
        // anything. A warning naming six `undefined` steps is worse than no warning: it looks
        // like a control and carries no information. Assert the CONTENT too.
        if (omitted.length < 3) {
          throw new Error(
            'ci-local could not list the database job steps it is warning about (found ' +
              omitted.length +
              '). Fix the reader rather than trusting this run.',
          );
        }
        if (omitted.some((label) => typeof label !== 'string' || label.length === 0)) {
          throw new Error(
            'ci-local read the database job steps but could not name them. The warning would ' +
              'print a list of blanks, which is the shape of a control that has stopped working.',
          );
        }
        if (!omitted.some((label) => label.toLowerCase().includes('roll'))) {
          throw new Error(
            'ci-local did not find the rollback step in the database job. That is the step whose ' +
              'absence locally shipped four migrations with no rollback, and this warning exists ' +
              'to name it.',
          );
        }
        return omitted;
      })();

  if (listOnly) return 0;

  let index = 0;
  for (const entry of planned) {
    if (entry.kind !== 'run') continue;
    index += 1;
    const heading = '[' + index + '/' + total + '] ' + entry.job + ' · ' + entry.label;
    console.log('\n' + '='.repeat(Math.min(heading.length, 78)) + '\n' + heading + '\n');

    const result = spawnSync(shell, ['-c', entry.body], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...entry.env },
    });

    if (result.status !== 0) {
      console.error(
        '\nFAILED — ' +
          entry.job +
          ' · ' +
          entry.label +
          ' (exit ' +
          (result.status ?? 'signal') +
          ').\nThis is a step CI runs. It would have failed there.',
      );
      return 1;
    }
  }

  console.log('\nAll ' + index + ' step(s) passed. This is what CI runs for ' + jobs.join(' and '));
  if (!withDb) {
    const omitted = omittedDbSteps;
    const bar = '!'.repeat(78);
    console.error('');
    console.error(bar);
    console.error(
      'THIS IS NOT ALL OF CI. The `database` job did NOT run -- ' + omitted.length + ' step(s):',
    );
    for (const label of omitted) console.error('  - ' + label);
    console.error('');
    console.error('Run `pnpm ci:local --with-db` before pushing anything touching migrations,');
    console.error('RLS or the database tests. It needs Docker and it RESETS the local database.');
    console.error(bar);
  }
  return 0;
};

process.exit(main());
