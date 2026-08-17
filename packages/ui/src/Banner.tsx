import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { BodyText } from './Text';

/**
 * `critical` is for a genuine failure — a denied request, a rejected sync item.
 *
 * It is **not** for a declined consent, an offline device or an empty list. All
 * three of those are normal states, and styling a normal state as an error is how
 * an app teaches its users that its warnings mean nothing. Offline in particular is
 * a designed state, never an error (`docs/frontendplanv2.md` §3.4).
 */
export type BannerTone = 'info' | 'critical';

export interface BannerProps {
  readonly tone: BannerTone;
  readonly title: string;
  readonly detail?: string;
}

const styles = StyleSheet.create({
  base: {
    borderRadius: tokens.radius.sm,
    borderLeftWidth: 4,
    padding: tokens.space.md,
    gap: tokens.space.xs,
    backgroundColor: tokens.color.surface,
  },
  info: { borderLeftColor: tokens.color.accent },
  critical: { borderLeftColor: tokens.color.critical },
});

export const Banner = ({ tone, title, detail }: BannerProps): ReactNode => (
  <View
    accessibilityRole="alert"
    style={[styles.base, tone === 'critical' ? styles.critical : styles.info]}
  >
    <BodyText>{title}</BodyText>
    {detail === undefined ? null : <BodyText muted>{detail}</BodyText>}
  </View>
);
