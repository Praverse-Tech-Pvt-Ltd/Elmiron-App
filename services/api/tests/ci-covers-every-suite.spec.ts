import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * MR-08 A2 — every workspace that HAS tests must be a step in CI.
 *
 * **`@fieldforce/console` had a `test` script, ten passing cases, and no line in
 * `ci.yml`.** They had never run in CI and appeared in no session's counts, for several
 * sessions. Nothing noticed, because a workspace CI does not mention looks exactly like a
 * workspace with nothing to run — the same shape as `@fieldforce/ui`'s 221 jest cases
 * being read as 4, and the same shape as a guard with no positive control.
 *
 * `ci.yml`'s own comments already name this failure twice: `ui-tokens` was *"decorative
 * in CI from the day it was written"* because the step did not exist, and `ui` was added
 * *"in the same commit, because a workspace that gains a suite and not a CI line is how
 * ui-tokens stayed decorative."* The rule was known, written down, and applied by hand —
 * and a hand-maintained list will eventually be left off one. This derives it.
 *
 * It lives in the api suite because that is where the repository-wide convention guards
 * already live (`scripts-convention.spec.ts`, `verify-rollbacks.spec.ts`), and because
 * `services/api` is the one workspace CI cannot forget: it is the whole second job.
 */

const ROOT = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const WORKSPACE_GROUPS = ['packages', 'apps', 'services'];

/** Every workspace declaring a `test` script, read from the workspaces themselves. */
const workspacesWithTests = async (): Promise<string[]> => {
  const found: string[] = [];
  for (const group of WORKSPACE_GROUPS) {
    const base = join(ROOT, group);
    if (!existsSync(base)) continue;
    for (const name of await readdir(base)) {
      const manifestPath = join(base, name, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        name?: string;
        scripts?: Record<string, string>;
      };
      if (manifest.scripts?.['test'] !== undefined && manifest.name !== undefined) {
        found.push(manifest.name);
      }
    }
  }
  return found.sort();
};

describe('CI runs every suite that exists', () => {
  it('every workspace with a test script has a step in ci.yml', async () => {
    const workflow = await readFile(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    const workspaces = await workspacesWithTests();

    // A positive control on the derivation: if the workspace scan ever breaks — a moved
    // directory, a changed manifest shape — it must fail here rather than assert that an
    // empty list is fully covered.
    expect(workspaces.length, 'the workspace scan found nothing').toBeGreaterThan(4);
    expect(workspaces).toContain('@fieldforce/api');

    const missing = workspaces.filter((name) => !workflow.includes(`--filter ${name}`));
    expect(
      missing,
      'these workspaces have tests that CI never runs — add a step, or remove the test script',
    ).toEqual([]);
  });

  it('and the counter script exists to catch a runner that reports nothing', async () => {
    // The other half of the same failure. `ci.yml` naming a workspace proves the suite is
    // invoked; it does not prove the cases were counted. `scripts/test-counts.mjs` reads
    // each workspace's own `test` script to learn which runners it declares, runs each
    // one, and exits non-zero if a configured runner reports zero cases or any skips.
    //
    // Asserted to exist rather than executed here: running every suite in the repository
    // from inside one of them would be a fork bomb with a nice comment on it.
    const script = await readFile(join(ROOT, 'scripts', 'test-counts.mjs'), 'utf8');
    expect(script).toContain('reported ZERO cases');
    expect(script).toContain('SKIPPED');
  });
});
