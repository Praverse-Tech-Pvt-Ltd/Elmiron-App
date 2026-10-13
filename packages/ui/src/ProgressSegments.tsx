import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';

/**
 * FE-W102. B1's progress strip under "6 of 9": one segment per planned visit, the attended ones
 * in the accent.
 *
 * **It repeats the figure; it never replaces it.** The figure beside it carries the number in
 * words, so the strip is hidden from screen readers and a phone with no colour at all loses
 * nothing. It counts what the figure counts — visits attended, which includes a doctor who was
 * not available (MR-12 D3) — so it can never show a shortfall the words do not.
 *
 * Past `MAX_SEGMENTS` a strip of slivers stops reading as a count, so it becomes one continuous
 * bar filled in proportion.
 */
export interface ProgressSegmentsProps {
  readonly total: number;
  readonly filled: number;
}

export const MAX_SEGMENTS = 12;

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', gap: 3, height: 6 },
  segment: { flex: 1, borderRadius: 3, backgroundColor: tokens.color.washPressed },
  on: { backgroundColor: tokens.color.accent },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: tokens.color.washPressed,
    flexDirection: 'row',
    overflow: 'hidden',
  },
});

export const ProgressSegments = ({ total, filled }: ProgressSegmentsProps): ReactNode => {
  if (!(total > 0)) return null;
  const done = Math.max(0, Math.min(filled, total));

  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {total <= MAX_SEGMENTS ? (
        <View style={styles.strip}>
          {Array.from({ length: total }, (_, index) => (
            <View key={index} style={[styles.segment, index < done ? styles.on : null]} />
          ))}
        </View>
      ) : (
        <View style={styles.track}>
          <View style={[styles.on, { flex: done }]} />
          <View style={{ flex: total - done }} />
        </View>
      )}
    </View>
  );
};
