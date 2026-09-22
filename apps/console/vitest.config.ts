import { defineConfig } from 'vitest/config';

/**
 * MR-50 F1: a renderer now exists for `.test.tsx` (see below). Before it: logic only, mirroring the boundary the rest of the repo keeps: `.test.ts` runs
 * under vitest in node, and anything that needs a renderer does not run here. The
 * console's pages are React Server Components — exercising those needs a browser
 * or a Next test harness, and neither exists yet, so what is tested is the
 * arithmetic the pages present.
 */
export default defineConfig({
  // MR-50 F1 (`C10`): `.test.tsx` renders with @testing-library/react, dev-only. Those files opt in
  // to jsdom with a `// @vitest-environment jsdom` line; everything else stays in node. The console's
  // tsconfig keeps `jsx: "preserve"` for Next, so the test transform is set here, not there.
  esbuild: { jsx: 'automatic' },
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx'], environment: 'node' },
});
