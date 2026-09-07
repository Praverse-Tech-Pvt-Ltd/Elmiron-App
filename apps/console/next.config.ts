import type { NextConfig } from 'next';

/**
 * The manager and admin consoles.
 *
 * `transpilePackages` covers the workspace packages this app imports as
 * TypeScript source rather than as built output — the token package is consumed
 * straight from `src` inside the monorepo, and without this Next refuses it.
 *
 * **`@fieldforce/ui` is deliberately not here.** That package is React Native and
 * cannot render in a browser without `react-native-web`, which would be a second
 * rendering target to keep working for the life of the product. Phase 4 asks for
 * "the same Phase 1 tokens at compact density", not the same components — so the
 * console shares `@fieldforce/ui-tokens` and writes its own small set of web
 * elements against it. The tokens are the contract; the components are not.
 */
const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@fieldforce/ui-tokens', '@fieldforce/core'],
};

export default config;
