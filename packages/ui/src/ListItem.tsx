import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { BodyText, Label } from './Text';
import { StatusGlyph } from './StatusGlyph';
import type { StatusKind } from './StatusGlyph';

/**
 * Phase 1 §05: 70pt minimum, status glyph mandatory, colour never alone.
 *
 * `status` has no default. A row in this app always means something has or has not
 * happened to a visit — synced, declined, saved on the phone, not in today's plan
 * — and a row that renders without saying which is a row whose state the MR has to
 * guess. Making it required puts that decision at the call site, where the answer
 * is known.
 *
 * `detail` carries the words for the same state, so the glyph is reinforcement and
 * never the only carrier. §02.
 */
export interface ListItemProps {
  readonly title: string;
  /** The state in words — "09:20 · consented · synced". Required, per §02. */
  readonly detail: string;
  readonly status: StatusKind;
  /** Trailing metadata, usually a time. */
  readonly meta?: string;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  /** Omit for a row that only displays. A row without this is not pressable. */
  readonly onPress?: () => void;
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.sm,
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.card,
    backgroundColor: tokens.color.surface,
    minHeight: tokens.target.row,
  },
  text: { flex: 1, gap: 2 },
  detail: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.xs },
  pressed: { backgroundColor: tokens.color.wash },
  selected: { backgroundColor: tokens.color.successFill },
  // FE-D7 2. Each ground presses to its own darker step, as the design's `style-active` does. The
  // offline row used to press to `wash`, which is `offlineFill` — a press that changed nothing.
  offlinePressed: { backgroundColor: tokens.color.washPressed },
  selectedPressed: { backgroundColor: tokens.color.successFillPressed },
  offline: {
    backgroundColor: tokens.color.offlineFill,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: tokens.color.offlineEdge,
  },
  disabled: { opacity: 0.5 },
});

/**
 * The row's ground, pressed or not. Exported so the press can be asserted: React Native drives
 * `pressed` through the responder system, and a fired press event does not flip it.
 */
export const listItemStyle = (
  status: StatusKind,
  {
    pressed = false,
    selected = false,
    disabled = false,
  }: { readonly pressed?: boolean; readonly selected?: boolean; readonly disabled?: boolean },
): StyleProp<ViewStyle> => [
  styles.base,
  status === 'offline' ? styles.offline : null,
  selected ? styles.selected : null,
  disabled ? styles.disabled : null,
  pressed
    ? selected
      ? styles.selectedPressed
      : status === 'offline'
        ? styles.offlinePressed
        : styles.pressed
    : null,
];

export const ListItem = ({
  title,
  detail,
  status,
  meta,
  selected = false,
  disabled = false,
  onPress,
}: ListItemProps): ReactNode => {
  const body = (
    <>
      <View style={styles.text}>
        <BodyText>{title}</BodyText>
        <View style={styles.detail}>
          <StatusGlyph kind={status} />
          <Label muted>{detail}</Label>
        </View>
      </View>
      {meta === undefined ? null : <Label muted>{meta}</Label>}
    </>
  );

  if (onPress === undefined || disabled) {
    return (
      <View
        accessibilityState={{ disabled, selected }}
        style={listItemStyle(status, { selected, disabled })}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => listItemStyle(status, { pressed, selected })}
    >
      {body}
    </Pressable>
  );
};
