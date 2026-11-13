import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { LayoutChangeEvent, NativeScrollEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fontFamilyFor, tokens } from '@fieldforce/ui-tokens';
import { elevationStyle } from './depth';
import { useT } from './i18n';

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
   * gesture bar, and rides up with the keyboard (`FE-W187`).
   */
  readonly footer?: ReactNode;
  /**
   * For a conversation. When content is added, scroll to it -- but only if the reader was already
   * at (or near) the bottom. Someone who has scrolled up to read history is left where they are;
   * scrolling back down resumes following.
   */
  readonly followLatest?: boolean;
  /**
   * `FE-W188`. A screen pushed on the stack — a visit, a report, a setting — draws a "Back" control
   * at its top, and this is what it does (the app passes `router.back`). The `Stack` runs with
   * `headerShown: false`, so without it the only way back was the phone's own Back, which a rep on
   * a gesture-navigation phone may not know is there. A tab's own screen passes nothing.
   */
  readonly onBack?: () => void;
  /**
   * `FE-W188`. The back control's word, when it must not follow the app's language. Only the
   * doctor-facing consent screens pass one: their words stay English and out of the catalogue until
   * an approved translation arrives (`FE-W148`), and a translator's "Back" would be the one word on
   * them nobody legal reviewed. Everywhere else the catalogue's `common.back`.
   */
  readonly backLabel?: string;
}

/** How close to the bottom (pt) still counts as "at the bottom". */
export const FOLLOW_SLACK = 80;

/** Pure, so the rule is tested without a native scroll view: is the reader at the bottom? */
export const isAtBottom = (
  event: Pick<NativeScrollEvent, 'contentOffset' | 'contentSize' | 'layoutMeasurement'>,
): boolean =>
  event.contentOffset.y + event.layoutMeasurement.height >= event.contentSize.height - FOLLOW_SLACK;

/**
 * `FE-W198`. How much of the form below a focused field must show with it: a control directly under
 * the field -- "Show password", a field's help line -- at the tap floor, and the design's margin.
 */
export const REVEAL_BELOW = tokens.target.floor + tokens.space.md;

/**
 * `FE-W198`. Where to scroll so a focused field, and `REVEAL_BELOW` under it, sit above the pinned
 * footer -- or null when they already do. Pure, so the rule is tested without a native scroll view.
 *
 * `fieldTop`/`fieldHeight` are in the scroll CONTENT's coordinates; `offset` is how far it is
 * scrolled and `viewport` the scroll view's own height, which ends at the footer's top edge.
 */
export const revealOffset = ({
  fieldTop,
  fieldHeight,
  offset,
  viewport,
}: {
  readonly fieldTop: number;
  readonly fieldHeight: number;
  readonly offset: number;
  readonly viewport: number;
}): number | null => {
  const needed = fieldTop + fieldHeight + REVEAL_BELOW;
  if (needed <= offset + viewport) return null;
  // Never so far that the field's own top leaves the view on a short viewport.
  return Math.max(0, Math.min(needed - viewport, fieldTop - tokens.space.md));
};

type FocusedField = NonNullable<ReturnType<typeof TextInput.State.currentlyFocusedInput>>;
/** What `measureLayout` measures against: the focused field's own parameter type. */
type MeasureTarget = Parameters<FocusedField['measureLayout']>[0];

