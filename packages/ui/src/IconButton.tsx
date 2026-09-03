import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';

/**
 * A 52pt square control. Phase 1 §05: "always has a text label somewhere on
 * screen".
 *
 * That rule is why `label` is required and is not optional the way an
 * `accessibilityLabel` usually is. A glyph alone is ambiguous to everyone — a
 * screen reader, a new MR, and the same MR in a hurry — so the label is both the
 * accessible name and the caller's reminder that a visible one belongs nearby.
 *
 * `active` is a state, not a variant: the same control, currently on. It fills with
 * the accent rather than changing shape, and press still darkens from wherever it
 * started.
 */
export interface IconButtonProps {
  /** The glyph. A single character or short ligature — this package ships no icon set. */
  readonly glyph: string;
  /** Names the action. Required: §05 forbids a glyph with no words anywhere. */
  readonly label: string;
  readonly onPress: () => void;
  /** Currently on — a toggled filter, a running timer. */
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly loading?: boolean;
}

const styles = StyleSheet.create({
  base: {
    width: tokens.target.secondary,
    height: tokens.target.secondary,
    borderRadius: tokens.radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tokens.color.wash,
  },
  pressed: { backgroundColor: tokens.color.washPressed },
  active: { backgroundColor: tokens.color.accent },
  activePressed: { backgroundColor: tokens.color.accentPressed },
  disabled: { opacity: 0.5 },
  glyph: {
    fontSize: tokens.typography.control.size,
    lineHeight: tokens.typography.control.lineHeight,
    fontWeight: tokens.typography.control.weight,
    color: tokens.color.textPrimary,
  },
  glyphActive: { color: tokens.color.onAccent },
});

export const IconButton = ({
  glyph,
  label,
  onPress,
  active = false,
  disabled = false,
  loading = false,
}: IconButtonProps): ReactNode => {
  const inert = disabled || loading;

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, selected: active, busy: loading }}
      disabled={inert}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        active ? styles.active : null,
        pressed ? (active ? styles.activePressed : styles.pressed) : null,
        disabled ? styles.disabled : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={active ? tokens.color.onAccent : tokens.color.accent}
          size="small"
        />
      ) : (
        <Text style={[styles.glyph, active ? styles.glyphActive : null]}>{glyph}</Text>
      )}
    </Pressable>
  );
};
