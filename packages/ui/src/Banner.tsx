import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { BodyText, Label } from './Text';
import { Button } from './Button';
import { StatusGlyph, STATUS_COLOR, STATUS_FILL } from './StatusGlyph';

/**
 * Phase 1 §05: in flow, and it persists until the thing it reports is resolved.
 * That is the whole distinction from `Toast` — a toast is a five-second
 * confirmation of something that already happened, a banner is a condition that is
 * still true.
 *
 * `critical` is for a genuine failure — a denied request, a rejected sync item.
 *
 * It is **not** for a declined consent, an offline device or an empty list. All
 * three of those are normal states, and styling a normal state as an error is how
 * an app teaches its users that its warnings mean nothing. Offline in particular is
 * a designed state, never an error (`docs/frontendplanv2.md` §3.4) — §02 gives it
 * the muted tone and a dashed edge, and this component follows that: `offline`
 * here has no warning colour at all.
 *
 * `attention` is the middle ground §05 illustrates with "MIUI stopped this app in
 * the background" — something the MR needs to fix, that is nobody's failure, and
 * that comes with an action.
 */
export type BannerTone = 'info' | 'critical' | 'attention' | 'offline';

export interface BannerAction {
  readonly label: string;
  readonly onPress: () => void;
}

export interface BannerProps {
  readonly tone: BannerTone;
  readonly title: string;
  readonly detail?: string;
  /** The way out. A banner that persists with no action is a banner that nags. */
  readonly action?: BannerAction;
}

/** §02's kinds, under §05's names for them. `info` and `offline` differ by shape. */
const KIND = {
  info: 'info',
  critical: 'critical',
  attention: 'attention',
  offline: 'offline',
} as const;

const styles = StyleSheet.create({
  base: {
    borderRadius: tokens.radius.well,
    borderLeftWidth: 4,
    padding: tokens.space.md,
    gap: tokens.space.xs,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm },
  title: { flex: 1 },
  offline: { borderStyle: 'dashed', borderWidth: 1, borderLeftWidth: 4 },
  action: { alignSelf: 'flex-start' },
});

export const Banner = ({ tone, title, detail, action }: BannerProps): ReactNode => (
  <View
    accessibilityRole="alert"
    // Grouped, so a screen reader announces the banner as one alert rather than as
    // a loose glyph followed by two sentences.
    accessible
    style={[
      styles.base,
      {
        backgroundColor: tone === 'info' ? tokens.color.surface : STATUS_FILL[KIND[tone]],
        borderLeftColor: STATUS_COLOR[KIND[tone]],
      },
      tone === 'offline' ? [styles.offline, { borderColor: tokens.color.offlineEdge }] : null,
    ]}
  >
    <View style={styles.head}>
      <StatusGlyph kind={KIND[tone]} />
      <View style={styles.title}>
        <BodyText>{title}</BodyText>
      </View>
    </View>
    {detail === undefined ? null : <Label muted>{detail}</Label>}
    {action === undefined ? null : (
      <View style={styles.action}>
        <Button label={action.label} onPress={action.onPress} variant="quiet" />
      </View>
    )}
  </View>
);
