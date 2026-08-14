import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { tokens } from '@elmiron/ui-tokens';
import { BodyText, Label } from './Text';

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
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.color.surface,
    gap: tokens.space.xs,
    minHeight: 48,
    justifyContent: 'center',
  },
  pressed: { opacity: 0.75 },
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
