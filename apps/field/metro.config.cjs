// Metro in a pnpm workspace.
//
// Two things this file exists for, both of which fail confusingly without it:
//   1. `watchFolders` — the app imports @fieldforce/core, @fieldforce/ui and
//      @fieldforce/ui-tokens from outside its own directory. Metro does not watch
//      outside the project root by default, so edits there would not reload.
//   2. `nodeModulesPaths` — the workspace root is a second place to look, because
//      hoisted packages land there rather than in the app.
//
// `disableHierarchicalLookup` is deliberately NOT set, and that is the opposite of
// what Expo's monorepo guide says. The guide assumes npm or yarn, where every
// package is flat at the root and the upward walk finds only duplicates. Under
// pnpm, a package's own dependencies live nested inside the store — expo-router's
// `invariant`, for one — and switching the upward walk off makes them unresolvable.
// Turning it on cost an afternoon of "Unable to resolve module" errors naming
// packages nothing had asked for.
//
// `.cjs` because apps/field is `"type": "module"` per the repo convention, and
// Metro's config loader uses `require`.

const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
module.exports = config;
