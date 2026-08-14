/**
 * WCAG 2.2 contrast validation.
 *
 * This exists because the brand guideline ships a primary button at **2.54:1**,
 * which fails every WCAG level, and a badge at **4.33:1**, which fails AA for
 * normal text. Correcting those per screen is a full visual re-review; correcting
 * them once, here, is a token change. See `brand-specification.ts` for the control
 * that keeps the failing values out.
 *
 * The maths is the WCAG definition, not an approximation:
 *   - linearise each sRGB channel,
 *   - weight them 0.2126 / 0.7152 / 0.0722 to get relative luminance,
 *   - ratio = (lighter + 0.05) / (darker + 0.05).
 *
 * Nothing here knows about this app. It takes colours and returns numbers.
 */

/** sRGB channel values, 0–255. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const HEX_PATTERN = /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu;

export const parseHexColor = (color: string): Rgb => {
  if (!HEX_PATTERN.test(color)) {
    throw new Error(`Not a hex colour: ${JSON.stringify(color)}. Expected #rgb or #rrggbb.`);
  }

  const hex = color.startsWith('#') ? color.slice(1) : color;
  const full =
    hex.length === 3
      ? Array.from(hex, (channel) => `${channel}${channel}`).join('')
      : hex.toLowerCase();

  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
};

/**
 * WCAG uses 0.03928 as the linearisation cut-off. The sRGB standard says 0.04045;
 * the difference is below one 8-bit step and WCAG's number is the one the success
 * criterion is written against, so that is the one used here.
 */
const toLinear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** Relative luminance, 0 (black) to 1 (white). */
export const relativeLuminance = (color: string): number => {
  const { r, g, b } = parseHexColor(color);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
};

/** Contrast ratio between two colours, 1 (identical) to 21 (black on white). */
export const contrastRatio = (a: string, b: string): number => {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

export type WcagLevel = 'AA' | 'AAA';

/**
 * `large-text` is 18.66px bold or 24px regular and above (WCAG 1.4.3).
 * `non-text` covers UI component boundaries and graphical objects (1.4.11) — a
 * button's fill against the page, an input's border. Purely decorative separators
 * are exempt and are not asserted anywhere in this package.
 */
export type ContrastUsage = 'text' | 'large-text' | 'non-text';

/**
 * 1.4.11 (non-text) has no AAA level; the AA requirement is repeated under AAA so
 * that raising the level never silently relaxes a requirement.
 */
export const CONTRAST_MINIMUM = {
  AA: { text: 4.5, 'large-text': 3, 'non-text': 3 },
  AAA: { text: 7, 'large-text': 4.5, 'non-text': 3 },
} as const satisfies Record<WcagLevel, Record<ContrastUsage, number>>;

export const meetsContrast = (
  ratio: number,
  usage: ContrastUsage,
  level: WcagLevel = 'AA',
): boolean => ratio >= CONTRAST_MINIMUM[level][usage];

export interface ContrastResult {
  readonly ratio: number;
  readonly minimum: number;
  readonly passes: boolean;
}

export const evaluateContrast = (
  foreground: string,
  background: string,
  usage: ContrastUsage,
  level: WcagLevel = 'AA',
): ContrastResult => {
  const ratio = contrastRatio(foreground, background);
  return {
    ratio,
    minimum: CONTRAST_MINIMUM[level][usage],
    passes: meetsContrast(ratio, usage, level),
  };
};

/**
 * For reports and error messages only. **Never compare a formatted ratio** — it is
 * truncated rather than rounded precisely so that 4.4996 reads as "4.49", not as a
 * "4.5" that looks like a pass. Comparisons use the unrounded value.
 */
export const formatRatio = (ratio: number): string =>
  `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;
