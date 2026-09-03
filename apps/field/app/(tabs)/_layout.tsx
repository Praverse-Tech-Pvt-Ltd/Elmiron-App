import type { ReactNode } from 'react';
import { Tabs } from 'expo-router';
import { tokens } from '@fieldforce/ui-tokens';

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
 * Labels only, no icons. `@expo/vector-icons` is not a dependency of this app and
 * adding an icon set for four labels would be weight for decoration; §05 also says
 * an icon never carries meaning alone, so the label is the part that has to be
 * there.
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
        // No icon, and this is what removes it rather than merely leaving it
        // unset: the default renders a placeholder glyph, which arrives as tofu on
        // the OEM font stacks this product targets — the same failure the queue
        // screen's glyph comment already warns about. Labels carry the meaning.
        tabBarIcon: () => null,
      }}
    >
      <Tabs.Screen name="home" options={{ title: 'Today' }} />
      <Tabs.Screen name="doctors" options={{ title: 'Doctors' }} />
      <Tabs.Screen name="coaching" options={{ title: 'Coaching' }} />
      <Tabs.Screen name="me" options={{ title: 'Me' }} />
    </Tabs>
  );
}
