import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { BodyText, Heading, Label } from './Text';
import { Screen } from './Screen';

/**
 * The upload queue — the MR's only proof their day's work is safe.
 *
 * **A pure function of reducer state.** It takes state, it renders, it decides
 * nothing. Every verdict belongs to the server; this file cannot promote, demote,
 * reorder or retire an item, and there is deliberately no branch here that could.
 *
 * The props are declared structurally rather than imported from the reducer, because
 * the reducer lives in `apps/field` and a package must not depend on an app. A
 * `SyncQueueState` satisfies `QueueScreenProps` by shape, so the route binding passes
 * its state straight through and TypeScript checks the fit at that call site.
 */

/** Attempts after which the row says "still trying" instead of "waiting to send". */
export const LONG_RETRY_AFTER_ATTEMPTS = 3;

export interface QueueScreenRejection {
  readonly code: string;
  /** Backend's sentence. Rendered verbatim; `null` when the server sent none. */
  readonly explanation: string | null;
  readonly deadLettered: boolean;
  /** Server clock. The only timestamp this screen is allowed to show. */
  readonly receivedAt: string;
}

export interface QueueScreenItem {
  readonly id: string;
  readonly entity: string;
  readonly status: 'queued' | 'in_flight' | 'synced' | 'conflict' | 'failed';
  readonly attemptCount: number;
}

export interface QueueScreenProps {
  readonly items: readonly QueueScreenItem[];
  readonly rejections: Readonly<Record<string, QueueScreenRejection>>;
  /** Overridable so a test can move the threshold without editing the component. */
  readonly longRetryAfterAttempts?: number;
}

export type QueueRowState = 'sent' | 'waiting' | 'waiting-long' | 'refused' | 'needs-attention';

/**
 * Which of the five states a row is in.
 *
 * Exported so the presentation rule can be asserted directly rather than only
 * through rendered text. **`waiting` and `waiting-long` are the same underlying
 * state** — the server has not answered either — and the only difference is what the
 * MR is told. Nothing downstream may branch on the distinction.
 */
export const rowStateFor = (
  item: QueueScreenItem,
  rejection: QueueScreenRejection | undefined,
  longRetryAfterAttempts: number = LONG_RETRY_AFTER_ATTEMPTS,
): QueueRowState => {
  if (rejection !== undefined) return rejection.deadLettered ? 'needs-attention' : 'refused';
  if (item.status === 'synced') return 'sent';
  return item.attemptCount >= longRetryAfterAttempts ? 'waiting-long' : 'waiting';
};

/**
 * PLACEHOLDER GLYPHS.
 *
 * Basic Unicode symbols, deliberately not emoji: emoji presentation varies across
 * Android OEM font stacks and can render as tofu on exactly the Xiaomi/Oppo/Vivo
 * ROMs this product targets. Real icons arrive with the brand assets.
 *
 * Each is decorative and hidden from screen readers — the text label carries the
 * meaning. Without that, TalkBack announces "heavy check mark, Sent", which is how
 * icon-plus-label satisfies a checklist while being worse for the person it is for.
 */
const GLYPH: Readonly<Record<QueueRowState, string>> = {
  sent: '\u2713',
  waiting: '\u21BB',
  'waiting-long': '\u25F7',
  refused: '\u2715',
  'needs-attention': '\u2298',
};

/** The text label. Meaning is never carried by colour or glyph alone. */
const LABEL: Readonly<Record<QueueRowState, string>> = {
  sent: 'Sent',
  waiting: 'Waiting to send',
  'waiting-long': 'Still trying',
  refused: 'Refused',
  'needs-attention': 'Needs someone to look',
};

const styles = StyleSheet.create({
  row: {
    paddingVertical: tokens.space.md,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.color.surface,
    gap: tokens.space.xs,
    minHeight: 44,
    justifyContent: 'center',
  },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm },
  glyph: {
    color: tokens.color.textSecondary,
    fontSize: tokens.typography.body.size,
    fontWeight: '500',
  },
  empty: { gap: tokens.space.sm },
});

const QueueRow = ({
  item,
  rejection,
  longRetryAfterAttempts,
}: {
  readonly item: QueueScreenItem;
  readonly rejection: QueueScreenRejection | undefined;
  readonly longRetryAfterAttempts: number;
}): ReactNode => {
  const state = rowStateFor(item, rejection, longRetryAfterAttempts);
  return (
    <View style={styles.row}>
      <View style={styles.statusLine}>
        {/* Decorative. The label beside it is what a screen reader announces. */}
        <Text importantForAccessibility="no" accessibilityElementsHidden style={styles.glyph}>
          {GLYPH[state]}
        </Text>
        <BodyText>{LABEL[state]}</BodyText>
      </View>
      <Label muted>{item.entity}</Label>
      {rejection === undefined ? null : (
        <>
          {/* Backend's sentence, verbatim. Never reworded, truncated or wrapped. */}
          {rejection.explanation === null ? null : <BodyText>{rejection.explanation}</BodyText>}
          {/* The server's clock. No duration is computed anywhere on this screen. */}
          <Label muted>{`Server recorded this at ${rejection.receivedAt}`}</Label>
          {rejection.deadLettered ? (
            <Label muted>This can be sent again once someone reviews it.</Label>
          ) : null}
        </>
      )}
    </View>
  );
};

export const QueueScreen = ({
  items,
  rejections,
  longRetryAfterAttempts = LONG_RETRY_AFTER_ATTEMPTS,
}: QueueScreenProps): ReactNode => {
  const outstanding = items.filter((item) => item.status !== 'synced');

  return (
    <Screen scrollable>
      <Heading>Your upload queue</Heading>

      {outstanding.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.statusLine}>
            <Text importantForAccessibility="no" accessibilityElementsHidden style={styles.glyph}>
              {GLYPH.sent}
            </Text>
            {/* Reassuring, not an error. Nothing waiting is the good outcome. */}
            <BodyText>Everything is sent</BodyText>
          </View>
          <BodyText muted>Nothing is waiting to leave this phone.</BodyText>
        </View>
      ) : (
        // Rendered in the order given. The long-retry threshold changes what a row
        // SAYS and never where it sits, because position is read as priority and
        // priority is a verdict the server owns.
        outstanding.map((item) => (
          <QueueRow
            key={item.id}
            item={item}
            rejection={rejections[item.id]}
            longRetryAfterAttempts={longRetryAfterAttempts}
          />
        ))
      )}
    </Screen>
  );
};
