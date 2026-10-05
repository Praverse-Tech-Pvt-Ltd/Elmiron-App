#!/usr/bin/env node
/**
 * W1-E B1 — the CLEAN-DATABASE check, as a mechanism rather than a habit.
 *
 * ## Why this exists: the same failure three times, in one run of sessions
 *
 * W1-D pushed a commit whose static job was green and whose **database job was red on three
 * separate defects** — two `anon`-executable trigger functions, a committed global threshold that
 * leaked into another suite, and a reviewer-creation deadlock. **All three passed locally, and all
 * three passed for the same reason: this machine's database carried state from earlier sessions
 * while CI starts clean.**
 *
 * That was the third distinct staleness failure in the same run of sessions:
 *
 *   1. `BE-W119` — a **stale bundle**: `functions serve` kept executing the previous
 *      `packages/core/dist`, so a mutation that removed the patient guardrail entirely still passed.
 *   2. W1-C A2 — a **stale reading**: a function body retyped from a migration file dropped an
 *      idempotency block, because a later migration had redefined it and the file read was not what
 *      was installed.
 *   3. W1-D — a **stale database**: see above.
 *
 * **Discipline failed three times, which is this repository's threshold for a mechanism**
 * (`docs/gotchas.md`, FIX-07: *"a control that cannot be exercised is not a control"*; and
 * `services/api/vitest.config.ts`, on why a constant somebody has to remember to re-tune is not a
 * fix). So this is a script, not a rule.
 *
 * ## What it does
 *
 *   1. `supabase db reset` — **drops the database and re-applies every migration to an empty one.**
 *      This is the step that makes the run clean, and it is the only thing here that is new.
 *   2. `node scripts/ci-local.mjs --with-db` — **the existing path, unchanged.** That script derives
 *      its steps by reading `.github/workflows/ci.yml`, so this check runs whatever CI runs today and
 *      cannot drift into claiming more coverage than it has.
 *
 * **There is deliberately no second list of steps here.** `ci-local.mjs` argues that case at length
 * and it has already been proved three times in this repository; repeating the list would be the
 * exact failure both files were written to prevent.
 *
 * ## Why it gates the PUSH and not the commit (W1-E B2)
 *
 * A reset re-applies **85 migrations** and the database job then runs the whole API suite. That is
 * minutes, and `.githooks/pre-commit` already states the rule this follows: *"a hook that costs
 * minutes is a hook people pass `--no-verify` to, and a bypassed control is not a control."*
 *
 * A commit is cheap and frequent; a push is the moment the work becomes somebody else's problem and
 * the moment CI will judge it. **So the expensive, honest check belongs on the push.**
 *
 * ## What it does NOT do
 *
 *   - It does not skip itself when it thinks nothing relevant changed. A heuristic about which
 *     changes can affect a database is exactly the kind of cleverness that would have skipped all
 *     three W1-D defects — one of which was a TypeScript test file leaking a row.
 *   - It cannot stop `git push --no-verify`. Git allows the bypass by design, and CI remains the
 *     enforcement. This is the thing that tells you before the push rather than twenty minutes after.
 *   - It does not start Docker for you. If the stack cannot be reached it **fails loudly** rather
 *     than passing quietly, because a check that silently skips is the inert control this repository
 *     keeps finding.
 */

import { spawnSync } from 'node:child_process';
import net from 'node:net';

const run = (command, args) => {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return result.status === 0;
};

/** Is Postgres listening? Cheap, and it distinguishes "no stack" from "a failing suite". */
const postgresIsUp = () =>
  new Promise((resolve) => {
    const socket = net.connect(54322, '127.0.0.1');
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.on('connect', () => {
      done(true);
    });
    socket.on('error', () => {
      done(false);
    });
    socket.setTimeout(3000, () => {
      done(false);
    });
  });

const main = async () => {
  if (!(await postgresIsUp())) {
    console.error('');
    console.error('verify-clean-db: no Postgres on 127.0.0.1:54322.');
    console.error('');
    console.error('This check RESETS the database and runs the job CI runs, so it needs the local');
    console.error('stack up. Start it with `pnpm db:start`, or push with --no-verify and own the');
    console.error('red build.');
    console.error('');
    console.error('It fails here rather than skipping: a check that passes when it did not run is');
    console.error('the inert control this repository keeps finding.');
    process.exit(1);
  }

  console.log('verify-clean-db: resetting the database — every migration, onto an empty one.');
  console.log('This is the step that makes the result mean what CI means.');
  if (!run('pnpm', ['db:reset'])) {
    console.error('');
    console.error('verify-clean-db: the RESET failed, so no suite has run yet.');
    console.error('A migration does not apply to an empty database. CI would fail the same way.');
    process.exit(1);
  }

  console.log('');
  console.log('verify-clean-db: running the static and database jobs, derived from ci.yml.');
  if (!run('node', ['scripts/ci-local.mjs', '--with-db'])) {
    console.error('');
    console.error('PUSH REFUSED — a step CI runs has failed above, on a CLEAN database.');
    console.error('');
    console.error('If this passed for you before, the difference is the reset: your database was');
    console.error(
      'carrying state from an earlier session and CI starts clean. That is exactly the',
    );
    console.error('failure this check exists for — three of them in W1-D alone.');
    process.exit(1);
  }

  console.log('');
  console.log('verify-clean-db: clean database, both jobs green.');
};

await main();