/** The back control's drawn chevron: arm length and stroke. Geometry, like `TabIcon`'s. */
const CHEVRON = 9;
const CHEVRON_STROKE = 2;

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: tokens.color.background },
  content: { padding: tokens.space.md, gap: tokens.space.md },
  footer: {
    backgroundColor: tokens.color.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.color.hairline,
    // FE-W101. A touch more air above the pinned action, and a soft upward shadow so content
    // visibly passes UNDER the footer as it scrolls, rather than being cut by a line.
    paddingTop: tokens.space.sm + tokens.space.xs,
    gap: tokens.space.sm,
    ...elevationStyle('dock'),
  },
  backRow: { paddingTop: tokens.space.xs, alignItems: 'flex-start' },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.sm,
    // `FE-W188`. The tap target floor, never the size of the word.
    minHeight: tokens.target.floor,
    minWidth: tokens.target.floor,
    paddingHorizontal: tokens.space.sm,
    borderRadius: tokens.radius.control,
  },
  // Press darkens, as every control's does (§05).
  backPressed: { backgroundColor: tokens.color.wash },
  chevron: {
    width: CHEVRON,
    height: CHEVRON,
    borderLeftWidth: CHEVRON_STROKE,
    borderBottomWidth: CHEVRON_STROKE,
    borderColor: tokens.color.accent,
    // A square's corner turned to point left, nudged right so the drawn point sits in the box.
    transform: [{ rotate: '45deg' }],
    marginLeft: CHEVRON_STROKE,
  },
  // `FE-W177`'s tappable step, in the accent ink every quiet action uses.
  backLabel: {
    fontSize: tokens.typography.tappable.size,
    lineHeight: tokens.typography.tappable.lineHeight,
    fontWeight: tokens.typography.tappable.weight,
    fontFamily: fontFamilyFor(tokens.typography.tappable.weight),
    color: tokens.color.accent,
  },
});

/**
 * `FE-W187`. Whether the software keyboard is up. iOS announces it before it moves, Android only
 * after — the same pair `KeyboardAvoidingView` listens to.
 */
const useKeyboardShown = (): boolean => {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const subscriptions = [
      Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () => {
        setShown(true);
      }),
      Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => {
        setShown(false);
      }),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, []);
  return shown;
};

/**
 * `FE-W188`. The back control: a drawn chevron (Views, not a font glyph — the reason `TabIcon`
 * gives) and the word. It sits on the screen's ground, never inside a hero, so its ink is fixed.
 */
