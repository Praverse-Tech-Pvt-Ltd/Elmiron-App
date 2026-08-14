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
    // Route files still work, because composing `@elmiron/ui` needs none of these.
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
            'Namespace-importing react-native reaches the visual primitives that are restricted here. Components live in @elmiron/ui. Import the specific non-visual API you need by name.',
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
                'Components live in @elmiron/ui, never in apps/field. Import the component you need from @elmiron/ui, or add it there if it does not exist yet.',
            },
          ],
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
