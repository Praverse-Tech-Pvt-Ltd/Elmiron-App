import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Logic only. `.ts`, never `.tsx` — rendering runs under jest with the jest-expo
    // preset, because nothing here can render a React Native component.
    //
    // The exclusion below is redundant with the include glob (`.test.ts` does not
    // match `.test.tsx`) and is stated anyway, so that widening the include cannot
    // silently pull render tests into this runner. `src/runner-boundary.test.ts`
    // asserts the two configs stay disjoint.
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.test.tsx'],
  },
});
