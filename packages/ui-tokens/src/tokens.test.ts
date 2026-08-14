import { describe, expect, it } from 'vitest';
import { evaluateContrast, formatRatio } from './contrast.js';
import { placeholderPalette } from './palette.js';
import { requiredContrastPairs, tokens } from './tokens.js';

describe('tokens', () => {
  it('is labelled a placeholder, because it is', () => {
    // Flips to 'brand' in the same change that replaces palette.ts. Until then a
    // consumer can tell the difference, and so can a reviewer reading a screenshot.
    expect(tokens.status).toBe('placeholder');
  });

  it('draws every colour from the palette, so a brand swap is one file', () => {
    const palette: readonly string[] = Object.values(placeholderPalette);
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
