import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { fontFamilyFor, tokens } from '@fieldforce/ui-tokens';
import { BodyText } from './Text';
import { StatusGlyph } from './StatusGlyph';
import type { StatusKind } from './StatusGlyph';

/** §05: five seconds. Long enough to read a short line, short enough not to nag. */
export const TOAST_DURATION_MS = 5000;

/**
 * Phase 1 §05: above the reach zone, five seconds, never blocks.
 *
 * "Never blocks" is the load-bearing word and it is why this sits in a
 * `pointerEvents="box-none"` overlay rather than in a modal. An MR checking in at
 * a clinic door is mid-task; a confirmation that steals the next tap costs more
 * than the confirmation is worth. Everything under the toast stays live, including
 * the primary action it is reporting on.
 *
 * It sits *above* the reach zone rather than inside it for the same reason — the
 * zone belongs to the screen's primary action, and a toast that lands on top of
 * that is a toast the thumb dismisses by accident.
 *
 * The action is optional and single. Two actions on a five-second timer is a
 * decision nobody can make in five seconds.
 */
export interface ToastAction {
  readonly label: string;
  readonly onPress: () => void;
}

export interface ToastProps {
  readonly message: string;
  readonly status: StatusKind;
  readonly onDismiss: () => void;
  readonly action?: ToastAction;
  /** Overridable for tests. Defaults to §05's five seconds. */
  readonly durationMs?: number;
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', left: 0, right: 0, paddingHorizontal: tokens.space.md },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.sm,
    backgroundColor: tokens.color.surface,
    borderRadius: tokens.radius.control,
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    minHeight: tokens.target.secondary,
    shadowColor: '#14150F',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  message: { flex: 1 },
  action: {
    justifyContent: 'center',
    paddingHorizontal: tokens.space.sm,
    borderRadius: tokens.radius.well,
    minHeight: tokens.target.floor,
  },
  actionPressed: { backgroundColor: tokens.color.wash },
  actionLabel: {
    color: tokens.color.accent,
    fontSize: tokens.typography.label.size,
    lineHeight: tokens.typography.label.lineHeight,
    fontWeight: tokens.typography.control.weight,
    fontFamily: fontFamilyFor(tokens.typography.control.weight),
  },
});

export const Toast = ({
  message,
  status,
  onDismiss,
  action,
  durationMs = TOAST_DURATION_MS,
}: ToastProps): ReactNode => {
  const { height } = useWindowDimensions();

  useEffect(() => {
    const timer = setTimeout(onDismiss, durationMs);
    return () => {
      clearTimeout(timer);
    };
  }, [durationMs, onDismiss]);

  return (
    <View
      pointerEvents="box-none"
      style={[styles.overlay, { bottom: height * tokens.target.reachZoneFraction }]}
    >
      <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.toast}>
        <StatusGlyph kind={status} />
        <View style={styles.message}>
          <BodyText>{message}</BodyText>
        </View>
        {action === undefined ? null : (
          <Pressable
            accessibilityRole="button"
            onPress={action.onPress}
            style={({ pressed }) => [styles.action, pressed ? styles.actionPressed : null]}
          >
            <Text style={styles.actionLabel}>{action.label}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
};
