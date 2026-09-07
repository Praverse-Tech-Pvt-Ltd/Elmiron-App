import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FIX-08 B2 — the scripts in `services/api/scripts/` must not import `packages/core`.
 *
 * **This guards a production failure, not a test one.** `retention.yml` and
 * `retention-watchdog.yml` run `purge:audio` and `check:purge-health` as plain
 * `pnpm --filter @fieldforce/api <script>` invocations. Those are not turbo tasks, so
 * nothing builds workspace dependencies for them and **there is no build step in either
 * workflow**. The moment one of these scripts imports from `@fieldforce/core`, the
 * retention worker fails — hourly, on a schedule, in production, deleting nothing.
 *
 * That failure mode has already happened once in a different guise: the workflows sat
 * `disabled_manually` from 23 August and nobody noticed until the database auto-paused
 * for want of traffic. A worker that fails silently is the specific thing this project
 * cannot afford twice.
 *
 * The convention already exists and is written down — `seed-one-mr.mjs` explains that it
 * "joins its five siblings instead: plain `.mjs`, `pg`, and `fetch`", having been rewritten
 * away from importing the TypeScript fixtures. What did not exist was anything that would
 * notice when somebody breaks it. FIX-06 established the rule this closes: **test the
 * mechanism, not the current state.**
 *
 * If a script genuinely needs `@fieldforce/core` one day, this test is the right place to
 * find out that a build step has to be added to both retention workflows first.
 */

const SCRIPTS_DIR = new URL('../scripts/', import.meta.url).pathname;

const CI_WORKFLOW = new URL('../../../.github/workflows/ci.yml', import.meta.url).pathname;

/** Windows: `/C:/…` from a file URL is not a path anything can open. */
const local = (fromUrl: string): string => fromUrl.replace(/^\/([A-Za-z]:)/, '$1');

describe('services/api/scripts stay free of workspace imports', () => {
  it('no script imports @fieldforce/core', async () => {
    const dir = SCRIPTS_DIR.replace(/^\/([A-Za-z]:)/, '$1');
    const entries = (await readdir(dir)).filter((f) => f.endsWith('.mjs'));

    // A positive control on the fixture itself: if the directory ever reads empty, this
    // test would pass while checking nothing.
    expect(entries.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const entry of entries) {
      const source = await readFile(join(dir, entry), 'utf8');
      if (/from\s+['"]@fieldforce\//.test(source) || /require\(['"]@fieldforce\//.test(source)) {
        offenders.push(entry);
      }
    }

    // If this fails: the script is fine, but `retention.yml` and
    // `retention-watchdog.yml` need a build step before they will run in production.
    expect(offenders).toEqual([]);
  });
});

/**
 * FIX-12 A4 — nothing that reads the schema may run after the step that destroys it.
 *
 * `verify:rollbacks` applies every rollback in reverse and leaves `public` empty. FIX-10
 * put `check:decision-debt` after it and CI failed with
 * `function public.ucpmp_cap_decision_status() does not exist` (run 34150819478). The
 * control was correct — it failed CLOSED on an answer it could not read — and its
 * position was wrong.
 *
 * **That is the second CI defect in three sessions where a correct check sat in the wrong
 * place in a mutating environment**: FIX-08's was the dependency graph, this was schema
 * state. The class is worth a control of its own, because the dangerous version is not the
 * one that failed. A step that reads an empty schema and *passes* — a count that is
 * legitimately zero, a "no rows found, nothing to do" — proves nothing and says green.
 *
 * A comment saying "runs last" is not a control; this is. It asserts the *ordering*
 * rather than any particular step name, so a future step added at the bottom of the job
 * fails here rather than in six months.
 */
describe('nothing runs after the step that empties the schema', () => {
  it('verify:rollbacks is the last step in its job except for teardown', async () => {
    const yaml = await readFile(local(CI_WORKFLOW), 'utf8');
    const steps = [...yaml.matchAll(/^ {6}- name: (.+)$/gm)].map((m) => m[1]?.trim() ?? '');

    // A positive control: if the regex ever stops matching, this test would pass while
    // checking nothing.
    expect(steps.length).toBeGreaterThan(3);

    const destructive = steps.findIndex(
      (name) => name === 'Verify every migration can be rolled back',
    );
    expect(destructive).toBeGreaterThan(-1);

    // Teardown is allowed to follow, and only teardown. It touches containers, not the
    // schema, and it carries `if: always()` so it must run even when an earlier step
    // failed.
    const after = steps.slice(destructive + 1);
    expect(after).toEqual(['Stop Supabase']);
  });

  it('the decision check is positioned before it, not merely present', async () => {
    // The specific instance of the rule above, named, because this is the one that has
    // already gone wrong once.
    const yaml = await readFile(local(CI_WORKFLOW), 'utf8');
    // The RUN lines, not any mention: the comment above the decision step names
    // `verify:rollbacks` while explaining why it must not follow it, and matching prose
    // would have this test asserting the position of a sentence.
    const decision = yaml.indexOf('run: pnpm --filter @fieldforce/api check:decision-debt');
    const rollbacks = yaml.indexOf('run: pnpm --filter @fieldforce/api verify:rollbacks');
    expect(decision).toBeGreaterThan(-1);
    expect(rollbacks).toBeGreaterThan(-1);
    expect(decision).toBeLessThan(rollbacks);
  });
});
