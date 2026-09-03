import { describe, expect, it } from 'vitest';
import { evaluateContrast, formatRatio } from './contrast.js';
import { brandPalette } from './palette.js';
import { fontFamilyFor, requiredContrastPairs, tokens } from './tokens.js';

describe('tokens', () => {
  it('is labelled brand, because Phase 1 is committed', () => {
    // This asserted 'placeholder' for four weeks and failed the moment palette.ts
    // was replaced — which is what it was for. Leaving it asserting the real state
    // keeps the reverse true: a regression to invented values goes red here.
    expect(tokens.status).toBe('brand');
  });

  it('bans a third grey', () => {
    // Phase 1 lists this among its banned items. Two greys carry the whole product:
    // ink for primary, muted for everything else. A third one is how "not quite
    // primary but not quite secondary" gets invented on a screen nobody reviews.
    const greys = [tokens.color.textPrimary, tokens.color.textSecondary];
    expect(new Set(greys).size).toBe(2);
  });

  it('keeps every tappable target at or above the 44px floor', () => {
    const { floor, secondary, primary, inVisit } = tokens.target;
    expect(floor).toBeGreaterThanOrEqual(44);
    for (const size of [secondary, primary, inVisit]) {
      expect(size).toBeGreaterThanOrEqual(floor);
    }
  });

  it('draws every colour from the palette, so a brand swap is one file', () => {
    const palette: readonly string[] = Object.values(brandPalette);
    for (const [name, value] of Object.entries(tokens.color)) {
      expect(palette, `tokens.color.${name} is a literal, not a palette reference`).toContain(
        value,
      );
    }
  });

  it('keeps body type at 16 or above for outdoor legibility', () => {
    expect(tokens.typography.body.size).toBeGreaterThanOrEqual(16);
  });
});

describe('required contrast pairs', () => {
  it.each(requiredContrastPairs)('$name meets AA for $usage', (pair) => {
    const result = evaluateContrast(pair.foreground, pair.background, pair.usage);
    expect(
      result.passes,
      `${pair.name}: ${formatRatio(result.ratio)} against a ${String(result.minimum)}:1 minimum`,
    ).toBe(true);
  });
});

/**
 * Phase 1 §03 is titled "DM Sans, 400 minimum, no exceptions", and for the first
 * three phases the app shipped in Roboto: every size, weight and tracking value
 * matched the scale and no face was ever loaded. Nothing caught it, because the
 * platform font at the right size looks like a deliberate choice.
 */
describe('the typeface', () => {
  it('has a family for every weight the scale uses', () => {
    // The failure this prevents is silent: `fontFamilyFor` on a weight with no
    // entry returns undefined, React Native falls back to the platform font, and
    // one role in the scale renders in Roboto beside eight in DM Sans.
    // Keyed rather than `Object.entries`, which widens the value to `any` and
    // would let a role with no weight at all slip through this loop untyped.
    const roles = Object.keys(tokens.typography) as (keyof typeof tokens.typography)[];
    expect(roles.length).toBeGreaterThan(0);
    for (const role of roles) {
      expect(fontFamilyFor(tokens.typography[role].weight), role).toMatch(/^DMSans_/u);
    }
  });

  it('names each face by its weight, so Android gets the right one', () => {
    // Android does not synthesise a weight from a family — each weight is a
    // separately registered family, and `fontWeight` alone gets whatever single
    // face the system matched.
    expect(fontFamilyFor('400')).toBe('DMSans_400Regular');
    expect(fontFamilyFor('500')).toBe('DMSans_500Medium');
    expect(fontFamilyFor('600')).toBe('DMSans_600SemiBold');
    expect(fontFamilyFor('700')).toBe('DMSans_700Bold');
  });

  it('carries no DM Sans face below 400, which §03 bans anywhere', () => {
    const weights = Object.keys(tokens.font).filter((key) => /^\d+$/u.test(key));
    expect(weights).toEqual(['400', '500', '600', '700']);
  });

  it('keeps Cormorant out of the weight map, so nothing can reach it by weight', () => {
    // §03: "the one Cormorant moment — login splash only". It is not a weight, so
    // `fontFamilyFor` cannot return it and a screen cannot ask for it by accident.
    // `BrandLine` is the only way in, and packages/ui asserts that separately.
    expect(tokens.font.brand).toBe('CormorantGaramond_500Medium');
    const byWeight = (['400', '500', '600', '700'] as const).map((w) => fontFamilyFor(w));
    expect(byWeight).not.toContain(tokens.font.brand);
  });

  it('gives the brand line the size and weight §03 names, and no other role that size', () => {
    expect(tokens.typography.brand.size).toBe(36);
    expect(tokens.typography.brand.weight).toBe('500');
    // Keyed rather than `Object.entries`, which widens the value to `any`.
    const others = (Object.keys(tokens.typography) as (keyof typeof tokens.typography)[])
      .filter((role) => role !== 'brand')
      .map((role) => tokens.typography[role].size);
    expect(others).not.toContain(36);
  });
});
