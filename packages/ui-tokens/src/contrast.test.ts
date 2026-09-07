import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  evaluateContrast,
  formatRatio,
  meetsContrast,
  parseHexColor,
  relativeLuminance,
} from './contrast.js';

describe('parseHexColor', () => {
  it('reads six-digit hex', () => {
    expect(parseHexColor('#1F5FA9')).toEqual({ r: 31, g: 95, b: 169 });
  });

  it('expands three-digit shorthand to the same colour', () => {
    expect(parseHexColor('#abc')).toEqual(parseHexColor('#aabbcc'));
  });

  it('accepts a missing leading hash', () => {
    expect(parseHexColor('ffffff')).toEqual(parseHexColor('#ffffff'));
  });

  it.each(['', '#', '#12345', 'rgb(0,0,0)', '#gggggg', 'white'])(
    'refuses %s rather than returning a plausible colour',
    (input) => {
      expect(() => parseHexColor(input)).toThrow(/Not a hex colour/);
    },
  );
});

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 10);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
  });

  it('weights green above red above blue', () => {
    // The coefficients are not equal, and a validator that averaged the channels
    // would pass this file's other tests while being wrong on every real colour.
    expect(relativeLuminance('#00ff00')).toBeGreaterThan(relativeLuminance('#ff0000'));
    expect(relativeLuminance('#ff0000')).toBeGreaterThan(relativeLuminance('#0000ff'));
  });
});

describe('contrastRatio', () => {
  it('is exactly 21 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 10);
  });

  it('is exactly 1 for a colour against itself', () => {
    expect(contrastRatio('#1f5fa9', '#1f5fa9')).toBeCloseTo(1, 10);
  });

  it('does not depend on the order of the arguments', () => {
    expect(contrastRatio('#1a1a1a', '#ffffff')).toBeCloseTo(
      contrastRatio('#ffffff', '#1a1a1a'),
      12,
    );
  });

  // These two greys are one 8-bit step apart and straddle the 4.5:1 AA threshold.
  // They are the published reference values for sRGB, and an implementation that
  // rounds, averages channels or skips linearisation misses at least one of them.
  it('measures #767676 on white at 4.54:1 — the lightest grey that passes AA', () => {
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(meetsContrast(contrastRatio('#767676', '#ffffff'), 'text')).toBe(true);
  });

  it('measures #777777 on white at 4.48:1 — one step lighter, and it fails', () => {
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(meetsContrast(contrastRatio('#777777', '#ffffff'), 'text')).toBe(false);
  });
});

describe('meetsContrast', () => {
  it('passes exactly at the threshold and fails just below it', () => {
    expect(meetsContrast(4.5, 'text')).toBe(true);
    expect(meetsContrast(4.4999, 'text')).toBe(false);
  });

  it('applies the lower requirement to large text and to non-text', () => {
    expect(meetsContrast(3, 'large-text')).toBe(true);
    expect(meetsContrast(3, 'non-text')).toBe(true);
    expect(meetsContrast(3, 'text')).toBe(false);
  });

  it('raises the bar at AAA', () => {
    expect(meetsContrast(4.5, 'text', 'AAA')).toBe(false);
    expect(meetsContrast(7, 'text', 'AAA')).toBe(true);
  });

  it('never relaxes the non-text requirement when the level is raised', () => {
    expect(meetsContrast(3, 'non-text', 'AAA')).toBe(true);
  });
});

describe('evaluateContrast', () => {
  it('reports the ratio, the requirement and the verdict together', () => {
    const result = evaluateContrast('#ffffff', '#1f5fa9', 'text');
    expect(result.minimum).toBe(4.5);
    expect(result.passes).toBe(true);
    expect(result.ratio).toBeGreaterThan(4.5);
  });
});

describe('formatRatio', () => {
  it('truncates rather than rounding, so a near miss never displays as a pass', () => {
    expect(formatRatio(4.4996)).toBe('4.49:1');
    expect(formatRatio(21)).toBe('21.00:1');
  });
});
