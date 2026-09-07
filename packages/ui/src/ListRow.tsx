import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { BodyText, Label } from './Text';

/**
 * The plain row: a title, an optional detail, an optional press.
 *
 * Phase 1 §05 specifies `ListItem` — 70pt, with a mandatory status glyph — for
 * every row that reports the state of a visit. This one stays for rows that report
 * no state at all, such as a navigation destination, and it takes its size and its
 * press fill from the tokens rather than from the literals it used to carry.
 */
export interface ListRowProps {
  readonly title: string;
  readonly detail?: string;
  /** Omit for a row that only displays. A row without this is not pressable. */
  readonly onPress?: () => void;
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: tokens.space.md,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.card,
    backgroundColor: tokens.color.surface,
    gap: tokens.space.xs,
    minHeight: tokens.target.secondary,
    justifyContent: 'center',
  },
  // §05: press darkens the fill. It never fades and never scales.
  pressed: { backgroundColor: tokens.color.wash },
});

export const ListRow = ({ title, detail, onPress }: ListRowProps): ReactNode => {
  const body = (
    <>
      <BodyText>{title}</BodyText>
      {detail === undefined ? null : <Label muted>{detail}</Label>}
    </>
  );

  if (onPress === undefined) {
    return <View style={styles.base}>{body}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.base, pressed ? styles.pressed : null]}
    >
      {body}
    </Pressable>
  );
};
