import type { ReactNode } from 'react';
import { Tabs } from 'expo-router';
import { tokens } from '@fieldforce/ui-tokens';
import { TabIcon } from '@fieldforce/ui';

/**
 * B1's tab bar: Today · Doctors · Coaching · Me.
 *
 * **Four destinations and no more.** The design fixes the count, and the reason is
 * §04: this is a one-thumb app and the bar sits inside the reach zone, so every
 * extra tab makes all of them smaller. A fifth destination goes inside one of these
 * four, not beside them.
 *
 * The routes keep their paths — `(tabs)` is a group, so `/home` and `/doctors` are
 * still `/home` and `/doctors`, and every existing link and deep link continues to
 * work.
 *
 * **Icons and labels, not icons instead of labels.** This bar carried labels only
 * for three phases, on the grounds that an icon set was weight for decoration.
 * Phase 4 D1 draws all four tabs with a glyph above the word, so the icons are now
 * here — but the reason the old comment gave still binds: §05 says an icon never
 * carries meaning alone, so every `Tabs.Screen` keeps its `title` and the words
 * are what a new MR reads.
 *
 * They are drawn in `View`s rather than pulled from an icon font. `@expo/vector-
 * icons` would reintroduce the tofu hazard the `tabBarIcon` note below describes,
 * and `react-native-svg` is a native module — another prebuild and another Gradle
 * build — for four shapes that are a box, a circle, a bubble and three lines. See
 * `packages/ui/src/TabIcon.tsx`.
 */
export default function TabsLayout(): ReactNode {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: tokens.color.accent,
        tabBarInactiveTintColor: tokens.color.textSecondary,
        tabBarStyle: { backgroundColor: tokens.color.surface },
        tabBarLabelStyle: {
          fontSize: tokens.typography.label.size,
          fontWeight: tokens.typography.label.weight,
        },
        // Explicitly set, exactly as it was when it returned null: leaving it
        // unset renders the platform's placeholder glyph, which arrives as tofu on
        // the OEM font stacks this product targets — the same failure the queue
        // screen's glyph comment warns about. What changed is that the slot now
        // holds a drawn shape instead of nothing.
        tabBarIcon: () => null,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Today',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} name="today" />,
        }}
      />
      <Tabs.Screen
        name="doctors"
        options={{
          title: 'Doctors',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} name="doctors" />,
        }}
      />
      <Tabs.Screen
        name="coaching"
        options={{
          title: 'Coaching',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} name="coaching" />,
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: 'Me',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} name="me" />,
        }}
      />
    </Tabs>
  );
}
