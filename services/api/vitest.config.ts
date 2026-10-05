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

    // ------------------------------------------------------------------------
    // W1-H A — `BE-W125` CLOSED BY NOT SHARING THE DATABASE.
    //
    // **One spec file at a time. This suite does not run files in parallel.**
    //
    // The defect: 73 spec files shared one Postgres. Some suites COMMIT global
    // `app_thresholds` rows (the Edge Function runs out of process and cannot see a
    // transaction); one suite performs DDL, which takes ACCESS EXCLUSIVE. Concurrently,
    // those deadlock — `40P01`, in a different test almost every time.
    //
    // **Measured on a clean database with the Edge Function served, 8 runs each:**
    //
    //   file parallelism : 1 failing run of 8, wall clock 52-90s (median 55s)
    //   one file at a time: 0 failing runs of 8, wall clock 98-100s
    //
    // **So it costs about 45 seconds and removes the whole class.** Not a mitigation and
    // not a retry — with one file running there is nothing to contend with, so the race
    // cannot occur rather than occurring less often.
    //
    // **Why not per-worker databases**, which was the first idea and is the expensive one:
    // 15 of the 73 spec files reach the database through PostgREST, GoTrue or the Edge
    // Function, and those are pointed at ONE database by the Supabase stack itself. Giving
    // each worker its own database would isolate 58 files and leave those 15 sharing — the
    // deadlock class surviving in exactly the suites most likely to hit it, plus a permanent
    // fork in how a test reaches the database. Days of work to half-fix it.
    //
    // **What this costs, stated plainly:** the api suite is roughly twice as slow. CI's
    // database job goes from about 5m23s to about 6m20s. That is the price of a signal that
    // means something — at 1 spurious red in 8, a red was no longer evidence about the change
    // under test, which is the condition this project correctly called a broken signal when
    // `BE-W92` was in it.
    //
    // **If somebody re-enables parallelism**, the advisory lock in `tests/global-thresholds.ts`
    // is what keeps the `app_thresholds` half safe; it is currently uncontended, not removed.
    // The DDL half has no such guard, so re-enabling brings `BE-W125` straight back.
    fileParallelism: false,
  },
});
