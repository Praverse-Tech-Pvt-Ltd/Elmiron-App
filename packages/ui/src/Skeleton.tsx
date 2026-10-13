import type { ReactNode } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import type { DimensionValue } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { elevationStyle } from './depth';
import { usePulse } from './motion';

/**
 * FE-W101. Loading placeholders: the shape of what is coming, in the wash, breathing slowly.
 *
 * A bare spinner on an empty screen says "wait"; a placeholder in the shape of the day says
 * "this is where your day goes", and the screen does not jump when it arrives. They never replace
 * the words: every screen that shows one keeps its `Spinner` line — the accessible "Getting
 * today's plan" — and the placeholders are hidden from screen readers, because a stack of grey
 * bars has nothing to say.
 *
 * No shimmer. A sweeping highlight needs a gradient (a dependency) and reads as busy on a phone in
 * the sun; an opacity breath on the native driver is cheap and calm, and under "Remove animations"
 * it holds still.
 */
export interface SkeletonProps {
  readonly width?: DimensionValue;
  readonly height: number;
  /** Defaults to `radius.sm`, a text line's corner. */
  readonly radius?: number;
}

const styles = StyleSheet.create({
  block: { backgroundColor: tokens.color.wash },
  card: {
    borderRadius: tokens.radius.card,
    padding: tokens.space.md,
    gap: tokens.space.sm,
    backgroundColor: tokens.color.surface,
    ...elevationStyle('card'),
  },
  hero: {
    borderRadius: tokens.radius.card,
    paddingVertical: tokens.space.md + tokens.space.xs,
    paddingHorizontal: tokens.space.lg,
    gap: tokens.space.sm,
    backgroundColor: tokens.color.surface,
    ...elevationStyle('card'),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.card,
    backgroundColor: tokens.color.surface,
    minHeight: tokens.target.row,
    ...elevationStyle('hairline'),
  },
  rowText: { flex: 1, gap: tokens.space.sm },
  rows: { gap: tokens.space.sm },
  group: { alignSelf: 'stretch' },
});

/** One placeholder bar. Still on its own; it breathes with the group it is placed in. */
export const Skeleton = ({
  width = '100%',
  height,
  radius = tokens.radius.sm,
}: SkeletonProps): ReactNode => (
  <View style={[styles.block, { width, height, borderRadius: radius }]} />
);

/**
 * A group of placeholders: one breath for all of them (one native animation, not one per bar),
 * and hidden from the accessibility tree.
 */
export const SkeletonGroup = ({ children }: { readonly children: ReactNode }): ReactNode => {
  const opacity = usePulse();
  return (
    <Animated.View
      accessibilityElementsHidden
      collapsable={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.group, { opacity }]}
    >
      {children}
    </Animated.View>
  );
};

/**
 * A card-shaped placeholder: a label line, a large line, a supporting line. `hero` takes the hero
 * card's proportions so the day's first card does not change size when it arrives.
 */
export const SkeletonCard = ({ hero = false }: { readonly hero?: boolean }): ReactNode => (
  <SkeletonGroup>
    <View style={hero ? styles.hero : styles.card}>
      <Skeleton height={tokens.typography.label.size} width="30%" />
      <Skeleton
        height={hero ? tokens.typography.display.size : tokens.typography.figure.size}
        radius={tokens.radius.md}
        width={hero ? '70%' : '45%'}
      />
      <Skeleton height={tokens.typography.secondary.size} width="55%" />
    </View>
  </SkeletonGroup>
);

/** `count` placeholders the height of a `ListItem` row. */
export const SkeletonRows = ({ count = 3 }: { readonly count?: number }): ReactNode => (
  <SkeletonGroup>
    <View style={styles.rows}>
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={styles.row}>
          <View style={styles.rowText}>
            <Skeleton
              height={tokens.typography.body.size}
              width={index % 2 === 0 ? '60%' : '48%'}
            />
            <Skeleton height={tokens.typography.label.size} width="38%" />
          </View>
        </View>
      ))}
    </View>
  </SkeletonGroup>
);
