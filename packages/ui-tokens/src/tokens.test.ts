import { describe, expect, it } from 'vitest';
import { evaluateContrast, formatRatio } from './contrast.js';
import { brandPalette } from './palette.js';
import { requiredContrastPairs, tokens } from './tokens.js';

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
