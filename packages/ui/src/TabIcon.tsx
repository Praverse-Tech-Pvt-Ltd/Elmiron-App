import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';

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
});

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
