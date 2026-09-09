import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.spec.ts'],
    // The local Supabase stack has to come up before these can connect.
    testTimeout: 30_000,
    hookTimeout: 30_000,

    // **`maxWorkers: 6` was here, and MR-12 Part C removed it.**
    //
    // It capped how many suites could seed at once, because every spec's `beforeAll`
    // calls `seedFixtures()`, which creates eight auth users through GoTrue, and enough
    // of those at once exhaust Postgres's 100 connections — surfacing as "Database error
    // creating new user", an error naming neither connections nor concurrency.
    //
    // The cap worked and kept reopening, because **it is a constant tuned to the suite
    // count and the finding it fixes says the burst scales WITH the suite count.** MR-06
    // serialised inside the fixture; MR-07 added two suites and reopened it, and added
    // this line; MR-10 added one more; MR-11 cut `seed-day.spec` from nine identities to
    // three after CI failed again. Each fix was correct and none of them survived the
    // next suite. A number the author of the 34th suite has to know to re-tune is a
    // hand-maintained list wearing a config value — the failure `ci.yml`'s own comments
    // named twice before its third occurrence.
    //
    // The burst is now removed at its source rather than capped: `createAuthUser` takes a
    // Postgres advisory lock, so at most ONE `POST /admin/users` is in flight across all
    // workers regardless of how many suites, workers or cores exist. See
    // `tests/auth.ts`. There is nothing here left to re-tune.
    //
    // A per-file identity budget backs it up, so a suite that mints more than one world's
    // worth fails the build naming itself. `tests/identity-budget.spec.ts` proves both.
    minWorkers: 1,
  },
});
