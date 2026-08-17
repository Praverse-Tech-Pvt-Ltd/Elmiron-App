import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
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

export const Screen = ({ children, scrollable = false }: ScreenProps): ReactNode =>
  scrollable ? (
    <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fill, styles.content]}>{children}</View>
  );
