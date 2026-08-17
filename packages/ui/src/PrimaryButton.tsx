import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';

export interface PrimaryButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: tokens.color.accent,
    paddingVertical: tokens.space.md,
    paddingHorizontal: tokens.space.lg,
    borderRadius: tokens.radius.md,
    alignItems: 'center',
    // 48dp is the Android touch-target floor. An MR taps this standing in a
    // corridor, one-handed, often in a hurry.
    minHeight: 48,
    justifyContent: 'center',
  },
  // The press state is not decoration: without it a slow screen looks unresponsive
  // and the MR taps again, which is how a duplicate write happens.
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.5 },
  label: {
    color: tokens.color.onAccent,
    fontSize: tokens.typography.body.size,
    lineHeight: tokens.typography.body.lineHeight,
    fontWeight: '600',
  },
});

export const PrimaryButton = ({
  label,
  onPress,
  disabled = false,
}: PrimaryButtonProps): ReactNode => (
  <Pressable
    accessibilityRole="button"
    accessibilityState={{ disabled }}
    disabled={disabled}
    onPress={onPress}
    style={({ pressed }) => [
      styles.base,
      pressed && !disabled ? styles.pressed : null,
      disabled ? styles.disabled : null,
    ]}
  >
    <Text style={styles.label}>{label}</Text>
  </Pressable>
);
