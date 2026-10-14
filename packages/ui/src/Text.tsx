import type { ReactNode } from 'react';
import { StyleSheet, Text as RnText } from 'react-native';
import { fontFamilyFor, tokens } from '@fieldforce/ui-tokens';
import { useSurfaceInk } from './surface';

export interface TextProps {
  readonly children: ReactNode;
  /** Secondary tone for supporting copy. Never used to signal failure. */
  readonly muted?: boolean;
  /**
   * `FE-W184`. Centre the lines, for text in a centred column: the column centres the text's box,
   * and without this a second line wrapped under it starts at the box's left edge.
   */
  readonly center?: boolean;
}

/**
 * `FE-W179`. The most a line that sits in a FIXED size may grow with Android's font size: the
 * figure and the display line (already the largest things on a screen), a tab label in a bar of
 * fixed height, a glyph drawn in a fixed box. Android 14 lets the setting reach 200%: uncapped, the
 * 40pt money figure would be 80pt and the call report's tick would stand out of its 24pt box.
 * Capped, they still grow by 30%. Ordinary text is never capped — growing it is what the setting
 * is for.
 */
export const MAX_FONT_SCALE = 1.3;

/**
 * Colour comes from `useSurfaceInk`, not from the stylesheet, because the same
 * heading is ink on paper and white inside a hero card. Everything else — size,
 * line height, weight — is fixed by the scale and does not vary by surface.
 *
 * `FE-W179`. Every role carries `flexShrink: 1`. In a ROW — a glyph and a sentence, a name and a
 * time — React Native measures text at its one-line width and, without it, runs a long doctor's
 * name or a translated sentence past the card's edge on a 360dp phone or at a large font size
 * instead of wrapping it. In a column whose height comes from its content it changes nothing; only
 * a column too short for what it holds — a screen that does not scroll, overflowing — would now
 * squeeze its text rather than run it off the bottom, and that screen should scroll.
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
    flexShrink: 1,
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
    flexShrink: 1,
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
    flexShrink: 1,
  },
  /** §03's 27/600 — the title of a day screen, as Phase 2 draws B1, B3, C1, C5, C6 and B7. */
  title: {
    fontSize: tokens.typography.title.size,
    lineHeight: tokens.typography.title.lineHeight,
    fontWeight: tokens.typography.title.weight,
    fontFamily: fontFamilyFor(tokens.typography.title.weight),
    flexShrink: 1,
    letterSpacing: tokens.typography.title.letterSpacing,
  },
  heading: {
    fontSize: tokens.typography.heading.size,
    lineHeight: tokens.typography.heading.lineHeight,
    fontWeight: tokens.typography.heading.weight,
    fontFamily: fontFamilyFor(tokens.typography.heading.weight),
    flexShrink: 1,
  },
  body: {
    fontSize: tokens.typography.body.size,
    lineHeight: tokens.typography.body.lineHeight,
    fontWeight: tokens.typography.body.weight,
    fontFamily: fontFamilyFor(tokens.typography.body.weight),
    flexShrink: 1,
  },
  secondary: {
    fontSize: tokens.typography.secondary.size,
    lineHeight: tokens.typography.secondary.lineHeight,
    fontWeight: tokens.typography.secondary.weight,
    fontFamily: fontFamilyFor(tokens.typography.secondary.weight),
    flexShrink: 1,
  },
  label: {
    fontSize: tokens.typography.label.size,
    lineHeight: tokens.typography.label.lineHeight,
    fontWeight: tokens.typography.label.weight,
    fontFamily: fontFamilyFor(tokens.typography.label.weight),
    flexShrink: 1,
  },
  center: { textAlign: 'center' },
  tappable: {
    fontSize: tokens.typography.tappable.size,
    lineHeight: tokens.typography.tappable.lineHeight,
    fontWeight: tokens.typography.tappable.weight,
    fontFamily: fontFamilyFor(tokens.typography.tappable.weight),
    flexShrink: 1,
  },
});

export const Figure = ({ children, center = false }: TextProps): ReactNode => {
  const color = useSurfaceInk(false);
  return (
    <RnText
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      style={[styles.figure, { color }, center ? styles.center : null]}
    >
      {children}
    </RnText>
  );
};

