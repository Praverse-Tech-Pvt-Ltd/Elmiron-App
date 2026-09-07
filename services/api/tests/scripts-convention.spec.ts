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
