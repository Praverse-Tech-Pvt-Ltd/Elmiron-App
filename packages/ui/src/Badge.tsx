import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { fontFamilyFor, tokens } from '@fieldforce/ui-tokens';

/**
 * A short state word on a tinted pill — "Unplanned", "Overdue", "AI practice", "Approved source".
 *
 * Before this, those words were uppercase `Label` text in the flow of a line, which read as part
 * of the sentence beside them. A badge is a single word or two, never a sentence (a sentence is a
 * `Banner`), and never the only carrier of a meaning a glyph or the row's words do not also carry
 * (§02: colour never means anything alone).
 *
 * Every tone is a foreground/fill pair already in `requiredContrastPairs`, so a badge cannot
 * introduce an unchecked pair: `neutral` is secondary text on the page ground with a hairline
 * edge; `offline` keeps §02's dashed edge and its muted tone, never a warning colour.
 */
export type BadgeTone = 'neutral' | 'info' | 'success' | 'attention' | 'critical' | 'offline';

export interface BadgeProps {
  readonly label: string;
  readonly tone?: BadgeTone;
}

const PALETTE: Record<BadgeTone, { readonly fill: string; readonly ink: string }> = {
  neutral: { fill: tokens.color.background, ink: tokens.color.textSecondary },
  info: { fill: tokens.color.infoFill, ink: tokens.color.info },
  success: { fill: tokens.color.successFill, ink: tokens.color.success },
  attention: { fill: tokens.color.attentionFill, ink: tokens.color.attention },
  critical: { fill: tokens.color.criticalFill, ink: tokens.color.critical },
  offline: { fill: tokens.color.offlineFill, ink: tokens.color.textSecondary },
};

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    borderRadius: tokens.radius.pill,
    paddingHorizontal: tokens.space.sm,
    paddingVertical: tokens.space.xs / 2,
  },
  neutral: { borderWidth: 1, borderColor: tokens.color.hairline },
  offline: { borderWidth: 1, borderStyle: 'dashed', borderColor: tokens.color.offlineEdge },
  text: {
    fontSize: tokens.typography.label.size,
    lineHeight: tokens.typography.label.lineHeight,
    fontWeight: '600',
    fontFamily: fontFamilyFor('600'),
  },
});

export const Badge = ({ label, tone = 'neutral' }: BadgeProps): ReactNode => {
  const palette = PALETTE[tone];
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[
        styles.pill,
        { backgroundColor: palette.fill },
        tone === 'neutral' ? styles.neutral : null,
        tone === 'offline' ? styles.offline : null,
      ]}
    >
      <Text style={[styles.text, { color: palette.ink }]}>{label}</Text>
    </View>
  );
};
