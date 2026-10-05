// Render tests for the component package. Same split as apps/field.
//
// Logic tests run under vitest — see vitest.config.ts.
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

  // See the file: it installs the library's own safe-area mock so components that
  // render `Screen` do not each have to mount a provider.
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

  // FE-D2 — the same fix `apps/field/jest.config.cjs` made in MR-22 A2, for the same cause.
  // Jest's 5000 ms default is paid by the FIRST test in each file, which carries module
  // resolution, the babel transform and the first render of a whole screen. Under load that
  // cold start exceeds 5000 ms: `pnpm ci:local` on 28 September failed
  // `ConsentScreen.test.tsx` and `field-states.test.tsx` with "Exceeded timeout of 5000 ms"
  // (both files took ~12.5 s), and the same suite then passed 253/253 twice when run alone.
  // A timeout that depends on what else the machine is doing turns unrelated PRs red. 20 s is
  // field's measured choice, so the two render suites stay on one rule.
  testTimeout: 20_000,

  // W1-Y C. The 28 September timeouts above, and the 5 on 5 October, were blamed on load. The
  // measured cause is the WORKER COUNT: each worker transforms the same cold module graph at once.
  // Cache cleared, 20-core machine: default workers → slowest first test 20.3 s (over the bound
  // it was raised to) and 41.8 s in all; 4 workers → 5.6 s and 17.3 s. The same cap as field
  // (`apps/field/jest.config.cjs`, with its table); 3 is a 4-core CI runner's default already.
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
