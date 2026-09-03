import { useState } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { fontFamilyFor, tokens } from '@fieldforce/ui-tokens';
import { Label } from './Text';

/**
 * Phase 1 §05, the whole button.
 *
 * Four variants and no fifth. `primary` is the one action a screen exists for and
 * originates inside the reach zone; `secondary` is a filled wash with no outline;
 * `quiet` is text only; `destructive` is deliberately *outside* the reach zone, so
 * a resting thumb cannot fire it — that placement is the caller's job, but the
 * variant exists so the caller can see which one it is holding.
 *
 * Two rules from §05 that are enforced here rather than described:
 *
 * - **Press darkens the fill. It never scales and never lightens.** The old
 *   implementation faded the button with `opacity: 0.75`, which over warm paper
 *   lightens it — the opposite of what the design says, and on a mid-range Android
 *   a scale transform drops frames and reads as lag.
 * - **A disabled button always carries a reason line.** `disabled` and `note` are
 *   a union below, so `disabled` without a `note` does not typecheck. §05 exempts
 *   the disabled label from contrast (2.37:1) *because* the reason line is there
 *   to carry the meaning; the exemption without the line is just an unreadable
 *   button.
 *
 * Loading keeps the container and swaps the label, so the width holds — a button
 * that shrinks mid-tap moves the next control under the thumb.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'destructive';

interface ButtonBase {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: ButtonVariant;
  /**
   * Swaps the label and blocks the press. The container does not resize.
   */
  readonly loading?: boolean;
  /** Shown in place of `label` while loading. Defaults to the label. */
  readonly loadingLabel?: string;
}

export type ButtonProps = ButtonBase &
  (
    | {
        readonly disabled: true;
        /** Mandatory when disabled. Says why, so the greyed label is not the only signal. */
        readonly note: string;
      }
    | {
        readonly disabled?: false;
        /**
         * Optional supporting line — "will sync later" under an offline check-in.
         * Not an error state and never styled as one.
         */
        readonly note?: string;
      }
  );

const styles = StyleSheet.create({
  group: { gap: tokens.space.xs },
  // The ring lives on a wrapper that always reserves its 3px, transparent when
  // unfocused, so focus does not reflow the layout. §05: ring 3px, offset 3.
  ring: {
    borderWidth: 3,
    borderColor: 'transparent',
    borderRadius: tokens.radius.control + 3,
    padding: 3,
  },
  ringFocused: { borderColor: tokens.color.accent },
  base: {
    borderRadius: tokens.radius.control,
    paddingHorizontal: tokens.space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: tokens.space.sm,
  },
  primary: { backgroundColor: tokens.color.accent, minHeight: tokens.target.primary },
  primaryPressed: { backgroundColor: tokens.color.accentPressed },
  secondary: { backgroundColor: tokens.color.wash, minHeight: tokens.target.secondary },
  secondaryPressed: { backgroundColor: tokens.color.washPressed },
  quiet: { backgroundColor: 'transparent', minHeight: tokens.target.secondary },
  quietPressed: { backgroundColor: tokens.color.wash },
  destructive: { backgroundColor: 'transparent', minHeight: tokens.target.secondary },
  destructivePressed: { backgroundColor: tokens.color.criticalFill },
  disabled: { opacity: 0.5 },
  label: {
    fontSize: tokens.typography.control.size,
    lineHeight: tokens.typography.control.lineHeight,
    fontWeight: tokens.typography.control.weight,
    fontFamily: fontFamilyFor(tokens.typography.control.weight),
  },
  onAccent: { color: tokens.color.onAccent },
  onWash: { color: tokens.color.textPrimary },
  onQuiet: { color: tokens.color.accent },
  onDestructive: { color: tokens.color.critical },
});

const FILL = {
  primary: styles.primary,
  secondary: styles.secondary,
  quiet: styles.quiet,
  destructive: styles.destructive,
} as const;

const PRESSED = {
  primary: styles.primaryPressed,
  secondary: styles.secondaryPressed,
  quiet: styles.quietPressed,
  destructive: styles.destructivePressed,
} as const;

/**
 * The resolved style for a variant in a given state, as a function rather than
 * inline in the JSX.
 *
 * It is named and exported because it is the rule §05 actually states — press
 * darkens the fill, disabled fades it — and a rule that only exists inside a
 * `Pressable`'s style callback cannot be asserted: React Native's press state is
 * driven by the responder system, which a test cannot flip without simulating a
 * touch stream. Pulling it out here makes "pressed primary is #2F5233" a claim the
 * suite can check directly, on the same code path the component renders through.
 */
export const buttonStyle = (
  variant: ButtonVariant,
  state: { readonly pressed: boolean; readonly disabled: boolean },
): StyleProp<ViewStyle> => [
  styles.base,
  FILL[variant],
  state.pressed ? PRESSED[variant] : null,
  state.disabled ? styles.disabled : null,
];

const INK = {
  primary: styles.onAccent,
  secondary: styles.onWash,
  quiet: styles.onQuiet,
  destructive: styles.onDestructive,
} as const;

export const Button = ({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  loadingLabel,
  note,
}: ButtonProps): ReactNode => {
  const [focused, setFocused] = useState(false);
  const inert = disabled || loading;

  /**
   * The focus ring is for keyboard navigation, which means the console — not a
   * phone.
   *
   * On Android the first focusable view in a window takes focus on mount, so a
   * touch-platform ring paints itself around whichever control happens to be first
   * and never moves. That reads as emphasis. On the permission screens it would
   * silently undo the thing they are built to guarantee: "Allow" and "Not now" are
   * weighted identically, and a ring on the first one is the app leaning on an
   * answer after saying it would not.
   *
   * Nobody tabs through a phone screen, so nothing is lost by scoping it to web,
   * where the ring is doing real work.
   */
  const ringVisible = focused && Platform.OS === 'web';

  return (
    <View style={styles.group}>
      <View style={[styles.ring, ringVisible ? styles.ringFocused : null]}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: inert, busy: loading }}
          disabled={inert}
          onBlur={() => {
            setFocused(false);
          }}
          onFocus={() => {
            setFocused(true);
          }}
          onPress={onPress}
          style={({ pressed }) => buttonStyle(variant, { pressed, disabled })}
        >
          {loading ? (
            <ActivityIndicator
              color={variant === 'primary' ? tokens.color.onAccent : tokens.color.accent}
              size="small"
            />
          ) : null}
          <Text style={[styles.label, INK[variant]]}>
            {loading ? (loadingLabel ?? label) : label}
          </Text>
        </Pressable>
      </View>
      {note === undefined ? null : <Label muted>{note}</Label>}
    </View>
  );
};
