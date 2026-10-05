// Render tests only. Logic tests run under vitest — see vitest.config.ts.
//
// Two runners in one workspace is a real cost and was chosen deliberately: the 40
// existing vitest tests are the most carefully constructed in the codebase and
// porting them between runners risks silently weakening an assertion in a way no
// count would show. jest-expo is the maintained path for rendering Expo/React Native
// components; vitest is the repo standard everywhere else.
//
// THE BOUNDARY IS BY FILE EXTENSION AND IT IS ENFORCED, NOT CONVENTIONAL:
//
//   *.test.ts   -> vitest   (pure logic, node, no renderer)
//   *.test.tsx  -> jest     (rendering, jest-expo preset)
//
// `src/runner-boundary.test.ts` asserts the two globs cannot overlap. If both runners
// ever match the same file, tests are counted twice and every reported total becomes
// unauditable.
//
// `.cjs` because apps/field is `"type": "module"` per the repo convention, and jest's
// config loader uses require.

module.exports = {
  // `require.resolve`, not the bare name 'jest-expo'.
  //
  // Jest resolves a bare preset name with its own resolver, which under pnpm's
  // isolated layout does not search apps/field/node_modules — jest itself lives in
  // .pnpm/jest@29.../node_modules and looks from there. Node's own resolver finds
  // the preset fine from this directory, which makes the failure read as "the
  // package is not installed" when it is installed and linked.
  //
  //   Validation Error: Preset jest-expo not found.
  //
  // Resolving the path here, from this file's location, sidesteps jest's resolver
  // entirely.
  // Jest wants the DIRECTORY holding jest-preset.js, not the file itself — pointing
  // at the file gives 'should have "jest-preset.js" or "jest-preset.json" at the
  // root'. dirname of the resolved file is that directory.
  preset: require('node:path').dirname(require.resolve('jest-expo/jest-preset')),

  // Screens render `@fieldforce/ui`'s `Screen`, which reads the safe-area inset and
  // throws when no provider is mounted. Same setup file as packages/ui.
  setupFiles: ['<rootDir>/jest.setup.cjs'],

  // The other half of the boundary. Narrower than jest's default on purpose.
  //
  // W1-A B5 -- the `<rootDir>/` prefix was REMOVED, and the reason is not cosmetic.
  //
  // With `'<rootDir>/**/*.test.tsx'` jest matches the pattern against each candidate's ABSOLUTE
  // path, and `**` does not traverse a dot-segment. A checkout whose path contains one -- which
  // is every git worktree under `.claude/worktrees/` -- therefore discovers ZERO tests and jest
  // exits 1 with `No tests found`:
  //
  //   testMatch: D:/...\.claude/worktrees/<name>/apps/field/**/*.test.tsx - 0 matches
  //   157 files checked.
  //
  // That is the worst shape a test-discovery bug can take: `pnpm test` is RED for a reason that
  // looks like a broken config, `scripts/test-counts.mjs` exits 1, and 415 render tests across
  // this workspace and `packages/ui` are silently unrunnable for anyone reviewing from a
  // worktree. It is not a property of the branch -- CI checks out normally and was unaffected --
  // which is exactly why it went unnoticed.
  //
  // Without the prefix, jest globs from `roots` (which defaults to `[rootDir]`) instead of
  // matching an absolute path, so the dot-segment in the checkout path is never part of the
  // pattern's subject. `roots` is unchanged, `testPathIgnorePatterns` still excludes
  // node_modules/dist/.expo/android/ios, and the vitest/jest extension boundary that
  // `runner-boundary.test.ts` enforces is byte-for-byte the same: `*.test.tsx` and nothing else.
  //
  // Verified both ways in the worktree: `jest --listTests` printed 0 paths before and the full
  // suite after.
  testMatch: ['**/*.test.tsx'],

  // MR-22 A2. Jest's 5000 ms default is too tight for this suite ON CI, and the failure
  // it produced was blamed on machine load for five sessions.
  //
  // MEASURED, both sides, rather than guessed at:
  //
  //   locally   first test 363 ms, the other five 7-29 ms, whole field suite 4.98 s
  //   on CI     the SAME first test exceeded 5000 ms; the suite took 10.5-12 s
  //             (runs 34470900684 and 34471969217, both `samples-route.test.tsx`)
  //
  // The first test in a file pays for module resolution, the babel transform of
  // `@fieldforce/ui` as SOURCE (see transformIgnorePatterns below), and the first render
  // of a whole screen. On a cold runner that is 13x the local cost and it lands on
  // whichever test happens to be first.
  //
  // **An earlier diagnosis of this was WRONG and is recorded so nobody repeats it.** It
  // was read as a race between an async route load and `findByText`'s timeout. It is not:
  // `day-end-route.test.tsx` has exactly that shape and passes, while `samples-route`
  // failed AFTER being converted to a synchronous store read. The cost is cold start, not
  // waiting.
  //
  // 20 s is ~4x the observed CI suite time, which leaves room for a slower runner while
  // still failing a genuine hang in a reasonable interval. It is a property of the runner
  // and the environment, so it belongs here rather than on one `it`.
  testTimeout: 20_000,

  // W1-Y C. **The cold start scales with the number of WORKERS, not with the machine's load.**
  // Every worker transforms and loads the same cold module graph at once, so more workers make
  // each first test SLOWER. Measured on a 20-core machine, cache cleared before each run:
  //
  //   workers   slowest first test   suites failing (timeout)   whole run
  //   19 (default)      36.9 s                9                  56.9 s
  //   10 (50%)          22.3 s                2                  34.8 s
  //    4                12.5 s                0                  23.3 s
  //    3                11.2 s                0                  24.0 s
  //
  // Every one of the 9 failures was the FIRST test in its file; the median later test took 0.07 s.
  // So this caps the cause and leaves the bound alone. 3 is what a 4-core CI runner already uses by
  // default (cores − 1), so CI is unchanged; it only stops a big machine from timing itself out.
  // The slowest first test left is `offline-day*`, which reloads the app twice ON PURPOSE
  // (`jest.resetModules()` to simulate death): 11–13 s cold, about 60% of the bound.
  maxWorkers: 3,

  // Build artifacts are not source. apps/field/dist holds a compiled Hermes bundle
  // that contains supabase-js's entire SDK; a runner walking it is slow at best and
  // misleading at worst. See the search convention in docs/gotchas.md.
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/dist/',
    '<rootDir>/.expo/',
    '<rootDir>/android/',
    '<rootDir>/ios/',
  ],

  // The trap. jest-expo ships a transformIgnorePatterns that transforms React Native
  // and Expo packages inside node_modules and skips everything else. That is right
  // until a workspace package is consumed as TypeScript SOURCE rather than as built
  // JavaScript — which is exactly how @fieldforce/ui is set up (`main` points at
  // src/index.ts so Metro and Next.js can both transpile it). Without @fieldforce
  // added here, jest hands raw TSX to node and fails on the first `<`.
  transformIgnorePatterns: [
    'node_modules/(?!(?:.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|jest-expo|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@fieldforce/.*))',
  ],
};