/**
 * The one large line a screen is about. Phase 3's consent question, and nothing on
 * a working screen — §03 keeps `figure` for the money role and this for the words.
 *
 * FE-D7 4: also the title of a first-run screen (A2–A9, S4) and of a visit (B5), which Phase 2
 * draws at 29–32px. A day screen's title is `Title`.
 */
export const Display = ({ children, center = false }: TextProps): ReactNode => {
  const color = useSurfaceInk(false);
  return (
    <RnText
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      style={[styles.display, { color }, center ? styles.center : null]}
    >
      {children}
    </RnText>
  );
};

/**
 * Body copy for someone who is not holding the phone.
 *
 * Used on the consent face and nowhere else so far. `BodyText` stays 16 for the MR,
 * who is looking at their own screen from 30cm; this is for the doctor across a
 * desk.
 */
export const Statement = ({ children, muted = false, center = false }: TextProps): ReactNode => {
  const color = useSurfaceInk(muted);
  return (
    <RnText style={[styles.statement, { color }, center ? styles.center : null]}>{children}</RnText>
  );
};

/**
 * FE-D7 4. What a day screen is — "Thursday", "Today's route", "Your report". The first line on
 * the screen, at the size the design gives it. `Heading` stays for sections inside a screen.
 */
export const Title = ({ children, center = false }: TextProps): ReactNode => {
  const color = useSurfaceInk(false);
  return (
    <RnText style={[styles.title, { color }, center ? styles.center : null]}>{children}</RnText>
  );
};

/**
 * The title of a THING on the screen — a card, a doctor, a sheet, an empty state. Not a section
 * header: `FE-W178`, see `Label`.
 */
export const Heading = ({ children, center = false }: TextProps): ReactNode => {
  const color = useSurfaceInk(false);
  return (
    <RnText style={[styles.heading, { color }, center ? styles.center : null]}>{children}</RnText>
  );
};

export const BodyText = ({ children, muted = false, center = false }: TextProps): ReactNode => {
  const color = useSurfaceInk(muted);
  return (
    <RnText style={[styles.body, { color }, center ? styles.center : null]}>{children}</RnText>
  );
};

/**
 * §03's 14.5/400 — supporting PROSE: a help paragraph, a card's detail line, "31.7 km · on this
 * month's claim". The step existed in the scale and no component rendered it, so every
 * explanation fell to `Label` at 13.5 — the size for a field's name, too small to read a sentence
 * outdoors. `Label` stays for labels.
 */
export const Secondary = ({ children, muted = true, center = false }: TextProps): ReactNode => {
  const color = useSurfaceInk(muted);
  return (
    <RnText style={[styles.secondary, { color }, center ? styles.center : null]}>{children}</RnText>
  );
};

/**
 * §03's 13.5/500 — a field's name, a caption over a figure, a time beside a row. Never a sentence
 * (that is `Secondary`) and never pressed (that is `TapLabel`).
 *
 * `FE-W178`. **An in-screen section header is `<Label muted>`.** The designs draw every one at
 * 13.5/500 in the muted ink — "Your Thursday", "Products discussed", "Added today", "One thing to try
 * next time" — and the screens had drifted to three different roles for the same job.
 */
export const Label = ({ children, muted = false, center = false }: TextProps): ReactNode => {
  const color = useSurfaceInk(muted);
  return (
    <RnText style={[styles.label, { color }, center ? styles.center : null]}>{children}</RnText>
  );
};

/**
 * `FE-W177`. The words on a small control — a filter chip, "Mark done", a vendor shortcut, a
 * toast's action. 14/500, because Phase 1 bans a tappable label below 14 and `Label` is 13.5. It
 * reads the surface like every other role, so a selected chip on the accent fill is white.
 */
export const TapLabel = ({ children, muted = false, center = false }: TextProps): ReactNode => {
  const color = useSurfaceInk(muted);
  return (
    <RnText style={[styles.tappable, { color }, center ? styles.center : null]}>{children}</RnText>
  );
};
