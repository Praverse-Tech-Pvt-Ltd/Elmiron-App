/**
 * Design tokens and the WCAG contrast validator that guards them.
 *
 * The values in `palette.ts` are a **placeholder**, not the brand's — the brand
 * guideline has not been committed. `tokens.status` says so at runtime. See
 * `brand-specification.ts` for what the guideline specifies and why it cannot be
 * used as given.
 */

export {
  CONTRAST_MINIMUM,
  contrastRatio,
  evaluateContrast,
  formatRatio,
  meetsContrast,
  parseHexColor,
  relativeLuminance,
} from './contrast.js';
export type { ContrastResult, ContrastUsage, Rgb, WcagLevel } from './contrast.js';

export { placeholderPalette } from './palette.js';
export type { PaletteColor } from './palette.js';

export { requiredContrastPairs, tokens } from './tokens.js';
export type {
  ColorTokens,
  ContrastPair,
  DesignTokens,
  RadiusTokens,
  SpaceTokens,
  TypeStyle,
  TypographyTokens,
} from './tokens.js';

export { brandContrastSpecifications } from './brand-specification.js';
export type { BrandContrastSpecification } from './brand-specification.js';
