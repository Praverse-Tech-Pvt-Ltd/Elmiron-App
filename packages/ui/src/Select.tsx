import { useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { BodyText, Label } from './Text';
import { BottomSheet } from './BottomSheet';

/**
 * Phase 1 §05: "opens a bottom sheet, never a dropdown."
 *
 * That is a reach decision, not a styling one — see the note on `BottomSheet`. It
 * is written as a rule rather than a preference because a dropdown is what every
 * component library hands you by default, so the cheap path and the right path
 * disagree here.
 *
 * The label stays visible above the control whether or not anything is chosen,
 * matching `TextField`: §05 bans placeholder-only labels, because the moment a
 * value is entered the placeholder is gone and the field no longer says what it is.
 */
export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectProps {
  readonly label: string;
  readonly options: readonly SelectOption[];
  /** Undefined means nothing chosen yet — the control shows `placeholder`. */
  readonly value?: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
}

const styles = StyleSheet.create({
  group: { gap: tokens.space.xs },
  control: {
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.control,
    paddingHorizontal: tokens.space.md,
    justifyContent: 'center',
    backgroundColor: tokens.color.surface,
    minHeight: tokens.target.primary,
  },
  pressed: { backgroundColor: tokens.color.wash },
  disabled: { opacity: 0.5, backgroundColor: tokens.color.wash },
  row: {
    justifyContent: 'center',
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.well,
    minHeight: tokens.target.row,
  },
  rowPressed: { backgroundColor: tokens.color.wash },
  rowChosen: { backgroundColor: tokens.color.successFill },
});

export const Select = ({
  label,
  options,
  value,
  onChange,
  placeholder = 'Choose one',
  disabled = false,
}: SelectProps): ReactNode => {
  const [open, setOpen] = useState(false);
  const chosen = options.find((option) => option.value === value);

  return (
    <View style={styles.group}>
      <Label>{label}</Label>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ disabled, expanded: open }}
        accessibilityValue={{ text: chosen?.label ?? placeholder }}
        disabled={disabled}
        onPress={() => {
          setOpen(true);
        }}
        style={({ pressed }) => [
          styles.control,
          pressed ? styles.pressed : null,
          disabled ? styles.disabled : null,
        ]}
      >
        {chosen === undefined ? (
          <BodyText muted>{placeholder}</BodyText>
        ) : (
          <BodyText>{chosen.label}</BodyText>
        )}
      </Pressable>

      <BottomSheet
        onDismiss={() => {
          setOpen(false);
        }}
        title={label}
        visible={open}
      >
        {options.map((option) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: option.value === value }}
            key={option.value}
            onPress={() => {
              onChange(option.value);
              setOpen(false);
            }}
            style={({ pressed }) => [
              styles.row,
              option.value === value ? styles.rowChosen : null,
              pressed ? styles.rowPressed : null,
            ]}
          >
            <BodyText>{option.label}</BodyText>
          </Pressable>
        ))}
      </BottomSheet>
    </View>
  );
};
