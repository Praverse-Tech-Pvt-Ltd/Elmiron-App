import { defineConfig, devices } from '@playwright/test';

/**
 * W1-F — the browser the rest of the suite is not.
 *
 * **Why this exists at all.** `/practice` typechecked, linted and passed 24 render tests, and then
 * returned **500** on its first real request: a pure function living in a `'use client'` module is
 * a client *reference* on the server, and calling it throws. **Nothing in the local checks requests
 * a page**, so nothing could have caught it. That is the class of defect this config exists for,
 * and it is not hypothetical — it already happened once in this repository.
 *
 * **Deliberately OUTSIDE `turbo run test`.** The workspace's `test` script is `vitest run`, whose
 * include is `src/**`, and these specs live in `e2e/`. So CI is untouched: it has no browser binary
 * and a suite that cannot run is worse than one that is not wired up, because the first reports
 * red for the wrong reason and the second reports nothing and says so. Run it with
 * `pnpm --filter @fieldforce/console test:e2e`, against a local stack.
 *
 * **`reuseExistingServer` is on for local runs only.** A developer usually already has `next dev`
 * up; starting a second one on the same port fails and the failure looks like a test failure.
 */
/** Set by GitHub Actions, and by `ci-local.mjs` for the steps it derives from `ci.yml`. */
const isCI = process.env['CI'] !== undefined && process.env['CI'] !== '';

export default defineConfig({
  testDir: './e2e',
  // One worker. The specs sign in, approve and start sessions against ONE local database, and two
  // of them racing would produce failures that are about the runner rather than the product.
  workers: 1,
  fullyParallel: false,
  // No retries. A retry here would hide exactly the flake worth knowing about — a screen whose
  // write has not landed before the next read.
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // The JSON report is configured HERE, not with `--reporter=list,json` plus
  // `PLAYWRIGHT_JSON_OUTPUT_NAME` on the CI step. That is how it was first written and the env var
  // did not reach the reporter: the report went to STDOUT, the CI gate read a *stale*
  // `playwright-results.json` left by an earlier local run, and reported 5 tests for a run that
  // had just passed 7. **A gate that a leftover file can answer is not a gate.** Declaring the
  // output path in the config makes it deterministic, and the CI step deletes the file first so a
  // stale one cannot survive to be read.
  reporter: [['list'], ['json', { outputFile: 'playwright-results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // **CI builds and serves; a developer's machine uses `next dev`.**
    //
    // The first CI run of this suite failed with `Timed out waiting 120000ms from
    // config.webServer`. `next dev` on a cold runner with no `.next` cache must compile the route
    // before it can answer, which is neither fast nor bounded — and dev mode then compiles every
    // FURTHER route on first navigation, so the 60-second per-test timeout would have been the
    // next thing to fail. Raising the timeout would have moved the failure, not removed it.
    //
    // `next build` is safe here for a specific, checkable reason: **every route is `ƒ (Dynamic)`**
    // — each carries `export const dynamic = 'force-dynamic'`, and `sign-in` is a client component
    // — so nothing is prerendered and the build never reaches for a database.
    command: isCI ? 'pnpm build && pnpm start' : 'pnpm dev',
    url: 'http://127.0.0.1:3100/sign-in',
    // Reuse a developer's already-running `next dev`; never in CI, where reusing something
    // would mean reusing a server this job did not start.
    reuseExistingServer: !isCI,
    // The build happens inside this window in CI, so it is generous on purpose.
    timeout: isCI ? 300_000 : 120_000,
  },
});
