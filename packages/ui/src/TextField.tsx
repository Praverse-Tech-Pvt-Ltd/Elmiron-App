import { useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { fontFamilyFor, tokens } from '@fieldforce/ui-tokens';
import { Label } from './Text';

/**
 * Phase 1 §05: 60pt, a 19pt value, and a label that is always visible.
 *
 * **Never placeholder-only.** A placeholder disappears the moment the field has a
 * value, so a form filled in a corridor becomes a column of numbers with nothing
 * saying which is the odometer. The label is a sibling of the input, not a hint
 * inside it, and there is no prop here to turn it off.
 *
 * The value is 19pt against a 16pt body — larger than the copy around it, because
 * it is the part that gets checked at arm's length before a tap on Save.
 *
 * `error` carries the correction, not just the failure: §05's own example is
 * "Needs 5 digits — yesterday you ended at 41,208". A message that says a value is
 * wrong without saying what right looks like sends the MR back to a paper log.
 */
export interface TextFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly secure?: boolean;
  readonly autoCapitalize?: 'none' | 'sentences';
  readonly keyboardType?: 'default' | 'email-address' | 'number-pad';
  readonly editable?: boolean;
  /** What is wrong and what right looks like. Renders the field in `critical`. */
  readonly error?: string;
  /** Supporting line when there is no error — "set by your manager". */
  readonly help?: string;
  /** Adds a clear affordance inside the field. Omit and none is shown. */
  readonly onClear?: () => void;
}

const styles = StyleSheet.create({
  group: { gap: tokens.space.xs },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.control,
    paddingHorizontal: tokens.space.md,
    backgroundColor: tokens.color.surface,
    minHeight: tokens.target.primary,
  },
  // Focus thickens the same edge rather than adding a ring outside it, so the
  // field does not shift the layout of a form when the keyboard opens.
  focused: { borderColor: tokens.color.accent, borderWidth: 3 },
  errored: { borderColor: tokens.color.critical },
  disabled: { backgroundColor: tokens.color.wash, opacity: 0.7 },
  input: {
    flex: 1,
    color: tokens.color.textPrimary,
    fontSize: tokens.typography.value.size,
    fontFamily: fontFamilyFor(tokens.typography.value.weight),
    lineHeight: tokens.typography.value.lineHeight,
    paddingVertical: tokens.space.sm,
  },
  clear: {
    width: tokens.target.floor,
    height: tokens.target.floor,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -tokens.space.sm,
  },
  clearPressed: { opacity: 0.5 },
  clearGlyph: { fontSize: 18, color: tokens.color.textSecondary },
  error: {
    color: tokens.color.critical,
    fontSize: tokens.typography.label.size,
    lineHeight: tokens.typography.label.lineHeight,
    fontWeight: tokens.typography.label.weight,
    fontFamily: fontFamilyFor(tokens.typography.label.weight),
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
  error,
  help,
  onClear,
}: TextFieldProps): ReactNode => {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.group}>
      <Label>{label}</Label>
      <View
        style={[
          styles.field,
          focused ? styles.focused : null,
          error === undefined ? null : styles.errored,
          editable ? null : styles.disabled,
        ]}
      >
        <TextInput
          accessibilityLabel={label}
          autoCapitalize={autoCapitalize}
          editable={editable}
          keyboardType={keyboardType}
          onBlur={() => {
            setFocused(false);
          }}
          onChangeText={onChangeText}
          onFocus={() => {
            setFocused(true);
          }}
          secureTextEntry={secure}
          style={styles.input}
          value={value}
        />
        {onClear === undefined || value === '' ? null : (
          <Pressable
            accessibilityLabel={`Clear ${label}`}
            accessibilityRole="button"
            onPress={onClear}
            style={({ pressed }) => [styles.clear, pressed ? styles.clearPressed : null]}
          >
            <Text style={styles.clearGlyph}>✕</Text>
          </Pressable>
        )}
      </View>
      {error === undefined ? (
        help === undefined ? null : (
          <Label muted>{help}</Label>
        )
      ) : (
        <Text style={styles.error}>{error}</Text>
      )}
    </View>
  );
};
