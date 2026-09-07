import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Label } from './Text';

export interface SpinnerProps {
  /** Said aloud by a screen reader, so it names what is happening. */
  readonly label: string;
}

const styles = StyleSheet.create({
  group: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm },
});

export const Spinner = ({ label }: SpinnerProps): ReactNode => (
  <View accessibilityLabel={label} accessibilityRole="progressbar" style={styles.group}>
    <ActivityIndicator color={tokens.color.accent} />
    <Label muted>{label}</Label>
  </View>
);
