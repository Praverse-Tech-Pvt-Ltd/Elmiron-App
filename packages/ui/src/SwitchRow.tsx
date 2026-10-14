import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { BodyText, Label, Secondary } from './Text';
import { elevationStyle } from './depth';

/**
 * `FE-W133` — a setting the MR turns on or off: C4's row, title and detail on the left, the switch
 * on the right (`docs/design/phase2-first-run-and-the-day.dc.html`, the 50 × 30 track).
 *
 * **The whole row is the control**, at §05's row height, so the target is the row and not the 30pt
 * track. It is ONE accessible element with role `switch` and its checked state, so TalkBack says
 * "Send audio on WiFi only, switch, on" rather than reading two texts and a shape.
 *
 * **On/off is said in words beside the track**, never by position or colour alone. The off track
 * carries the `border` token's edge (controls only) so the control is visible against the card at
 * 3:1; the on track is the accent. No third grey, and nothing animates -- the thumb is drawn where
 * it is, so "Remove animations" has nothing to remove.
 *
 * `disabled` while a change is being saved: a second press must not race the first write.
 */
export interface SwitchRowProps {
  readonly title: string;
  readonly detail?: string;
  readonly value: boolean;
  readonly onValueChange: (next: boolean) => void;
  readonly disabled?: boolean;
}

const TRACK_WIDTH = 50;
const TRACK_HEIGHT = 30;
const THUMB = 24;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.sm,
    minHeight: tokens.target.row,
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.card,
    backgroundColor: tokens.color.surface,
    ...elevationStyle('card'),
  },
  pressed: { backgroundColor: tokens.color.wash },
  text: { flex: 1, gap: tokens.space.xs / 2 },
  control: { alignItems: 'center', gap: 2 },
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    padding: (TRACK_HEIGHT - THUMB) / 2,
    flexDirection: 'row',
  },
  trackOn: { backgroundColor: tokens.color.accent, justifyContent: 'flex-end' },
  trackOff: {
    backgroundColor: tokens.color.washPressed,
    borderWidth: 1,
    borderColor: tokens.color.border,
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: tokens.color.onAccent,
  },
  // The off thumb sits inside a 1pt edge, so it is 2pt smaller to keep the same gap.
  thumbOff: {
    width: THUMB - 2,
    height: THUMB - 2,
    borderRadius: (THUMB - 2) / 2,
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
});

/** The track's style, exported so a test can assert on/off without reading pixels. */
export const switchTrackStyle = (value: boolean): StyleProp<ViewStyle> => [
  styles.track,
  value ? styles.trackOn : styles.trackOff,
];

export const SwitchRow = ({
  title,
  detail,
  value,
  onValueChange,
  disabled = false,
}: SwitchRowProps): ReactNode => (
  <Pressable
    accessibilityRole="switch"
    accessibilityState={{ checked: value, disabled }}
    accessibilityLabel={detail === undefined ? title : `${title}. ${detail}`}
    disabled={disabled}
    onPress={() => {
      onValueChange(!value);
    }}
    style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
  >
    <View style={styles.text}>
      <BodyText>{title}</BodyText>
      {detail === undefined ? null : <Secondary>{detail}</Secondary>}
    </View>
    <View style={styles.control}>
      <View style={switchTrackStyle(value)}>
        <View style={[styles.thumb, value ? null : styles.thumbOff]} />
      </View>
      <Label muted>{value ? 'On' : 'Off'}</Label>
    </View>
  </Pressable>
);
