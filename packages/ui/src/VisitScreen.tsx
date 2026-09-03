import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { BodyText, Figure, Heading, Label } from './Text';
import { Button } from './Button';
import { Card } from './Card';
import { Spinner } from './Spinner';

/**
 * Phase 2 B4 → B5 → B6, on one screen.
 *
 * The design splits them: B4 is an arrival prompt fired by a geofence, B5 is the
 * visit, B6 is check-out. `fe-w3-spec.md` §4a rules out background location, so
 * nothing can fire while the app is closed and B4's prompt has no trigger. What is
 * left is one screen for one visit, whose primary action changes as the visit
 * moves — which is closer to what an MR actually holds in their hand anyway: they
 * are looking at the doctor they are standing outside.
 *
 * **The action is disabled while a fix is being taken, and says so.** A check-in
 * pressed twice is two check-ins, and the second one is the MR standing in a
 * doorway wondering whether the first worked.
 *
 * **`blocked` is a sentence, not a boolean.** When a position cannot be had, the MR
 * is told which of the two reasons it is — they refused the permission, or the
 * phone could not see the sky — because those have different remedies and only one
 * of them is about them.
 */
export interface VisitScreenProps {
  readonly doctorName: string;
  readonly clinic: string | null;
  readonly stage: 'before' | 'during' | 'after';
  /** Null once there is nothing left to do. */
  readonly actionLabel: string | null;
  readonly onAction: () => void;
  /** A fix is being taken, or the request is in flight. */
  readonly busy?: boolean;
  /** Why the visit cannot be advanced right now, in the MR's words. */
  readonly blocked?: string | null;
  /** "Checked in 11:56" — the server's clock, formatted by the caller. */
  readonly startedLabel?: string | null;
  /** "17 min" once the visit is finished. */
  readonly durationLabel?: string | null;
  /**
   * Offered only once the visit is finished. A report written before check-out is a
   * report about a visit that has not happened yet.
   */
  readonly onWriteReport?: () => void;
  /**
   * Phase 3 — where the visit stands on the recording question.
   *
   * `unasked` is not "no". It is the ordinary state of a visit nobody has raised it
   * in, and it is why `onAsk` exists separately from an outcome: the MR chooses to
   * hand the phone over, and a screen that nagged them into it would be applying
   * the pressure the consent design spends its whole argument removing.
   */
  readonly consent?: {
    readonly outcome: 'unasked' | 'consented' | 'declined';
    /** "He agreed at 11:58" — the server's clock, formatted by the caller. */
    readonly answeredLabel?: string | null;
    /** Absent once the question has been answered. It is asked once. */
    readonly onAsk?: () => void;
  };
  /**
   * C5. Offered only *during* the visit, which is the opposite constraint to
   * `onWriteReport` and for the mirror-image reason: samples are handed over while
   * the MR is standing there, and `samples_and_inputs` grants insert only, so a
   * line recorded after check-out cannot be corrected once the visit is closed.
   */
  readonly onRecordSamples?: () => void;
  readonly loading?: boolean;
  readonly failure?: { readonly title: string; readonly detail: string } | null;
}

const styles = StyleSheet.create({
  head: { gap: 2 },
  spacer: { flex: 1, minHeight: tokens.space.md },
  foot: { gap: tokens.space.sm },
  figureRow: { flexDirection: 'row', alignItems: 'baseline', gap: tokens.space.sm },
});

const STAGE_WORDS = {
  before: 'Not started',
  during: 'You are checked in',
  after: 'Visit finished',
} as const;

export const VisitScreen = ({
  doctorName,
  clinic,
  stage,
  actionLabel,
  onAction,
  busy = false,
  blocked = null,
  startedLabel = null,
  durationLabel = null,
  onWriteReport,
  onRecordSamples,
  consent,
  loading = false,
  failure = null,
}: VisitScreenProps): ReactNode => {
  if (failure !== null) {
    return <Banner detail={failure.detail} title={failure.title} tone="critical" />;
  }

  return (
    <>
      <View style={styles.head}>
        <Heading>{doctorName}</Heading>
        {clinic === null ? null : <Label muted>{clinic}</Label>}
      </View>

      {loading ? <Spinner label="Getting this visit" /> : null}

      <Card tone={stage === 'during' ? 'hero' : 'default'}>
        <Label muted>{STAGE_WORDS[stage]}</Label>
        {durationLabel === null ? null : (
          <View style={styles.figureRow}>
            <Figure>{durationLabel}</Figure>
            <Label muted>with the doctor</Label>
          </View>
        )}
        {startedLabel === null ? null : <BodyText>{startedLabel}</BodyText>}
      </Card>

      {consent === undefined || consent.outcome === 'unasked' ? null : (
        /*
          D5, and the note under it is the specification: "Read what is not here."
          No warning colour, no "are you sure", no note about consent rate, no
          explanation of what was lost, no change of tone. A declined visit is one
          of three ordinary completions — `ConsentOutcomeSchema` says so and the
          database carries no penalty flag — so this is the plainest card on the
          screen and it is the same card either way.
        */
        <Card>
          <BodyText>
            {consent.outcome === 'declined' ? 'Noted — no recording.' : 'He agreed to a recording.'}
          </BodyText>
          {consent.answeredLabel == null ? null : <Label muted>{consent.answeredLabel}</Label>}
          {consent.outcome === 'consented' ? (
            // The MR must not be left believing audio is being captured. Recording
            // is FE-W4 and nothing in this build can capture it; a screen that
            // implied otherwise would have them speak as though it were.
            <Label muted>
              Recording is not in this build, so nothing is being captured. His answer is on the
              record either way.
            </Label>
          ) : null}
        </Card>
      )}

      {blocked === null ? null : (
        // Not `critical`: a phone that cannot see a satellite, or an MR who has not
        // granted a permission, is not a failure of theirs. §02 keeps critical for
        // genuine failures, and this is a condition with a remedy.
        <Banner detail={blocked} title="This check-in cannot be sent yet" tone="attention" />
      )}

      <View style={styles.spacer} />

      <View style={styles.foot}>
        {stage === 'during' && consent?.outcome === 'unasked' && consent.onAsk !== undefined ? (
          <Button label="Ask about recording" onPress={consent.onAsk} variant="secondary" />
        ) : null}
        {stage === 'during' && onRecordSamples !== undefined ? (
          <Button label="Record what you left" onPress={onRecordSamples} variant="secondary" />
        ) : null}
        {stage === 'after' && onWriteReport !== undefined ? (
          <Button label="Write your report" onPress={onWriteReport} />
        ) : null}
        {actionLabel === null ? null : (
          <Button
            label={busy ? 'Finding your position…' : actionLabel}
            loading={busy}
            onPress={onAction}
          />
        )}
      </View>
    </>
  );
};
