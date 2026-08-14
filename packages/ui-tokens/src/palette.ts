/**
 * PLACEHOLDER PALETTE — THESE ARE NOT THE BRAND'S COLOURS.
 *
 * The brand guideline and `docs/design-plan.md` were produced outside the repo and
 * have not been committed. Rather than invent a palette and document the guess —
 * which produces something that looks authoritative and is wrong in a way nobody
 * catches until the client sees it — this file holds deliberately neutral greys and
 * one plain blue, marked as placeholder at every level: the constant name, the
 * `status` field on the tokens object, and this comment.
 *
 * **This is the one file to replace when the brand values arrive.** Everything in
 * `tokens.ts` refers to these names, so a swap here is the whole change. The
 * contrast pairs in `tokens.ts` are asserted by `tokens.test.ts`, so brand values
 * that fail WCAG will fail the build rather than reaching a screen.
 */

export const placeholderPalette = {
  white: '#ffffff',
  neutral050: '#f5f5f5',
  neutral200: '#e0e0e0',
  neutral600: '#4a4a4a',
  neutral900: '#1a1a1a',
  blue700: '#1f5fa9',
  red700: '#b3261e',
} as const;

export type PaletteColor = keyof typeof placeholderPalette;
