import type { ReactNode } from 'react';
import { StyleSheet, Text as RnText } from 'react-native';
import { fontFamilyFor, tokens } from '@fieldforce/ui-tokens';
import { useSurfaceInk } from './surface';

export interface TextProps {
  readonly children: ReactNode;
  /** Secondary tone for supporting copy. Never used to signal failure. */
  readonly muted?: boolean;
}

/**
 * Colour comes from `useSurfaceInk`, not from the stylesheet, because the same
 * heading is ink on paper and white inside a hero card. Everything else — size,
 * line height, weight — is fixed by the scale and does not vary by surface.
 */
const styles = StyleSheet.create({
  /**
   * §03's largest role: "the money figure. One per screen." Tracked in tight and
   * tabular, because it is read at a glance while walking and a figure whose digits
   * change width jitters as it updates.
   */
  figure: {
    fontSize: tokens.typography.figure.size,
    lineHeight: tokens.typography.figure.lineHeight,
    fontWeight: tokens.typography.figure.weight,
    fontFamily: fontFamilyFor(tokens.typography.figure.weight),
    letterSpacing: tokens.typography.figure.letterSpacing,
    fontVariant: ['tabular-nums'],
  },
  /**
   * §03's 30/600/−.035. Phase 3 asks for 35px on the consent question; this is the
   * largest step the committed scale has below `figure`, and `figure` is the money
   * role with tabular digits. Taking the existing step rather than inventing a
   * thirty-fifth size is the same discipline `tokens.ts` enforces for colour.
   */
  display: {
    fontSize: tokens.typography.display.size,
    lineHeight: tokens.typography.display.lineHeight,
    fontWeight: tokens.typography.display.weight,
    fontFamily: fontFamilyFor(tokens.typography.display.weight),
    letterSpacing: tokens.typography.display.letterSpacing,
  },
  /**
   * §03's 19/400 — "the value inside an input, larger than body on purpose".
   *
   * Phase 3 runs body at 19–22px on the consent face because "the doctor reads at
   * their arm's length, across a desk, possibly without reading glasses". That is
   * the same argument §05 already made for the input value, so it is the same step.
   */
  statement: {
    fontSize: tokens.typography.value.size,
    lineHeight: tokens.typography.value.lineHeight,
    fontWeight: tokens.typography.value.weight,
    fontFamily: fontFamilyFor(tokens.typography.value.weight),
  },
  /** §03's 27/600 — the title of a day screen, as Phase 2 draws B1, B3, C1, C5, C6 and B7. */
  title: {
    fontSize: tokens.typography.title.size,
    lineHeight: tokens.typography.title.lineHeight,
    fontWeight: tokens.typography.title.weight,
    fontFamily: fontFamilyFor(tokens.typography.title.weight),
    letterSpacing: tokens.typography.title.letterSpacing,
  },
  heading: {
    fontSize: tokens.typography.heading.size,
    lineHeight: tokens.typography.heading.lineHeight,
    fontWeight: tokens.typography.heading.weight,
    fontFamily: fontFamilyFor(tokens.typography.heading.weight),
  },
  body: {
    fontSize: tokens.typography.body.size,
    lineHeight: tokens.typography.body.lineHeight,
    fontWeight: tokens.typography.body.weight,
    fontFamily: fontFamilyFor(tokens.typography.body.weight),
  },
  label: {
    fontSize: tokens.typography.label.size,
    lineHeight: tokens.typography.label.lineHeight,
    fontWeight: tokens.typography.label.weight,
    fontFamily: fontFamilyFor(tokens.typography.label.weight),
  },
});

export const Figure = ({ children }: TextProps): ReactNode => {
  const color = useSurfaceInk(false);
  return <RnText style={[styles.figure, { color }]}>{children}</RnText>;
};

/**
 * The one large line a screen is about. Phase 3's consent question, and nothing on
 * a working screen — §03 keeps `figure` for the money role and this for the words.
 *
 * FE-D7 4: also the title of a first-run screen (A2–A9, S4) and of a visit (B5), which Phase 2
 * draws at 29–32px. A day screen's title is `Title`.
 */
export const Display = ({ children }: TextProps): ReactNode => {
  const color = useSurfaceInk(false);
  return <RnText style={[styles.display, { color }]}>{children}</RnText>;
};

/**
 * Body copy for someone who is not holding the phone.
 *
 * Used on the consent face and nowhere else so far. `BodyText` stays 16 for the MR,
 * who is looking at their own screen from 30cm; this is for the doctor across a
 * desk.
 */
export const Statement = ({ children, muted = false }: TextProps): ReactNode => {
  const color = useSurfaceInk(muted);
  return <RnText style={[styles.statement, { color }]}>{children}</RnText>;
};

/**
 * FE-D7 4. What a day screen is — "Thursday", "Today's route", "Your report". The first line on
 * the screen, at the size the design gives it. `Heading` stays for sections inside a screen.
 */
export const Title = ({ children }: TextProps): ReactNode => {
  const color = useSurfaceInk(false);
  return <RnText style={[styles.title, { color }]}>{children}</RnText>;
};

export const Heading = ({ children }: TextProps): ReactNode => {
  const color = useSurfaceInk(false);
  return <RnText style={[styles.heading, { color }]}>{children}</RnText>;
};

export const BodyText = ({ children, muted = false }: TextProps): ReactNode => {
  const color = useSurfaceInk(muted);
  return <RnText style={[styles.body, { color }]}>{children}</RnText>;
};

export const Label = ({ children, muted = false }: TextProps): ReactNode => {
  const color = useSurfaceInk(muted);
  return <RnText style={[styles.label, { color }]}>{children}</RnText>;
};
