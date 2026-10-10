import { useRef } from 'react';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import type { NativeScrollEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tokens } from '@fieldforce/ui-tokens';

export interface ScreenProps {
  readonly children: ReactNode;
  /**
   * Scrolling is opt-in. A screen that scrolls when it does not need to hides
   * whether content actually fits on a small device.
   */
  readonly scrollable?: boolean;
  /**
   * The screen's action area, PINNED to the bottom, outside the scrolling content.
   *
   * `tokens.target` says a screen's single primary action "originates inside [the reach zone],
   * pinned, never scrolled to". Before this slot the screens put their action at the end of
   * scrolling content behind a `flex: 1` spacer — which does nothing inside a ScrollView — so on a
   * long visit the rep scrolled to find "Check in". Anything passed here stays in reach, above the
   * gesture bar, and rides up with the keyboard.
   */
  readonly footer?: ReactNode;
  /**
   * For a conversation. When content is added, scroll to it -- but only if the reader was already
   * at (or near) the bottom. Someone who has scrolled up to read history is left where they are;
   * scrolling back down resumes following.
   */
  readonly followLatest?: boolean;
}

/** How close to the bottom (pt) still counts as "at the bottom". */
export const FOLLOW_SLACK = 80;

/** Pure, so the rule is tested without a native scroll view: is the reader at the bottom? */
export const isAtBottom = (
  event: Pick<NativeScrollEvent, 'contentOffset' | 'contentSize' | 'layoutMeasurement'>,
): boolean =>
  event.contentOffset.y + event.layoutMeasurement.height >= event.contentSize.height - FOLLOW_SLACK;

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: tokens.color.background },
  content: { padding: tokens.space.md, gap: tokens.space.md },
  footer: {
    backgroundColor: tokens.color.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.color.hairline,
    paddingTop: tokens.space.sm,
    gap: tokens.space.sm,
  },
});

/**
 * Every route renders inside this component, which is why the safe-area inset
 * belongs here and not in any screen.
 *
 * The `Stack` runs with `headerShown: false`, so nothing above a screen reserves
 * the status bar, the punch-hole camera or the gesture bar. Without an inset the
 * first line of every screen sits under the clock — visible in the FE-Build-2b
 * sign-in screenshot, where the heading and the status bar overlap.
 *
 * Applied once, here, on purpose. A per-screen `SafeAreaView` leaves the next new
 * screen broken by default, which is how this defect arrived.
 *
 * The inset is added to the token padding rather than replacing it: `space.md` is
 * the design's margin and the inset is the device's hardware. They are different
 * quantities and neither substitutes for the other — which is also why there is no
 * pixel literal here. The numbers come from the device.
 *
 * With a `footer`, the bottom inset moves from the content to the footer: the footer is what
 * sits on the gesture bar.
 */
export const Screen = ({
  children,
  scrollable = false,
  footer,
  followLatest = false,
}: ScreenProps): ReactNode => {
  const insets = useSafeAreaInsets();
  const scroller = useRef<ScrollView>(null);
  // Starts true: a conversation opens at its newest message.
  const atBottom = useRef(true);
  const hasFooter = footer !== undefined && footer !== null;
  const inset = {
    paddingTop: tokens.space.md + insets.top,
    paddingBottom: hasFooter ? tokens.space.md : tokens.space.md + insets.bottom,
    paddingLeft: tokens.space.md + insets.left,
    paddingRight: tokens.space.md + insets.right,
  };

  // FE-D12 V1. When the screen scrolls, the status bar's height sits on a wrapper that does not
  // scroll. Inside the content it scrolled away with it, and scrolled content passed under the
  // clock -- over "May we record this" on the consent screen. The first paint is unchanged.
  const body = scrollable ? (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={[styles.content, inset, { paddingTop: tokens.space.md }]}
      // A tap on a button while the keyboard is up presses the button, rather than only closing
      // the keyboard and making the rep tap again.
      keyboardShouldPersistTaps="handled"
      ref={scroller}
      {...(followLatest
        ? {
            scrollEventThrottle: 100,
            onScroll: ({ nativeEvent }: { nativeEvent: NativeScrollEvent }) => {
              atBottom.current = isAtBottom(nativeEvent);
            },
            onContentSizeChange: () => {
              if (atBottom.current) scroller.current?.scrollToEnd({ animated: true });
            },
          }
        : {})}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fill, styles.content, inset]}>{children}</View>
  );

  const pinned = hasFooter ? (
    <View
      style={[
        styles.footer,
        {
          paddingBottom: tokens.space.md + insets.bottom,
          paddingLeft: tokens.space.md + insets.left,
          paddingRight: tokens.space.md + insets.right,
        },
      ]}
    >
      {footer}
    </View>
  ) : null;

  // iOS needs the padding behaviour; Android resizes the window itself (adjustResize), and a
  // second adjustment there would push the footer up twice.
  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.fill, scrollable ? { paddingTop: insets.top } : null]}>
        {body}
        {pinned}
      </View>
    </KeyboardAvoidingView>
  );
};
