import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Heading, Secondary } from './Text';
import { StatusGlyph, STATUS_FILL } from './StatusGlyph';
import type { StatusKind } from './StatusGlyph';
import { elevationStyle } from './depth';

/**
 * FE-W101. An empty list, said as a designed state rather than as a stray grey line.
 *
 * The words are the caller's and unchanged — "No route for today", "Nothing matches “Iyer”" —
 * and they carry the whole meaning; the mark beside them is the status glyph in its own tinted
 * well, decorative and hidden from screen readers (§02: never colour or shape alone).
 *
 * **An empty state is not a failure.** `neutral` is the default and the usual answer: nothing is
 * planned, nothing matched. There is deliberately no `critical` here — a genuine failure is a
 * `Banner`, and styling "no doctors match" as an error teaches the MR that the app's red means
 * nothing.
 *
 * Left-aligned, like every other block in the app, so a two-line message reads as a sentence and
 * not as a centred poster.
 */
export type EmptyStateKind = Extract<StatusKind, 'neutral' | 'success' | 'info' | 'offline'>;

export interface EmptyStateProps {
  readonly title: string;
  readonly detail?: string;
  readonly kind?: EmptyStateKind;
}

const WELL = 40;

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: tokens.space.md,
    padding: tokens.space.md,
    borderRadius: tokens.radius.card,
    backgroundColor: tokens.color.surface,
    ...elevationStyle('card'),
  },
  well: {
    width: WELL,
    height: WELL,
    borderRadius: tokens.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  words: { flex: 1, gap: tokens.space.xs, paddingTop: tokens.space.xs },
});

export const EmptyState = ({ title, detail, kind = 'neutral' }: EmptyStateProps): ReactNode => (
  <View style={styles.box}>
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.well,
        // `neutral`'s own fill is the card, which would leave the mark floating; the wash gives it
        // the same tinted well every other kind has.
        { backgroundColor: kind === 'neutral' ? tokens.color.wash : STATUS_FILL[kind] },
      ]}
    >
      <StatusGlyph kind={kind} large />
    </View>
    <View style={styles.words}>
      <Heading>{title}</Heading>
      {detail === undefined ? null : <Secondary>{detail}</Secondary>}
    </View>
  </View>
);
