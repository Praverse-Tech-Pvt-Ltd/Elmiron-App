import type { ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';

/**
 * Phase 1 §03's single Cormorant moment, and the only component allowed to use it.
 *
 * > "The one Cormorant moment. Login splash only, weight 500 at 36px. **Not a
 * > screen title, not a section header, not an empty state.** Italiana has zero
 * > product use."
 *
 * That is a constraint on where this renders, and a component is the only way to
 * enforce it: the face is not in `tokens.font`'s weight map, so `fontFamilyFor`
 * cannot return it and no stylesheet can reach it by asking for a weight.
 * `brand-line.test.tsx` asserts that this file is the only one in the package that
 * names the family.
 *
 * **The words are the caller's, and the caller is the sign-in screen.** The line
 * itself is not hard-coded here because it is brand copy rather than product copy,
 * and `docs/brand-identifier-decision.md` keeps branding a value the brand owner
 * can change without an engineer — the same reason `app.config.ts` reads the
 * display name from the environment.
 */
export interface BrandLineProps {
  readonly children: ReactNode;
}

const styles = StyleSheet.create({
  line: {
    fontSize: tokens.typography.brand.size,
    lineHeight: tokens.typography.brand.lineHeight,
    fontWeight: tokens.typography.brand.weight,
    fontFamily: tokens.font.brand,
    color: tokens.color.accent,
  },
});

export const BrandLine = ({ children }: BrandLineProps): ReactNode => (
  // Not a heading. `accessibilityRole="header"` here would make a brand line the
  // first landmark a screen reader announces on the sign-in screen, ahead of the
  // thing the MR came to do.
  <Text style={styles.line}>{children}</Text>
);
