import type { ReactNode } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Label } from './Text';

export interface TextFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly secure?: boolean;
  readonly autoCapitalize?: 'none' | 'sentences';
  readonly keyboardType?: 'default' | 'email-address';
  readonly editable?: boolean;
}

const styles = StyleSheet.create({
  group: { gap: tokens.space.xs },
  input: {
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.sm,
    paddingHorizontal: tokens.space.sm,
    color: tokens.color.textPrimary,
    fontSize: tokens.typography.body.size,
    backgroundColor: tokens.color.background,
    minHeight: 48,
  },
});

export const TextField = ({
  label,
  value,
  onChangeText,
  secure = false,
  autoCapitalize = 'sentences',
  keyboardType = 'default',
  editable = true,
}: TextFieldProps): ReactNode => (
  <View style={styles.group}>
    <Label>{label}</Label>
    <TextInput
      accessibilityLabel={label}
      autoCapitalize={autoCapitalize}
      editable={editable}
      keyboardType={keyboardType}
      onChangeText={onChangeText}
      secureTextEntry={secure}
      style={styles.input}
      value={value}
    />
  </View>
);
