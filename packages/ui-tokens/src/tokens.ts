/**
 * Design tokens.
 *
 * Structure first, values second. Every colour below is a reference into
 * `palette.ts`, so replacing the placeholder palette with the brand's is a
 * one-file change and nothing here moves. `tokens.test.ts` asserts that property
 * mechanically — a colour literal written directly into this file fails the build.
 *
 * `requiredContrastPairs` is the list of pairs that have a WCAG obligation. It is
 * not documentation: every entry is checked on every test run, so a palette swap
 * that introduces an inaccessible pair goes red here rather than reaching a screen.
 */

import type { ContrastUsage } from './contrast.js';
import { placeholderPalette } from './palette.js';

export interface ColorTokens {
  /** The page ground. */
  readonly background: string;
  /** Raised surfaces — cards, sheets, list rows. */
  readonly surface: string;
  /** Component boundaries. Decorative separators have no contrast obligation. */
  readonly border: string;
  readonly textPrimary: string;
  readonly textSecondary: string;
  /** Primary action fill. */
  readonly accent: string;
  /** Label on `accent`. */
  readonly onAccent: string;
  /**
   * Genuine failures only — a rejected sync item, a lost upload.
   *
   * **Never for a declined consent.** All three consent outcomes are successful
   * completions of a visit; colouring `declined` as an error is the dark pattern
   * that collapses the legal basis for recording. See `docs/frontendplanv2.md` §3.2.
   */
  readonly critical: string;
}

export interface SpaceTokens {
  readonly xs: number;
  readonly sm: number;
  readonly md: number;
  readonly lg: number;
  readonly xl: number;
}

export interface RadiusTokens {
  readonly sm: number;
  readonly md: number;
  readonly pill: number;
}

export interface TypeStyle {
  readonly size: number;
  readonly lineHeight: number;
  readonly weight: '400' | '500' | '600' | '700';
}

export interface TypographyTokens {
  readonly heading: TypeStyle;
  readonly body: TypeStyle;
  readonly label: TypeStyle;
}

export interface DesignTokens {
  /**
   * `placeholder` until the brand guideline is committed and `palette.ts` is
   * replaced. Carried on the object so a consumer can assert it, and so nobody
   * mistakes these values for the brand's.
   */
  readonly status: 'placeholder' | 'brand';
  readonly color: ColorTokens;
  readonly space: SpaceTokens;
  readonly radius: RadiusTokens;
  readonly typography: TypographyTokens;
}

export const tokens: DesignTokens = {
  status: 'placeholder',
  color: {
    background: placeholderPalette.white,
    surface: placeholderPalette.neutral050,
    border: placeholderPalette.neutral200,
    textPrimary: placeholderPalette.neutral900,
    textSecondary: placeholderPalette.neutral600,
    accent: placeholderPalette.blue700,
    onAccent: placeholderPalette.white,
    critical: placeholderPalette.red700,
  },
  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { sm: 4, md: 8, pill: 999 },
  // Body type is not smaller than 16. An MR reads this outdoors on a mid-range
  // Android at partial brightness; the sunlight audit in FE-W7 is the check, but
  // starting below 16 guarantees rework. Placeholder values, like the colours.
  typography: {
    heading: { size: 22, lineHeight: 28, weight: '600' },
    body: { size: 16, lineHeight: 24, weight: '400' },
    label: { size: 14, lineHeight: 20, weight: '500' },
  },
};

export interface ContrastPair {
  readonly name: string;
  readonly foreground: string;
  readonly background: string;
  readonly usage: ContrastUsage;
}

/** Every pair with a WCAG obligation, checked on every test run. */
export const requiredContrastPairs: readonly ContrastPair[] = [
  {
    name: 'primary text on background',
    foreground: tokens.color.textPrimary,
    background: tokens.color.background,
    usage: 'text',
  },
  {
    name: 'primary text on surface',
    foreground: tokens.color.textPrimary,
    background: tokens.color.surface,
    usage: 'text',
  },
  {
    name: 'secondary text on background',
    foreground: tokens.color.textSecondary,
    background: tokens.color.background,
    usage: 'text',
  },
  {
    name: 'secondary text on surface',
    foreground: tokens.color.textSecondary,
    background: tokens.color.surface,
    usage: 'text',
  },
  {
    name: 'primary button label on primary button fill',
    foreground: tokens.color.onAccent,
    background: tokens.color.accent,
    usage: 'text',
  },
  {
    name: 'primary button fill against the page',
    foreground: tokens.color.accent,
    background: tokens.color.background,
    usage: 'non-text',
  },
  {
    name: 'critical text on background',
    foreground: tokens.color.critical,
    background: tokens.color.background,
    usage: 'text',
  },
];
