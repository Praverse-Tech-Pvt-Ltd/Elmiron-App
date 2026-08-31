import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tokens } from '@fieldforce/ui-tokens';

export interface ScreenProps {
  readonly children: ReactNode;
  /**
   * Scrolling is opt-in. A screen that scrolls when it does not need to hides
   * whether content actually fits on a small device.
   */
  readonly scrollable?: boolean;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: tokens.color.background },
  content: { padding: tokens.space.md, gap: tokens.space.md },
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
 */
export const Screen = ({ children, scrollable = false }: ScreenProps): ReactNode => {
  const insets = useSafeAreaInsets();
  const inset = {
    paddingTop: tokens.space.md + insets.top,
    paddingBottom: tokens.space.md + insets.bottom,
    paddingLeft: tokens.space.md + insets.left,
    paddingRight: tokens.space.md + insets.right,
  };

  return scrollable ? (
    <ScrollView style={styles.fill} contentContainerStyle={[styles.content, inset]}>
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fill, styles.content, inset]}>{children}</View>
  );
};
