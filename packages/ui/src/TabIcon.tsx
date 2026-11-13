import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ColorValue } from 'react-native';
import { fontFamilyFor, tokens } from '@fieldforce/ui-tokens';
import { MAX_FONT_SCALE } from './Text';

/**
 * The four tab-bar icons, drawn in `View`s.
 *
 * **Not a font, and that is the whole reason this file exists rather than a
 * dependency.** `(tabs)/_layout.tsx` used to render no icon at all, and its
 * comment gave the reason: the default placeholder "arrives as tofu on the OEM
 * font stacks this product targets", which is the same hazard `StatusGlyph` is
 * kept off DM Sans for. An icon font — `@expo/vector-icons` — reintroduces exactly
 * that failure, on the one control every screen shows.
 *
 * `react-native-svg` would draw the design's paths faithfully and is a native
 * module: another prebuild and another seven-minute Gradle build, for four shapes
 * that are a rectangle, a circle, a rounded box and three lines. Phase 4 D1 draws
 * all four in 20×20 with a 1.7 stroke, and every one of them is expressible as
 * borders and radii. So they are borders and radii.
 *
 * **The label never goes away.** §05: an icon never carries meaning alone. These
 * sit above the tab labels, not instead of them — a tab bar of four wordless
 * glyphs is exactly what that rule forbids, and it is why `Tabs.Screen` keeps its
 * `title`.
 *
 * The numbers below are icon geometry rather than design values, which is why they
 * are literals: they are the design's own `viewBox` coordinates, and there is no
 * token for "where the crossbar of a calendar sits".
 */
export type TabIconName = 'today' | 'doctors' | 'coaching' | 'me';

export interface TabIconProps {
  readonly name: TabIconName;
  /** True for the tab currently open. Changes colour and nothing else. */
  readonly focused: boolean;
}

const SIZE = 20;
const STROKE = 1.7;

const styles = StyleSheet.create({
  box: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },

  // Today — a calendar: a rounded box with its header rule across the top.
  calendar: {
    width: 15,
    height: 14,
    borderWidth: STROKE,
    borderRadius: 4,
  },
  calendarRule: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 4.1,
    height: STROKE,
  },

  // Doctors — a person: head above shoulders.
  head: { width: 7.4, height: 7.4, borderWidth: STROKE, borderRadius: 3.7 },
  shoulders: {
    width: 13,
    height: 6,
    borderWidth: STROKE,
    borderBottomWidth: 0,
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
    marginTop: 1.4,
  },

  // Coaching — a speech bubble: a rounded box with a tail off its lower left.
  bubble: { width: 15, height: 11.5, borderWidth: STROKE, borderRadius: 3.5 },
  tail: {
    position: 'absolute',
    bottom: -2.6,
    left: 3.4,
    width: STROKE,
    height: 5,
    transform: [{ rotate: '32deg' }],
  },

  // Me — three rules, the last one short. A list, not a face: this tab is
  // settings and the MR's own data, and a face would promise a profile.
  rule: { height: STROKE, borderRadius: STROKE / 2, marginVertical: 2 },

  // B1's active-tab pill.
  indicator: {
    width: 44,
    height: 26,
    borderRadius: tokens.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  indicatorOn: { backgroundColor: tokens.color.successFill },
});

/**
 * FE-W101. The tab bar's icon slot as B1 draws it: the open tab's icon sits in a soft green pill
 * (44 × 26, `successFill`), the others on nothing.
 *
 * Separate from `TabIcon` so the icon keeps its own rule — focus changes its colour and nothing
 * else — and the indicator is the one extra thing. The pill is always laid out, transparent when
 * the tab is not open, so switching tab changes two fills and moves nothing under the thumb. It
 * is wider than the navigator's icon slot (31) on purpose and overflows it sideways, centred, as
 * the design draws it; the slot is not a touch target, the whole tab is.
 */
const labelStyles = StyleSheet.create({
  label: {
    fontSize: tokens.typography.tappable.size,
    lineHeight: tokens.typography.tappable.lineHeight,
    fontWeight: tokens.typography.tappable.weight,
    fontFamily: fontFamilyFor(tokens.typography.tappable.weight),
    textAlign: 'center',
  },
  beside: { marginStart: tokens.space.xs },
});

export interface TabBarLabelProps {
  /** The navigator's tint for this tab: accent when open, muted otherwise. */
  readonly color: ColorValue;
  /** The tab's title, in the app's language. */
  readonly children: string;
  /** The navigator's placement. Beside the icon only on a wide screen. */
  readonly position?: 'below-icon' | 'beside-icon';
}

/**
 * `FE-W177`, `FE-W179`. The words under each tab icon, for `tabBarLabel`.
 *
 * Its own component rather than `tabBarLabelStyle`, for two things the style cannot say: the label
 * is a TAPPABLE label, so it takes `tappable` (14) — it was `label`'s 13.5, under Phase 1's floor —
 * and it sits in a bar of fixed height (`tokens.target.tabBar`), so its growth with the system font
 * size is capped at `MAX_FONT_SCALE` instead of being pushed under the bar's bottom edge. One line,
 * centred, as the navigator's own label is.
 */
export const TabBarLabel = ({
  color,
  children,
  position = 'below-icon',
}: TabBarLabelProps): ReactNode => (
  <Text
    maxFontSizeMultiplier={MAX_FONT_SCALE}
    numberOfLines={1}
    style={[labelStyles.label, position === 'beside-icon' ? labelStyles.beside : null, { color }]}
  >
    {children}
  </Text>
);

export const TabBarIcon = ({ name, focused }: TabIconProps): ReactNode => (
  <View style={[styles.indicator, focused ? styles.indicatorOn : null]}>
    <TabIcon focused={focused} name={name} />
  </View>
);

export const TabIcon = ({ name, focused }: TabIconProps): ReactNode => {
  const color = focused ? tokens.color.accent : tokens.color.textSecondary;

  switch (name) {
    case 'today':
      return (
        <View style={styles.box}>
          <View style={[styles.calendar, { borderColor: color }]}>
            <View style={[styles.calendarRule, { backgroundColor: color }]} />
          </View>
        </View>
      );

    case 'doctors':
      return (
        <View style={styles.box}>
          <View style={[styles.head, { borderColor: color }]} />
          <View style={[styles.shoulders, { borderColor: color }]} />
        </View>
      );

    case 'coaching':
      return (
        <View style={styles.box}>
          <View style={[styles.bubble, { borderColor: color }]}>
            <View style={[styles.tail, { backgroundColor: color }]} />
          </View>
        </View>
      );

    case 'me':
      return (
        <View style={styles.box}>
          <View style={[styles.rule, { width: 14, backgroundColor: color }]} />
          <View style={[styles.rule, { width: 14, backgroundColor: color }]} />
          <View style={[styles.rule, { width: 9, backgroundColor: color }]} />
        </View>
      );
  }
};
