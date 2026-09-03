import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';

/**
 * The six states of §02, as a mark rather than as a colour.
 *
 * §02's rule is that colour never carries meaning alone, so every kind here has a
 * distinct shape as well as a distinct hue: a tick, an exclamation, a cross, an
 * "i", a dashed ring, a filled dot. Two of those distinctions are load-bearing —
 *
 * - **offline is a dashed ring in the muted tone.** It is the expected condition
 *   for most of an MR's day and carries no warning colour anywhere. The dash is
 *   the signal.
 * - **recording is a filled terracotta dot and critical is a cross.** They differ
 *   by hue *and* by shape, because §02 says they must never be mistaken for each
 *   other by a doctor glancing across a desk.
 *
 * Sharing one implementation across ListItem, Toast, Banner and the two indicators
 * is what keeps that promise true everywhere instead of in the first component
 * somebody wrote.
 */
export type StatusKind = 'success' | 'attention' | 'critical' | 'info' | 'offline' | 'recording';

export interface StatusGlyphProps {
  readonly kind: StatusKind;
  /** Larger mark for a card header or an indicator. Default is the list-row size. */
  readonly large?: boolean;
}

export const STATUS_COLOR: Record<StatusKind, string> = {
  success: tokens.color.success,
  attention: tokens.color.attention,
  critical: tokens.color.critical,
  info: tokens.color.info,
  offline: tokens.color.textSecondary,
  recording: tokens.color.recording,
};

export const STATUS_FILL: Record<StatusKind, string> = {
  success: tokens.color.successFill,
  attention: tokens.color.attentionFill,
  critical: tokens.color.criticalFill,
  info: tokens.color.infoFill,
  offline: tokens.color.offlineFill,
  recording: '#F6EDE9',
};

/** The character for each kind. `offline` and `recording` are drawn, not typed. */
const MARK: Record<StatusKind, string> = {
  success: '✓',
  attention: '!',
  critical: '✕',
  info: 'i',
  offline: '',
  recording: '',
};

const styles = StyleSheet.create({
  mark: { fontWeight: '700', textAlign: 'center' },
  dot: { borderRadius: tokens.radius.pill },
  ring: { borderRadius: tokens.radius.pill, borderStyle: 'dashed' },
});

export const StatusGlyph = ({ kind, large = false }: StatusGlyphProps): ReactNode => {
  const size = large ? 16 : 11;
  const color = STATUS_COLOR[kind];

  if (kind === 'offline') {
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[styles.ring, { width: size, height: size, borderWidth: 1.8, borderColor: color }]}
      />
    );
  }

  if (kind === 'recording') {
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[styles.dot, { width: size, height: size, backgroundColor: color }]}
      />
    );
  }

  return (
    <Text
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[styles.mark, { color, fontSize: size, lineHeight: size + 4, width: size + 4 }]}
    >
      {MARK[kind]}
    </Text>
  );
};
