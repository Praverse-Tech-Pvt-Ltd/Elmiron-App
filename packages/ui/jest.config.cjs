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

  // The other half of the boundary. Narrower than jest's default on purpose.
  testMatch: ['<rootDir>/**/*.test.tsx'],

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
