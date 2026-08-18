import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Two runners in one workspace, and they must never see the same file.
 *
 * If vitest and jest both match a test, it runs twice and every reported total is a
 * sum nobody can audit — which matters more than usual here, because CI has never
 * run and the counts in `PROJECT-OVERVIEW.md` are the only evidence there is.
 *
 * Enforced rather than conventional, for the same reason the component-extraction
 * rule is: a convention holds until someone widens a glob in a hurry.
 *
 * The boundary is the file extension:
 *   `*.test.ts`  -> vitest, logic, node, no renderer
 *   `*.test.tsx` -> jest, rendering, jest-expo preset
 */

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url).href), 'utf8');

const vitestConfig = read('../vitest.config.ts');
const jestConfig = read('../jest.config.cjs');

/** Pull the string literals out of a named array in a config file. */
const patternsIn = (source: string, key: string): readonly string[] => {
  const block = new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`, 'u').exec(source);
  if (block?.[1] === undefined) throw new Error(`No ${key} array found in the config.`);
  return [...block[1].matchAll(/'([^']+)'/gu)].map((match) => match[1] ?? '');
};

describe('the vitest / jest boundary', () => {
  it('sends only .test.ts to vitest', () => {
    const include = patternsIn(vitestConfig, 'include');
    expect(include.length).toBeGreaterThan(0);
    for (const pattern of include) {
      expect(pattern, `vitest include "${pattern}" must end in .test.ts`).toMatch(/\.test\.ts$/u);
    }
  });

  it('sends only .test.tsx to jest', () => {
    const match = patternsIn(jestConfig, 'testMatch');
    expect(match.length).toBeGreaterThan(0);
    for (const pattern of match) {
      expect(pattern, `jest testMatch "${pattern}" must end in .test.tsx`).toMatch(/\.test\.tsx$/u);
    }
  });

  it('keeps vitest excluding .test.tsx even though the include already does', () => {
    // Belt and braces on purpose: the include glob alone is disjoint, but a future
    // widening to `*.test.{ts,tsx}` would silently overlap. This exclusion survives
    // that mistake.
    expect(patternsIn(vitestConfig, 'exclude')).toContain('**/*.test.tsx');
  });

  it('cannot match the same file in both runners', () => {
    // The property the other three exist to produce, asserted directly: no string
    // can satisfy a vitest include and a jest testMatch at once, because one demands
    // a .test.ts suffix and the other .test.tsx, and `.test.ts` is not a suffix of
    // `.test.tsx` — the character after `.test.ts` in `.test.tsx` is `x`, not the end.
    const vitestSuffixes = patternsIn(vitestConfig, 'include').map((p) => p.replace(/^.*\*/u, ''));
    const jestSuffixes = patternsIn(jestConfig, 'testMatch').map((p) => p.replace(/^.*\*/u, ''));

    for (const v of vitestSuffixes) {
      for (const j of jestSuffixes) {
        expect(v === j, `vitest "${v}" and jest "${j}" match the same files`).toBe(false);
        expect(j.endsWith(v) && j !== v ? j.slice(0, -v.length).endsWith('.') : false).toBe(false);
      }
    }
  });
});
