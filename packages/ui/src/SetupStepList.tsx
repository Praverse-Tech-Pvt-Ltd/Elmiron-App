import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { BodyText, Label } from './Text';

/**
 * The numbered steps on an OEM battery-setup screen.
 *
 * **This list is the product, not the shortcut buttons.** The vendor deep links are
 * undocumented, break between skin versions, and are withheld entirely on a device
 * where they do not resolve. When every one of them is missing — which is the default
 * on this build — these steps are the whole flow, and the MR follows them by hand.
 * So the steps render identically whether a shortcut is present or not, and nothing
 * here is conditional on one existing.
 *
 * A pure function of its props, like `QueueScreen`. The done state lives in the route
 * so that it can outlive a re-render and, later, be persisted; this component decides
 * nothing.
 */

export interface SetupStepView {
  /** Stable key. The route uses it to toggle done state. */
  readonly id: string;
  readonly title: string;
  /**
   * The vendor's own wording for the screen the MR is about to land on.
   *
   * This is what lets someone tell they are in the right place when the vendor calls
   * it something else entirely — which is the usual case, and the reason the design
   * carries this line at all rather than trusting our own step title.
   */
  readonly whatYouWillSee?: string | undefined;
  readonly done: boolean;
  /** Present only when the intent resolved on this device. Absent is normal. */
  readonly shortcut?: { readonly label: string; readonly onPress: () => void } | undefined;
}

export interface SetupStepListProps {
  readonly steps: readonly SetupStepView[];
  readonly onToggleDone: (id: string) => void;
}

const styles = StyleSheet.create({
  list: { gap: tokens.space.md },
  step: {
    backgroundColor: tokens.color.surface,
    borderRadius: tokens.radius.sm,
    padding: tokens.space.md,
    gap: tokens.space.xs,
  },
  header: { flexDirection: 'row', gap: tokens.space.sm, alignItems: 'flex-start' },
  // A fixed width so the titles align down the list regardless of the number.
  ordinal: { minWidth: tokens.space.lg },
  headerText: { flex: 1, gap: tokens.space.xs },
  // Actions sit below the text rather than beside it: at 16sp body type on a 5-inch
  // screen there is no room for a title and two controls on one line, and the first
  // thing to be squeezed would be the touch target.
  actions: { flexDirection: 'row', gap: tokens.space.sm, flexWrap: 'wrap' },
  action: {
    borderRadius: tokens.radius.sm,
    borderWidth: 1,
    borderColor: tokens.color.border,
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    minHeight: 48,
    justifyContent: 'center',
  },
  actionDone: { borderColor: tokens.color.accent },
  pressed: { opacity: 0.75 },
});

/**
 * Marked-done is stated in words, never by colour or a glyph alone.
 *
 * The same rule as `QueueScreen`'s row states, and for the same reason: an MR reading
 * this outdoors at partial brightness, and TalkBack, both get the meaning from the
 * text or neither gets it at all.
 */
const doneLabel = (done: boolean): string => (done ? 'Done' : 'Mark done');

export const SetupStepList = ({ steps, onToggleDone }: SetupStepListProps): ReactNode => (
  <View style={styles.list}>
    {steps.map((step, index) => (
      <View key={step.id} style={styles.step}>
        <View style={styles.header}>
          <View style={styles.ordinal}>
            <BodyText>{`${String(index + 1)}.`}</BodyText>
          </View>
          <View style={styles.headerText}>
            <BodyText>{step.title}</BodyText>
            {step.whatYouWillSee === undefined ? null : (
              <Label muted>{`What you'll see: ${step.whatYouWillSee}`}</Label>
            )}
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: step.done }}
            accessibilityLabel={`${step.title} — ${doneLabel(step.done)}`}
            onPress={() => {
              onToggleDone(step.id);
            }}
            style={({ pressed }) => [
              styles.action,
              step.done ? styles.actionDone : null,
              pressed ? styles.pressed : null,
            ]}
          >
            <Label>{doneLabel(step.done)}</Label>
          </Pressable>

          {/*
            Rendered only when the intent resolved. There is deliberately no disabled
            variant: a greyed-out shortcut on a device that cannot open the screen
            tells the MR nothing they can act on, and invites a tap that can only
            fail. The steps above already say what to do.
          */}
          {step.shortcut === undefined ? null : (
            <Pressable
              accessibilityRole="button"
              onPress={step.shortcut.onPress}
              style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}
            >
              <Label>{step.shortcut.label}</Label>
            </Pressable>
          )}
        </View>
      </View>
    ))}
  </View>
);