const BackControl = ({
  onBack,
  label,
}: {
  readonly onBack: () => void;
  readonly label: string | undefined;
}): ReactNode => {
  const { t } = useT();
  const word = label ?? t('common.back');
  return (
    <Pressable
      accessibilityLabel={word}
      accessibilityRole="button"
      hitSlop={tokens.space.xs}
      onPress={onBack}
      style={({ pressed }) => [styles.back, pressed ? styles.backPressed : null]}
      testID="screen-back"
    >
      <View style={styles.chevron} />
      <Text numberOfLines={1} style={styles.backLabel}>
        {word}
      </Text>
    </Pressable>
  );
};

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
  onBack,
  backLabel,
}: ScreenProps): ReactNode => {
  const insets = useSafeAreaInsets();
  const scroller = useRef<ScrollView>(null);
  // Starts true: a conversation opens at its newest message.
  const atBottom = useRef(true);
  const keyboardShown = useKeyboardShown();
  // `FE-W198`. The scroll view's own height and how far it is scrolled, for `reveal` below.
  const viewport = useRef(0);
  const offset = useRef(0);
  const hasFooter = footer !== undefined && footer !== null;
  const hasBack = onBack !== undefined;
  // `FE-W188`. With a back control the status bar's height sits above the control, on the
  // wrapper, and the content starts a small step below the control rather than a margin below
  // the clock.
  const contentTop = hasBack ? tokens.space.xs : tokens.space.md;
  const inset = {
    paddingTop: hasBack ? contentTop : tokens.space.md + insets.top,
    paddingBottom: hasFooter ? tokens.space.md : tokens.space.md + insets.bottom,
    paddingLeft: tokens.space.md + insets.left,
    paddingRight: tokens.space.md + insets.right,
  };

  /**
   * `FE-W198`. With the keyboard up, the focused field and the control under it are scrolled above
   * the pinned footer. Android scrolls only the CURSOR into view, and does it before the screen
   * shrinks for the keyboard: on sign-in the footer's "Sign in" covered the password field's lower
   * edge and its "Show password" (15 October re-check, screenshot 02b). Run whenever the keyboard
   * comes up and whenever the scroll view's height changes while it is up -- the shrink arrives
   * after the keyboard's own event.
   */
  const reveal = (): void => {
    const scroll = scroller.current;
    // Null when no field has focus, whatever the hand-written types say.
    const field = TextInput.State.currentlyFocusedInput() as FocusedField | null;
    if (scroll === null || field === null) return;
    // The scroll CONTENT's own view, so the field is measured in the coordinates `offset` counts
    // in. On the component since 0.7x, though the hand-written types still lack it.
    const content = (
      scroll as unknown as { getInnerViewRef?: () => MeasureTarget | null }
    ).getInnerViewRef?.();
    if (content === null || content === undefined) return;
    field.measureLayout(
      content,
      (_x, fieldTop, _width, fieldHeight) => {
        const y = revealOffset({
          fieldTop,
          fieldHeight,
          offset: offset.current,
          viewport: viewport.current,
        });
        if (y !== null) scroll.scrollTo({ y, animated: true });
      },
      () => undefined,
    );
  };

  useEffect(() => {
    // `reveal` reads refs only; the keyboard coming up is the event.
    if (keyboardShown && scrollable) reveal();
  }, [keyboardShown, scrollable]);

  // FE-D12 V1. When the screen scrolls, the status bar's height sits on a wrapper that does not
  // scroll. Inside the content it scrolled away with it, and scrolled content passed under the
  // clock -- over "May we record this" on the consent screen. The first paint is unchanged.
  const body = scrollable ? (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={[styles.content, inset, { paddingTop: contentTop }]}
      // A tap on a button while the keyboard is up presses the button, rather than only closing
      // the keyboard and making the rep tap again.
      keyboardShouldPersistTaps="handled"
      ref={scroller}
      onLayout={({ nativeEvent }: LayoutChangeEvent) => {
        const changed = nativeEvent.layout.height !== viewport.current;
        viewport.current = nativeEvent.layout.height;
        if (changed && keyboardShown) reveal();
      }}
      scrollEventThrottle={100}
      onScroll={({ nativeEvent }: { nativeEvent: NativeScrollEvent }) => {
        offset.current = nativeEvent.contentOffset.y;
        if (followLatest) atBottom.current = isAtBottom(nativeEvent);
      }}
      {...(followLatest
        ? {
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
          // `FE-W187`. The keyboard covers the gesture bar, so while it is up the footer sits on
          // the keyboard with the design's margin alone, not with a gap the height of a hidden bar.
          paddingBottom: tokens.space.md + (keyboardShown ? 0 : insets.bottom),
          paddingLeft: tokens.space.md + insets.left,
          paddingRight: tokens.space.md + insets.right,
        },
      ]}
    >
      {footer}
    </View>
  ) : null;

  /**
   * `FE-W187`. The footer rides up with the keyboard — and on Android it did not. Android used to
   * shrink the window itself (`adjustResize`), so this view was left off there. Under the
   * edge-to-edge layout Expo now gives every Android app the window is no longer resized: the
   * keyboard was drawn OVER the pinned "Sign in", "Send report" and "Save", and the rep had to
   * close the keyboard to find them (QA screenshots 02, 40, 95).
   *
   * `padding` on both platforms is safe either way, because the view measures its OWN frame
   * against the keyboard's top: where a system does still resize the window, the frame already
   * ends at the keyboard, the padding it computes is zero, and the footer is never lifted twice.
   */
  return (
    <KeyboardAvoidingView behavior="padding" style={styles.fill}>
      <View style={[styles.fill, scrollable || hasBack ? { paddingTop: insets.top } : null]}>
        {hasBack ? (
          <View
            style={[
              styles.backRow,
              {
                // The chevron, not the control's padding, lines up with the content's edge.
                paddingLeft: tokens.space.md + insets.left - tokens.space.sm,
                paddingRight: tokens.space.md + insets.right,
              },
            ]}
          >
            <BackControl label={backLabel} onBack={onBack} />
          </View>
        ) : null}
        {body}
        {pinned}
      </View>
    </KeyboardAvoidingView>
  );
};
