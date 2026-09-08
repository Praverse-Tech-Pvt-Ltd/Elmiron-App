import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { fontFamilyFor, tokens } from '@fieldforce/ui-tokens';
import { BodyText, Heading, Label } from './Text';
import { Button } from './Button';
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
  /**
   * Server clock, or null when the server sent none. The only timestamp this screen is
   * allowed to show — and since MR-08 C5 it is nullable, because the field used to be
   * filled with the DEVICE clock and rendered behind the words "Server recorded this
   * at". Nothing renders when it is null.
   */
  readonly receivedAt: string | null;
}

export interface QueueScreenItem {
  readonly id: string;
  readonly entity: string;
  readonly status: 'queued' | 'in_flight' | 'synced' | 'conflict' | 'failed';
  readonly attemptCount: number;
  /** Server clock, set when the server took delivery. `null` while still queued. */
  readonly syncedAt?: string | null;
}

export interface QueueScreenProps {
  readonly items: readonly QueueScreenItem[];
  readonly rejections: Readonly<Record<string, QueueScreenRejection>>;
  /** Overridable so a test can move the threshold without editing the component. */
  readonly longRetryAfterAttempts?: number;
  /**
   * S3's "Try again now". Absent until something can actually retry — a button
   * that does nothing on the screen reporting a failure is the cruellest possible
   * place for one.
   */
  readonly onRetry?: () => void;
  /** S3's "Tell the help desk". Absent until there is a help desk to tell. */
  readonly onContactSupport?: () => void;
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
 * S3 — what is stuck, and what got through despite it.
 *
 * **Scoping the damage is the whole job of this block.** An MR who sees "upload
 * failed" at 19:10 has no way to tell whether their day's work exists. Naming the
 * entities that did go through, and the ones that did not, is the difference
 * between a bad evening and a re-entered day.
 *
 * `refused` items are deliberately NOT counted here. A refusal is the server
 * answering, and the row already carries its sentence verbatim; folding it into
 * "won't go" would turn a decision into a malfunction.
 *
 * Returns `null` when nothing is stuck, so the caller renders no block at all
 * rather than an empty reassurance.
 */
export interface QueueStuckSummary {
  readonly count: number;
  readonly stuckEntities: readonly string[];
  readonly sentEntities: readonly string[];
}

export const stuckSummaryFor = (
  items: readonly QueueScreenItem[],
  rejections: Readonly<Record<string, QueueScreenRejection>>,
  longRetryAfterAttempts: number = LONG_RETRY_AFTER_ATTEMPTS,
): QueueStuckSummary | null => {
  const stuck = items.filter((item) => {
    const state = rowStateFor(item, rejections[item.id], longRetryAfterAttempts);
    return state === 'waiting-long' || state === 'needs-attention';
  });
  if (stuck.length === 0) return null;

  const unique = (values: readonly string[]): readonly string[] => [...new Set(values)].sort();

  return {
    count: stuck.length,
    stuckEntities: unique(stuck.map((item) => item.entity)),
    sentEntities: unique(
      items.filter((item) => item.status === 'synced').map((item) => item.entity),
    ),
  };
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
    // §04's absolute floor for anything tappable, from the token rather than as a
    // literal. A queue row is read more than it is tapped, so it sits at the floor
    // and not at the 70 §05 gives a visit row.
    minHeight: tokens.target.floor,
    justifyContent: 'center',
  },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm },
  glyph: {
    color: tokens.color.textSecondary,
    fontSize: tokens.typography.body.size,
    fontWeight: '500',
    fontFamily: fontFamilyFor('500'),
  },
  empty: { gap: tokens.space.sm },
  /**
   * S3 is "the only critical colour in the whole flow", and it earns it: an upload
   * that has been tried and refused to go is a genuine failure, unlike waiting,
   * offline or refused-by-the-server, which are all normal states.
   */
  stuck: {
    borderRadius: tokens.radius.well,
    backgroundColor: tokens.color.criticalFill,
    borderLeftWidth: 4,
    borderLeftColor: tokens.color.critical,
    padding: tokens.space.md,
    gap: tokens.space.xs,
  },
  reassurance: {
    borderTopWidth: 1,
    borderTopColor: tokens.color.hairline,
    paddingTop: tokens.space.sm,
    gap: 2,
  },
  actions: { flexDirection: 'row', gap: tokens.space.sm, paddingTop: tokens.space.xs },
  grow: { flex: 1 },
});

const list = (values: readonly string[]): string =>
  values.length <= 1
    ? (values[0] ?? '')
    : `${values.slice(0, -1).join(', ')} and ${values[values.length - 1] ?? ''}`;

/**
 * The block S3 puts above the rows.
 *
 * Everything in it is a fact about the queue the MR is looking at. There is no
 * "things to try" list unless there is something to try with — advice to "get on
 * WiFi and tap Send" on a screen with no Send button is advice that cannot be
 * followed.
 */
const StuckBlock = ({
  summary,
  onRetry,
  onContactSupport,
}: {
  readonly summary: QueueStuckSummary;
  readonly onRetry?: (() => void) | undefined;
  readonly onContactSupport?: (() => void) | undefined;
}): ReactNode => (
  <View accessibilityRole="alert" accessible style={styles.stuck}>
    <BodyText>
      {summary.count === 1 ? '1 thing won’t go' : `${String(summary.count)} things won’t go`}
    </BodyText>
    <Label muted>{`Stuck: ${list(summary.stuckEntities)}. It is still safe on your phone.`}</Label>

    <View style={styles.reassurance}>
      {summary.sentEntities.length === 0 ? null : (
        <Label muted>{`Everything else went through — ${list(summary.sentEntities)}.`}</Label>
      )}
      {/*
        Said out loud, because the MR is the person most likely to assume otherwise.
        It is also literally true of this system: there is no ranking, score or
        percentile anywhere to count it against, and the backend has tests asserting
        those columns do not exist.
      */}
      <Label muted>This is not counted against you. The upload failed, not you.</Label>
    </View>

    {onRetry === undefined && onContactSupport === undefined ? null : (
      <View style={styles.actions}>
        {onRetry === undefined ? null : (
          <View style={styles.grow}>
            <Button label="Try again now" onPress={onRetry} variant="secondary" />
          </View>
        )}
        {onContactSupport === undefined ? null : (
          <View style={styles.grow}>
            <Button label="Tell the help desk" onPress={onContactSupport} variant="quiet" />
          </View>
        )}
      </View>
    )}
  </View>
);

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
          {/*
            The server's clock, and ONLY the server's. No duration is computed anywhere
            on this screen, and nothing is rendered when the server sent no timestamp --
            this line used to print the device's clock behind the words "Server recorded
            this at", which is the app telling an MR something the server never said.
          */}
          {rejection.receivedAt === null ? null : (
            <Label muted>{`Server recorded this at ${rejection.receivedAt}`}</Label>
          )}
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
  onRetry,
  onContactSupport,
}: QueueScreenProps): ReactNode => {
  const outstanding = items.filter((item) => item.status !== 'synced');
  const summary = stuckSummaryFor(items, rejections, longRetryAfterAttempts);

  return (
    <Screen scrollable>
      <Heading>Your upload queue</Heading>

      {summary === null ? null : (
        <StuckBlock onContactSupport={onContactSupport} onRetry={onRetry} summary={summary} />
      )}

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
