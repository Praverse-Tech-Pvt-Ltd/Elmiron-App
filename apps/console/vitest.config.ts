import { defineConfig } from 'vitest/config';

/**
 * Logic only, mirroring the boundary the rest of the repo keeps: `.test.ts` runs
 * under vitest in node, and anything that needs a renderer does not run here. The
 * console's pages are React Server Components — exercising those needs a browser
 * or a Next test harness, and neither exists yet, so what is tested is the
 * arithmetic the pages present.
 */
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
