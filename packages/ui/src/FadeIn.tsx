import type { ReactNode } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { useEntrance } from './motion';

/**
 * FE-W101. A block that settles into place when it first appears — a short fade and an 8pt rise —
 * so a screen arrives top to bottom instead of all at once. `index` staggers siblings.
 *
 * **Decoration over a screen that already works.** Everything inside is laid out, readable by a
 * screen reader and pressable from the first frame; only its opacity and position move, on the
 * native driver. Under Android's "Remove animations" the block is simply there.
 *
 * The wrapper is always its own native view (`collapsable={false}`), so the opacity settling to 1
 * is a prop change and never makes Fabric reparent the children — the precondition of the FE-D9
 * crash `text-field-flattening.test.tsx` describes.
 */
export interface FadeInProps {
  readonly children: ReactNode;
  /** Position among siblings; each step waits `tokens.motion.stagger` longer. */
  readonly index?: number;
}

const styles = StyleSheet.create({
  // The wrapper takes the column's gap from its parent and adds none of its own; a child's own
  // gap lives in the child.
  block: { alignSelf: 'stretch' },
});

export const FadeIn = ({ children, index = 0 }: FadeInProps): ReactNode => {
  const entrance = useEntrance({ index, duration: tokens.motion.standard });
  return (
    <Animated.View collapsable={false} style={[styles.block, entrance]}>
      {children}
    </Animated.View>
  );
};
