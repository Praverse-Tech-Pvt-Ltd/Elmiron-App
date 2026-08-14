import type { ReactNode } from 'react';
import { StyleSheet, Text as RnText } from 'react-native';
import { tokens } from '@elmiron/ui-tokens';

export interface TextProps {
  readonly children: ReactNode;
  /** Secondary tone for supporting copy. Never used to signal failure. */
  readonly muted?: boolean;
}

const styles = StyleSheet.create({
  heading: {
    color: tokens.color.textPrimary,
    fontSize: tokens.typography.heading.size,
    lineHeight: tokens.typography.heading.lineHeight,
    fontWeight: tokens.typography.heading.weight,
  },
  body: {
    color: tokens.color.textPrimary,
    fontSize: tokens.typography.body.size,
    lineHeight: tokens.typography.body.lineHeight,
    fontWeight: tokens.typography.body.weight,
  },
  label: {
    color: tokens.color.textPrimary,
    fontSize: tokens.typography.label.size,
    lineHeight: tokens.typography.label.lineHeight,
    fontWeight: tokens.typography.label.weight,
  },
  muted: { color: tokens.color.textSecondary },
});

export const Heading = ({ children }: TextProps): ReactNode => (
  <RnText style={styles.heading}>{children}</RnText>
);

export const BodyText = ({ children, muted = false }: TextProps): ReactNode => (
  <RnText style={muted ? [styles.body, styles.muted] : styles.body}>{children}</RnText>
);

export const Label = ({ children, muted = false }: TextProps): ReactNode => (
  <RnText style={muted ? [styles.label, styles.muted] : styles.label}>{children}</RnText>
);
