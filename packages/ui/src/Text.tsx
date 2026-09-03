import type { ReactNode } from 'react';
import { StyleSheet, Text as RnText } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
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
  },
  heading: {
    fontSize: tokens.typography.heading.size,
    lineHeight: tokens.typography.heading.lineHeight,
    fontWeight: tokens.typography.heading.weight,
  },
  body: {
    fontSize: tokens.typography.body.size,
    lineHeight: tokens.typography.body.lineHeight,
    fontWeight: tokens.typography.body.weight,
  },
  label: {
    fontSize: tokens.typography.label.size,
    lineHeight: tokens.typography.label.lineHeight,
    fontWeight: tokens.typography.label.weight,
  },
});

export const Figure = ({ children }: TextProps): ReactNode => {
  const color = useSurfaceInk(false);
  return <RnText style={[styles.figure, { color }]}>{children}</RnText>;
};

/**
 * The one large line a screen is about. Phase 3's consent question, and nothing on
 * a working screen — §03 keeps `figure` for the money role and this for the words.
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
