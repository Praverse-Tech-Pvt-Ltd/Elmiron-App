import { useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { BodyText, Label, Secondary } from './Text';
import { TextField } from './TextField';
import { BottomSheet } from './BottomSheet';
import { SurfaceContext } from './surface';
import { useT } from './i18n';

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
  /**
   * `FE-W191`. The label of a filter field at the top of the sheet — "Find a doctor". Shown only
   * when the list is long enough to need one (`FILTER_FROM`): a territory can hold a hundred
   * doctors, and scrolling a hundred 70pt rows to find one name is the slowest way to start an
   * unplanned visit. Omit it and the sheet is the plain list.
   */
  readonly filterLabel?: string;
}

/** `FE-W191`. From how many options a `filterLabel` turns into a filter field. */
export const FILTER_FROM = 8;

/** `FE-W191`. The options whose label contains the query, ignoring case; all of them for none. */
export const filterOptions = (
  options: readonly SelectOption[],
  query: string,
): readonly SelectOption[] => {
  const needle = query.trim().toLocaleLowerCase();
  return needle === ''
    ? options
    : options.filter((option) => option.label.toLocaleLowerCase().includes(needle));
};

/**
 * `FE-W189`. The chevron's geometry — arm length and stroke, as `TabIcon` draws its shapes: in
 * `View`s, never a font glyph that arrives as tofu on an OEM font stack.
 */
const CHEVRON = 8;
const CHEVRON_STROKE = 2;
/** The check on the chosen row: a short arm and a long one. */
const CHECK_SHORT = 6;
const CHECK_LONG = 12;

const styles = StyleSheet.create({
  group: { gap: tokens.space.xs },
  control: {
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.control,
    paddingHorizontal: tokens.space.md,
    // `FE-W189`. The value and the chevron share a row; the value takes the room and wraps.
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.sm,
    backgroundColor: tokens.color.surface,
    minHeight: tokens.target.primary,
  },
  value: { flex: 1, paddingVertical: tokens.space.sm },
  chevron: {
    width: CHEVRON,
    height: CHEVRON,
    borderRightWidth: CHEVRON_STROKE,
    borderBottomWidth: CHEVRON_STROKE,
    borderColor: tokens.color.textSecondary,
    // A square's corner turned to point down, lifted so the drawn point sits on the line's middle.
    transform: [{ rotate: '45deg' }],
    marginTop: -CHEVRON / 2,
    marginRight: CHEVRON_STROKE,
  },
  rowWords: { flex: 1 },
  check: {
    width: CHECK_SHORT,
    height: CHECK_LONG,
    borderRightWidth: CHEVRON_STROKE,
    borderBottomWidth: CHEVRON_STROKE,
    borderColor: tokens.color.accent,
    transform: [{ rotate: '45deg' }],
    marginTop: -CHEVRON_STROKE,
    marginRight: tokens.space.xs,
  },
  pressed: { backgroundColor: tokens.color.wash },
  disabled: { opacity: 0.5, backgroundColor: tokens.color.wash },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.sm,
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
  placeholder,
  disabled = false,
  filterLabel,
}: SelectProps): ReactNode => {
  const { t } = useT();
  const prompt = placeholder ?? t('common.chooseOne');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const chosen = options.find((option) => option.value === value);
  const filtering = filterLabel !== undefined && options.length >= FILTER_FROM;
  const shown = filtering ? filterOptions(options, query) : options;
  // The query is forgotten when the sheet closes: the next opening starts from the whole list.
  const close = (): void => {
    setOpen(false);
    setQuery('');
  };

  return (
    <View style={styles.group}>
      <Label>{label}</Label>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ disabled, expanded: open }}
        accessibilityValue={{ text: chosen?.label ?? prompt }}
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
        {/*
          `FE-W176`. The control is a white field whatever it sits on, so its words take paper ink.
          The label above it stays on the surrounding ground and reads that ground's ink.
        */}
        <SurfaceContext.Provider value="paper">
          <View style={styles.value}>
            {chosen === undefined ? (
              <BodyText muted>{prompt}</BodyText>
            ) : (
              <BodyText>{chosen.label}</BodyText>
            )}
          </View>
          {/*
            `FE-W189`. A white box with words in it is a text field to anyone who has used a phone:
            the QA pass found reps tapping Samples' "Kind" expecting a keyboard. The chevron says
            "opens a list", which is what this does.
          */}
          <View
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={styles.chevron}
            testID="select-chevron"
          />
        </SurfaceContext.Provider>
      </Pressable>

      <BottomSheet onDismiss={close} title={label} visible={open}>
        {filtering ? (
          <TextField
            autoCapitalize="none"
            label={filterLabel}
            onChangeText={setQuery}
            onClear={() => {
              setQuery('');
            }}
            value={query}
          />
        ) : null}
        {filtering && shown.length === 0 ? <Secondary>{t('common.noMatch')}</Secondary> : null}
        {shown.map((option) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: option.value === value }}
            key={option.value}
            onPress={() => {
              onChange(option.value);
              close();
            }}
            style={({ pressed }) => [
              styles.row,
              option.value === value ? styles.rowChosen : null,
              pressed ? styles.rowPressed : null,
            ]}
          >
            <View style={styles.rowWords}>
              <BodyText>{option.label}</BodyText>
            </View>
            {/*
              `FE-W189`. The chosen row is marked by a check as well as its tint: a tint alone is a
              colour carrying meaning by itself, which §05 does not allow.
            */}
            {option.value === value ? (
              <View
                accessibilityElementsHidden
                importantForAccessibility="no"
                style={styles.check}
                testID="select-chosen-check"
              />
            ) : null}
          </Pressable>
        ))}
      </BottomSheet>
    </View>
  );
};
