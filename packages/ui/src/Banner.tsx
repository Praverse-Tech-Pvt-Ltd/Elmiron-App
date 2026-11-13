import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { BodyText, Secondary } from './Text';
import { Button } from './Button';
import { StatusGlyph, STATUS_COLOR, STATUS_FILL } from './StatusGlyph';
import { elevationStyle } from './depth';
import { SurfaceContext } from './surface';

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
  },
  // `FE-W179`. Top-aligned, with the glyph centred on the title's first line: a title that wraps
  // used to float the glyph at the middle of the paragraph.
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: tokens.space.sm },
  // `FE-W189`. The title, the detail and the action are one column beside the glyph.
  words: { flex: 1, gap: tokens.space.xs },
  offline: { borderStyle: 'dashed', borderWidth: 1, borderLeftWidth: 4 },
  // FE-W101. `info` is the one banner on the white card ground rather than a tint; the row shadow
  // gives it the same edge on the page a card has. The tinted tones need none.
  raised: elevationStyle('hairline'),
  /**
   * `FE-W198`. The action's LABEL in the words' column, and no extra floor under it. The quiet
   * button keeps its 24pt side padding and its 52pt height (the tap floor, untouched), so its label
   * sat 24pt inside the title's edge and its empty lower half added to the banner's own padding
   * (15 October re-check, screenshot 03b). Pulled back by exactly that padding -- the pressed fill
   * still lands inside the banner, over the glyph's column -- and up into the banner's bottom
   * padding, which its own empty space now stands in for.
   */
  action: {
    alignSelf: 'flex-start',
    marginLeft: -tokens.space.lg,
    marginTop: -tokens.space.xs,
    marginBottom: -tokens.space.md,
  },
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
      tone === 'info' ? styles.raised : null,
    ]}
  >
    {/*
      `FE-W176`. A banner's words always sit on the banner's own light fill, so they take paper ink
      whatever surface the banner is placed on — as `Card` does for its content. Inside the voice
      note's dark card the microphone banner inherited the hero's white and drew white on
      `attentionFill`, invisible, on every first open.
    */}
    <SurfaceContext.Provider value="paper">
      {/*
        `FE-W189`. The detail and the action start under the TITLE, not under the glyph: the QA pass
        (screenshots 15, 36) showed the detail's lines and "Live location" running back to the
        banner's edge, so the glyph sat in a notch of its own paragraph and the action read as
        belonging to the card rather than to this banner.
      */}
      <View style={styles.head}>
        <StatusGlyph kind={KIND[tone]} lineHeight={tokens.typography.body.lineHeight} />
        <View style={styles.words}>
          <BodyText>{title}</BodyText>
          {/* `FE-W178`. The detail is a sentence, so it is set at the prose step, not `Label`. */}
          {detail === undefined ? null : <Secondary>{detail}</Secondary>}
          {action === undefined ? null : (
            <View style={styles.action}>
              <Button label={action.label} onPress={action.onPress} variant="quiet" />
            </View>
          )}
        </View>
      </View>
    </SurfaceContext.Provider>
  </View>
);
