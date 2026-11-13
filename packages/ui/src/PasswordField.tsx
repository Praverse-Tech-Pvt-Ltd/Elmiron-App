import { useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fontFamilyFor, tokens } from '@fieldforce/ui-tokens';
import { TextField } from './TextField';
import { useT } from './i18n';

/**
 * `FE-W192` — a password field the rep can check before pressing Sign in.
 *
 * Sign-in is typed on a phone keyboard, often outdoors, and a mistyped password was only found out
 * from the server's refusal. "Show password" turns the dots into the letters typed, and back. It is
 * off every time the screen opens: a password left showing on a shared handset is somebody else's.
 *
 * The control sits under the field at its right edge, at the tap floor, in the accent ink every
 * quiet action uses. It is a toggle a screen reader announces with its state.
 */
export interface PasswordFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly editable?: boolean;
}

const styles = StyleSheet.create({
  group: { gap: tokens.space.xxs },
  toggle: {
    alignSelf: 'flex-end',
    justifyContent: 'center',
    minHeight: tokens.target.floor,
    minWidth: tokens.target.floor,
    paddingHorizontal: tokens.space.sm,
    // The words, not the control's padding, line up with the field's right edge.
    marginRight: -tokens.space.sm,
    borderRadius: tokens.radius.control,
  },
  // §05: a press darkens the fill, never fades it.
  togglePressed: { backgroundColor: tokens.color.wash },
  toggleLabel: {
    fontSize: tokens.typography.tappable.size,
    lineHeight: tokens.typography.tappable.lineHeight,
    fontWeight: tokens.typography.tappable.weight,
    fontFamily: fontFamilyFor(tokens.typography.tappable.weight),
    color: tokens.color.accent,
  },
});

export const PasswordField = ({
  label,
  value,
  onChangeText,
  editable = true,
}: PasswordFieldProps): ReactNode => {
  const { t } = useT();
  const [shown, setShown] = useState(false);
  return (
    <View style={styles.group}>
      <TextField
        label={label}
        value={value}
        onChangeText={onChangeText}
        secure={!shown}
        password
        autoCapitalize="none"
        editable={editable}
      />
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel={t('signIn.showPassword')}
        accessibilityState={{ checked: shown }}
        onPress={() => {
          setShown((current) => !current);
        }}
        style={({ pressed }) => [styles.toggle, pressed ? styles.togglePressed : null]}
      >
        <Text style={styles.toggleLabel}>
          {shown ? t('signIn.hidePassword') : t('signIn.showPassword')}
        </Text>
      </Pressable>
    </View>
  );
};
