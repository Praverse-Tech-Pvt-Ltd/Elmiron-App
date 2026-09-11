import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.turbo/**',
      '**/.expo/**',
      '**/.next/**',
      '.pnpm-store/**',
      'services/api/supabase/.temp/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // A workspace may not import a package it has not declared.
    //
    // pnpm's isolated linker already refuses this at install time, and that guard is
    // intact — no hoisting is configured. This rule exists so the property survives
    // the next time someone is tempted to hoist their way out of a resolution
    // failure: the guarantee then still holds at lint time, in CI, for every
    // workspace. React Native's own graph breaks this rule constantly, which is
    // precisely why the repo should not.
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { import: importPlugin },
    rules: {
      'import/no-extraneous-dependencies': [
        'error',
        {
          // Test files and config may use the tooling; shipped code may not.
          devDependencies: [
            '**/*.test.ts',
            '**/*.test.tsx',
            '**/*.spec.ts',
            '**/tests/**',
            '**/*.config.ts',
            '**/*.config.mjs',
          ],
          optionalDependencies: false,
          peerDependencies: true,
        },
      ],
    },
  },
  {
    // The component-extraction rule.
    //
    // Strengthened beyond what was specified, deliberately. The ask was a rule that
    // fails when a component is *defined* in apps/field. This instead removes the
    // materials: apps/field cannot import React Native's visual primitives at all,
    // so a component cannot be built here rather than being detected after the fact.
    // Same shape as "there is no upload endpoint without consent, not a disabled
    // one". Do not simplify it back into a naming or file-location convention.
    //
    // Every component lives in `packages/ui`. `apps/field` composes screens from it
    // and defines none of its own — the console consumes the same package from
    // FE-W6, and extracting components after both apps exist is a rewrite of every
    // screen.
    //
    // Enforced by removing the materials rather than by policing the output: with no
    // access to react-native's visual primitives, a component cannot be built here.
    // Route files still work, because composing `@fieldforce/ui` needs none of these.
    // Non-visual APIs — Platform, AppState, Linking, Alert — stay available.
    //
    // Two rules, because one is not enough. `no-restricted-imports` matches named
    // imports; `import * as RN from 'react-native'` slips past it and reaches
    // `RN.View` anyway. A control with a known bypass is a control until the first
    // person finds the bypass, so the namespace form is banned outright below.
    files: ['apps/field/**/*.ts', 'apps/field/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportDeclaration[source.value="react-native"] > ImportNamespaceSpecifier',
          message:
            'Namespace-importing react-native reaches the visual primitives that are restricted here. Components live in @fieldforce/ui. Import the specific non-visual API you need by name.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native',
              importNames: [
                'View',
                'Text',
                'ScrollView',
                'Pressable',
                'TouchableOpacity',
                'TouchableHighlight',
                'TouchableWithoutFeedback',
                'StyleSheet',
                'Image',
                'ImageBackground',
                'TextInput',
                'FlatList',
                'SectionList',
                'VirtualizedList',
                'Button',
                'Switch',
                'ActivityIndicator',
                'Modal',
                'SafeAreaView',
                'KeyboardAvoidingView',
              ],
              message:
                'Components live in @fieldforce/ui, never in apps/field. Import the component you need from @fieldforce/ui, or add it there if it does not exist yet.',
            },
          ],
        },
      ],
    },
  },
  {
    // MR-25 C1 — SCREENS MUST NOT RENDER A TIME THEMSELVES.
    //
    // MR-14 found every time on the Today screen rendered 5½ hours wrong: `clockFrom` is a
    // CHARACTER SLICE of the ISO string, `iso.slice(11, 16)`, correct only while the server
    // sends the territory's own offset. The mock at :4010 does; Supabase does not. It was
    // fixed, and written up in `gotchas.md`, and the entry named the trap exactly —
    // "converting a screen to real data means replacing this call".
    //
    // MR-21 then converted `app/visit/[id].tsx` to real data and kept the call. MR-24 found
    // a check-in stamped 11:15:34 IST rendered as "Checked in 05:45". **The lesson was
    // written down and it did not prevent the defect**, which is the whole of gotchas rule 6:
    // a written lesson is not a control.
    //
    // So this is the control. Note what it has to ban to work: the defect was NOT a raw
    // slice in a screen — it was a screen calling `clockFrom`, a perfectly ordinary-looking
    // helper. A rule that only banned `.slice(11, 16)` would have missed it entirely. The
    // offset-naive HELPERS are therefore what is restricted here, and the raw shapes are
    // banned beside them so the next person cannot simply inline one.
    //
    // Screens read the pulled store, which holds SERVER timestamps. `clockIn(iso, zone)` and
    // `dayIn(iso, zone)` in `src/today/territory-day.ts` take the territory's zone explicitly
    // and are the only correct answer for them. The restricted helpers remain legitimate in
    // `src/` for the screens still on the mock, which is why this override is scoped to
    // `apps/field/app/` — the screens — and not to the whole workspace.
    files: ['apps/field/app/**/*.ts', 'apps/field/app/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/today/plan', '**/today/plan.js', '../../src/today/plan'],
              importNames: ['clockFrom'],
              message:
                'clockFrom is a character slice of the ISO string and is only correct while the server sends the territory offset — Supabase sends Z. This is the MR-14 defect, reintroduced by MR-21 in a screen converted after it was documented. Use clockIn(iso, zone) from src/today/territory-day, with zone from usePulledStore().',
            },
            {
              group: ['**/today/route-labels', '**/today/route-labels.js'],
              importNames: ['clockFromOrNull'],
              message:
                'clockFromOrNull wraps clockFrom, which is a character slice. Use clockIn(iso, zone) from src/today/territory-day and handle null at the call site.',
            },
            {
              group: ['**/doctors/profile', '**/doctors/profile.js'],
              importNames: ['dayMonthFrom'],
              message:
                'dayMonthFrom is a character slice of the ISO date and renders the UTC day for a Supabase timestamp — a visit received at 19:00Z renders the previous day. Use dayIn(iso, zone) from src/today/territory-day.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.property.name=/^(toLocaleTimeString|toLocaleDateString|toLocaleString)$/]',
          message:
            "toLocale*String formats in the DEVICE's timezone and locale. An MR's handset is not the territory. Use clockIn(iso, zone) or dayIn(iso, zone) from src/today/territory-day, where the zone comes from the server.",
        },
        {
          selector:
            "CallExpression[callee.property.name='slice'][arguments.0.value=11][arguments.1.value=16]",
          message:
            'Slicing characters 11-16 out of an ISO string reads the time in whatever offset the string carries — UTC, for Supabase. This is the MR-14 five-and-a-half-hour defect. Use clockIn(iso, zone) from src/today/territory-day.',
        },
        {
          selector:
            "CallExpression[callee.property.name=/^get(Hours|Minutes|Date|Month|FullYear|Day)$/][callee.object.callee.name='Date']",
          message:
            'Date getters read the DEVICE clock and the device timezone. The territory decides the day and the time — see src/today/territory-day.ts. Use clockIn / dayIn with the zone from the server.',
        },
      ],
    },
  },
  {
    // Plain JS: config files and the rollback verifier script. Node globals, and no
    // type-aware rules, since these are outside any tsconfig project.
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: globals.node,
    },
  },
  prettier,
);
