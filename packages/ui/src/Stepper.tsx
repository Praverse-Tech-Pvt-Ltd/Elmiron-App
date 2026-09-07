import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fontFamilyFor, tokens } from '@fieldforce/ui-tokens';
import { Figure, Label } from './Text';

/**
 * A quantity control sized for a doorway.
 *
 * C5's note is the whole specification: "Big stepper because it is used one-handed
 * in a doorway." The targets take `tokens.target.inVisit`, whose own definition is
 * "pressed while walking, in a corridor, without looking" — the design draws 54pt,
 * the token says 66, and the token is the Phase 1 rule the design is an instance
 * of. Nothing in this app is measured in pixel literals.
 *
 * **There is no text input for the number, and that is deliberate.** A numeric
 * keyboard over a value this small covers half the screen and costs two more taps
 * than the plus key it replaces. It also admits values a stepper cannot produce —
 * "-3", "1e5", an empty string — every one of which then has to be defended
 * against in the caller. Bounds are enforced here instead, which is the difference
 * between a control that cannot be wrong and a form that validates afterwards.
 *
 * **`max` is honoured but never invented.** When a caller has a real ceiling it
 * passes one and the plus key goes disabled with a reason; when nobody has told
 * the app what the ceiling is, there is no `max` and the key stays live. A limit
 * guessed on the device is worse than no limit, because the MR believes it.
 */
export interface StepperProps {
  readonly label: string;
  readonly value: number;
  readonly onChange: (value: number) => void;
  /** Floor. Defaults to 1 — a handover of nothing is not a handover. */
  readonly min?: number;
  /** Ceiling. Omit when nothing authoritative has supplied one. */
  readonly max?: number;
  /** Why the value cannot go higher. Required alongside `max`, shown when at it. */
  readonly maxNote?: string;
  readonly disabled?: boolean;
}

const styles = StyleSheet.create({
  group: { gap: tokens.space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.md },
  key: {
    width: tokens.target.inVisit,
    height: tokens.target.inVisit,
    borderRadius: tokens.radius.control,
    backgroundColor: tokens.color.wash,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Press darkens the fill, exactly as §05 requires of every other control here.
  keyPressed: { backgroundColor: tokens.color.washPressed },
  keyDisabled: { opacity: 0.5 },
  glyph: {
    fontSize: tokens.typography.figure.size / 2,
    fontFamily: fontFamilyFor(tokens.typography.figure.weight),
    lineHeight: tokens.typography.figure.size,
    color: tokens.color.textPrimary,
  },
  value: { flex: 1, alignItems: 'center' },
});

/**
 * The minus and plus signs.
 *
 * U+2212 MINUS SIGN rather than a hyphen: the hyphen is half the width of the plus
 * and the pair reads as lopsided at this size. Both are in the Latin-1 and
 * General Punctuation blocks every OEM font on this project's device list ships,
 * which is the same constraint the queue screen's glyph allowlist exists for.
 */
const MINUS = '−';
const PLUS = '+';

export const Stepper = ({
  label,
  value,
  onChange,
  min = 1,
  max,
  maxNote,
  disabled = false,
}: StepperProps): ReactNode => {
  const atMin = value <= min;
  const atMax = max !== undefined && value >= max;

  const key = (
    glyph: string,
    accessibilityLabel: string,
    inert: boolean,
    next: number,
  ): ReactNode => (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: inert }}
      disabled={inert}
      onPress={() => {
        onChange(next);
      }}
      style={({ pressed }) => [
        styles.key,
        pressed ? styles.keyPressed : null,
        inert ? styles.keyDisabled : null,
      ]}
    >
      <Text style={styles.glyph}>{glyph}</Text>
    </Pressable>
  );

  return (
    <View style={styles.group}>
      <Label muted>{label}</Label>
      <View style={styles.row}>
        {key(MINUS, `One fewer ${label}`, disabled || atMin, value - 1)}
        {/*
          The count is announced as text as well as drawn, because `Figure` is the
          only thing on the row carrying the value and a screen reader landing on
          two buttons with nothing between them has been told nothing.
        */}
        <View accessibilityLabel={`${label}: ${String(value)}`} accessible style={styles.value}>
          <Figure>{String(value)}</Figure>
        </View>
        {key(PLUS, `One more ${label}`, disabled || atMax, value + 1)}
      </View>
      {atMax && maxNote !== undefined ? <Label muted>{maxNote}</Label> : null}
    </View>
  );
};
