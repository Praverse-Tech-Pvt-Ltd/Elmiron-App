import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { BodyText, Label } from './Text';
import { StatusGlyph } from './StatusGlyph';
import type { StatusKind } from './StatusGlyph';

/**
 * Phase 1 §05: on every screen, countable, tappable.
 *
 * The rule that shapes the whole component is §05's last line: **only the last row
 * is critical, and "waiting" is never red.** An MR offline all morning has done
 * nothing wrong, and an app that spends the morning showing them a red badge for
 * it teaches them to ignore red by lunchtime. So `waiting`, `wifi` and `sending`
 * are ordinary states in ordinary tones, and `failed` — where sending was tried
 * and did not work — gets `critical`.
 *
 * **`unreadable` (`FE-W44`) is the second `critical` state, and the exception is
 * deliberate.** It is not the MR waiting; it is the app unable to say anything at
 * all about their work. The only useful thing they can do about it is tell
 * somebody, which is what red is for.
 *
 * Countable means the number is in the text, not implied by a dot. Tappable means
 * `onPress` opens the list; the caller decides where that goes, because this
 * package knows nothing about routing.
 */
export type SyncQueueState =
  | {
      readonly kind: 'idle';
      /**
       * When the server last took delivery. `null` when nothing has been sent yet —
       * the queue screen's committed rule applies here too: a queued item has no
       * server timestamp, and the device clock must not be passed off as though the
       * server knew about the work.
       */
      readonly at: string | null;
    }
  | {
      readonly kind: 'sending';
      readonly done: number;
      readonly total: number;
      readonly size: string;
    }
  | { readonly kind: 'waiting'; readonly count: number }
  | { readonly kind: 'wifi'; readonly count: number }
  | { readonly kind: 'failed'; readonly count: number; readonly attempts: number }
  /**
   * **`FE-W44`. The queue could not be read, so no claim can be made about it.**
   *
   * Not `idle`: "Everything sent" asserts the writes reached the server, and when the store
   * cannot be read the app does not know what was in it. Not `waiting` either — that counts
   * something, and there is no count to give.
   */
  | { readonly kind: 'unreadable' };

export interface SyncQueueIndicatorProps {
  readonly state: SyncQueueState;
  /** Opens the queue list. §05 requires the indicator to be tappable. */
  readonly onPress: () => void;
  /** Label for the trailing action — "See list", "Send now", "Retry". */
  readonly actionLabel?: string;
}

const describe = (state: SyncQueueState): { status: StatusKind; message: string; meta: string } => {
  switch (state.kind) {
    case 'idle':
      return { status: 'success', message: 'Everything sent', meta: state.at ?? '' };
    case 'sending':
      return {
        status: 'info',
        message: `Sending ${String(state.done)} of ${String(state.total)}`,
        meta: state.size,
      };
    case 'waiting':
      return {
        status: 'offline',
        message: `${String(state.count)} waiting · no signal`,
        meta: '',
      };
    case 'wifi':
      return { status: 'offline', message: `${String(state.count)} waiting for WiFi`, meta: '' };
    case 'failed':
      return {
        status: 'critical',
        message: `${String(state.count)} couldn't send · tried ${String(state.attempts)} times`,
        meta: '',
      };
    case 'unreadable':
      return {
        status: 'critical',
        message: "Can't read your queue",
        meta: 'nothing here is confirmed',
      };
  }
};

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.control,
    backgroundColor: tokens.color.surface,
    minHeight: tokens.target.secondary,
  },
  failed: { backgroundColor: tokens.color.criticalFill },
  offline: {
    backgroundColor: tokens.color.offlineFill,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: tokens.color.offlineEdge,
  },
  pressed: { backgroundColor: tokens.color.wash },
  message: { flex: 1 },
});

export const SyncQueueIndicator = ({
  state,
  onPress,
  actionLabel,
}: SyncQueueIndicatorProps): ReactNode => {
  const { status, message, meta } = describe(state);
  const trailing = actionLabel ?? meta;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={trailing === '' ? message : `${message}. ${trailing}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        status === 'critical' ? styles.failed : null,
        status === 'offline' ? styles.offline : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <StatusGlyph kind={status} />
      <View style={styles.message}>
        <BodyText>{message}</BodyText>
      </View>
      {trailing === '' ? null : <Label muted>{trailing}</Label>}
    </Pressable>
  );
};
