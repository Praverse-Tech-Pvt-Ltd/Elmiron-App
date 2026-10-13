import { describe, expect, it } from 'vitest';
import { evaluateContrast, formatRatio } from './contrast.js';
import { brandPalette } from './palette.js';
import { fontFamilyFor, requiredContrastPairs, tokens, withAlpha } from './tokens.js';

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

/**
 * Depth and motion (FE-W100). The shadows are the design's own values; what is pinned here is the
 * discipline around them — every shadow colour is still a palette colour, a flat surface really is
 * flat, and no animation is long enough to make the MR wait.
 */
describe('elevation', () => {
  const levels = Object.keys(tokens.elevation) as (keyof typeof tokens.elevation)[];
  const palette: readonly string[] = Object.values(brandPalette);

  it('casts every shadow in a palette colour, at an alpha', () => {
    expect(levels.length).toBeGreaterThan(0);
    for (const level of levels) {
      for (const shadow of tokens.elevation[level].layers) {
        expect(shadow.color, `elevation.${level}`).toMatch(/^#[0-9A-F]{8}$/u);
        // The first seven characters are the colour; the last two are only the alpha.
        expect(palette, `elevation.${level} is cast in a colour outside the palette`).toContain(
          shadow.color.slice(0, 7),
        );
      }
    }
  });

  it('keeps flat surfaces flat — offline is waiting, not arriving (§02)', () => {
    expect(tokens.elevation.flat.layers).toEqual([]);
    expect(tokens.elevation.flat.androidFallback).toBe(0);
  });

  it('gives a list row one small layer, cheap enough for every row of a long list', () => {
    expect(tokens.elevation.hairline.layers).toHaveLength(1);
    for (const shadow of tokens.elevation.hairline.layers) {
      expect(shadow.blurRadius).toBeLessThanOrEqual(4);
    }
  });

  it('casts the dock and the sheet upward, over the content beneath them', () => {
    for (const level of ['dock', 'sheet'] as const) {
      for (const shadow of tokens.elevation[level].layers) {
        expect(shadow.offsetY, level).toBeLessThan(0);
      }
    }
  });

  it('glows the primary action in its own accent, never in grey', () => {
    expect(tokens.elevation.accent.layers.length).toBeGreaterThan(0);
    for (const shadow of tokens.elevation.accent.layers) {
      expect(shadow.color.slice(0, 7)).toBe(brandPalette.accent);
    }
  });

  it('never gives a level a negative fallback or blur', () => {
    for (const level of levels) {
      expect(tokens.elevation[level].androidFallback).toBeGreaterThanOrEqual(0);
      for (const shadow of tokens.elevation[level].layers) {
        expect(shadow.blurRadius).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('makes the scrim from the shadow ink, not a literal', () => {
    expect(tokens.overlay.scrim.slice(0, 7)).toBe(brandPalette.shadow);
  });
});

describe('withAlpha', () => {
  it('appends the alpha as a byte', () => {
    expect(withAlpha('#14150F', 0.4)).toBe('#14150F66');
    expect(withAlpha('#35593a', 1)).toBe('#35593AFF');
    expect(withAlpha('#FFFFFF', 0)).toBe('#FFFFFF00');
  });

  it('refuses anything but #RRGGBB and an alpha in [0, 1]', () => {
    expect(() => withAlpha('#FFF', 0.5)).toThrow();
    expect(() => withAlpha('#14150F66', 0.5)).toThrow();
    expect(() => withAlpha('#14150F', 1.2)).toThrow();
    expect(() => withAlpha('#14150F', Number.NaN)).toThrow();
  });
});

describe('motion', () => {
  it('never makes the MR wait — every duration is under 400ms', () => {
    const { quick, standard, gentle, stagger, pulse } = tokens.motion;
    for (const duration of [quick, standard, gentle, stagger]) {
      expect(duration).toBeGreaterThan(0);
      expect(duration).toBeLessThan(400);
    }
    expect(quick).toBeLessThanOrEqual(standard);
    expect(standard).toBeLessThanOrEqual(gentle);
    // A placeholder's breathing is slow on purpose: under ~600ms a pulse reads as flicker.
    expect(pulse).toBeGreaterThanOrEqual(600);
  });

  it('rises content a few points, not across the screen', () => {
    expect(tokens.motion.rise).toBeGreaterThan(0);
    expect(tokens.motion.rise).toBeLessThanOrEqual(12);
  });
});

describe('the tab bar', () => {
  it('fits a 28pt icon well and a label line, and never drops below the touch floor', () => {
    expect(tokens.target.tabBar).toBeGreaterThanOrEqual(tokens.target.floor);
    expect(tokens.target.tabBar).toBeGreaterThanOrEqual(28 + tokens.typography.label.lineHeight);
  });
});
