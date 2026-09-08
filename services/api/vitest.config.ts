import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.spec.ts'],
    // The local Supabase stack has to come up before these can connect.
    testTimeout: 30_000,
    hookTimeout: 30_000,

    // **MR-07 E1. A cap on how many suites seed at once, because Postgres has 100
    // connections and this suite will ask for more.**
    //
    // Every spec's `beforeAll` calls `seedFixtures()`, which creates eight auth users
    // through GoTrue. With no cap vitest starts one worker per core and they all seed
    // simultaneously; GoTrue then cannot get a connection
    // (`remaining connection slots are reserved for roles with the SUPERUSER attribute`,
    // `sorry, too many clients already`) and returns a 500 that surfaces as
    // **"Database error creating new user"** — an error naming neither connections nor
    // concurrency, which fails whole suites at their `beforeAll`.
    //
    // MR-06 serialised the eight creations inside one fixture, which cut the peak
    // eightfold and held until MR-07 added two more spec files. That is the shape of the
    // problem: the burst scales with the number of SUITES, so the fix belongs here rather
    // than in the fixture.
    //
    // Six is chosen to leave headroom rather than to sit at the edge — GoTrue, PostgREST,
    // Realtime and Storage hold pools of their own against the same 100. Reproduce the
    // failure by removing this line and running the api suite on a machine with more than
    // six cores.
    maxWorkers: 6,
    minWorkers: 1,
  },
});
