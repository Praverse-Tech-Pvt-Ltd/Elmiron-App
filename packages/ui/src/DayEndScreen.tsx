import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { BodyText, Figure, Heading, Label } from './Text';
import { Button } from './Button';
import { Card } from './Card';
import { Spinner } from './Spinner';
import { SyncQueueIndicator } from './SyncQueueIndicator';
import type { SyncQueueState } from './SyncQueueIndicator';

/**
 * Phase 2 B7 — the day is over and nothing is running.
 *
 * C11's note is the ordering rule and it is followed literally: **the stop
 * confirmation outranks the day's numbers.** An MR who is not sure whether
 * tracking stopped kills the app from Recents, and an app killed from Recents is
 * an app that is off tomorrow morning too. So the first card on this screen is the
 * answer to "is it still watching me", the day's totals come after it, and the
 * totals are never allowed to push the confirmation off the first screenful.
 *
 * **What this screen confirms is stronger than what B7 draws, not weaker.** B7
 * shows location being switched off at 18:22, which implies it was on until then.
 * `fe-w3-spec.md` §4a settled that this app takes discrete fixes only — a position
 * is read on a check-in or check-out press and at no other moment, and there is no
 * background location at all. So "nothing is being recorded" is not a state the MR
 * entered at 18:22; it is true all day, between every press. The copy says that,
 * because a screen that announced a stop the app never needed would be teaching
 * the MR the app tracks them continuously — the precise belief the transparency
 * work exists to correct.
 *
 * **Three numbers B7 draws are not here, and none is missing for effort.**
 *
 * - **₹627.** The rupee figure needs a per-kilometre rate, which exists in no
 *   contract, endpoint or config this app can read. `MileageScreen` refuses to
 *   invent it and so does this screen; `rateNote` is required for the same reason
 *   its `rateNote` is.
 * - **"ran 9h 27m".** A duration wants a start and an end. Only the second is a
 *   server stamp on a completed day, and subtracting to produce a headline figure
 *   is the clock arithmetic `today/plan.ts` rules out. The two server timestamps
 *   are shown instead, which says the same thing and asserts nothing the server
 *   did not.
 * - **"6.2 MB data used today".** Nothing in this app measures its own network
 *   use. A figure here would be decoration on the one screen whose entire claim is
 *   that its numbers are the honest ones.
 */
export interface DayEndScreenProps {
  /** "Thursday" — the caller formats it; the device locale is the caller's problem. */
  readonly dayLabel: string;
  /**
   * "First check-in 08:55", or null before the day's first. A server stamp, sliced
   * by the caller — never a device clock.
   */
  readonly firstCaptureLabel: string | null;
  /** "Last check-out 18:22", or null when the day recorded no position at all. */
  readonly lastCaptureLabel: string | null;
  /**
   * The standing truth about when this app reads a position. Required: the card it
   * sits in is the reason the screen exists, and a confirmation with nothing under
   * it is a claim the MR has to take on trust.
   */
  readonly captureNote: string;
  readonly planned: number;
  readonly done: number;
  /**
   * **MR-12 D3. Visits attended where the doctor was not available.**
   *
   * The copy on this screen used to claim SUCCESS -- "2 of 3 visits done", "That's the
   * day done", "Everything on the plan is complete." An MR who drove to three clinics and
   * found three doctors in theatre did their whole job and got congratulated for a day
   * they would describe as wasted. Worse, `done` counted only `completed`, so the same MR
   * read "0 of 3" -- the app telling them they had achieved nothing.
   *
   * The screens now claim ATTENDANCE, which is the thing the MR controls and the thing
   * the record actually proves. `not_met` is surfaced plainly and never as a shortfall:
   * it is attributed to the territory or the doctor and never scored against the MR, which
   * is the term the MR-11 C5 decision was taken on.
   */
  readonly notMet: number;
  /** "48.2 km" from the server's metres, or null when the day has none. */
  readonly distanceLabel: string | null;
  /** Why there is no rupee figure. Required — see the note above. */
  readonly rateNote: string;
  readonly sync: SyncQueueState;
  readonly onOpenQueue: () => void;
  /** C10/A9. The way to check every word of this screen against the record. */
  readonly onOpenTransparency: () => void;
  readonly loading?: boolean;
  readonly failure?: { readonly title: string; readonly detail: string } | null;
}

const styles = StyleSheet.create({
  head: { gap: 2 },
  stopLines: { gap: tokens.space.xs },
  figureRow: { flexDirection: 'row', alignItems: 'baseline', gap: tokens.space.sm },
  stamps: { gap: 2 },
  spacer: { flex: 1, minHeight: tokens.space.md },
  foot: { gap: tokens.space.sm },
});

export const DayEndScreen = ({
  dayLabel,
  firstCaptureLabel,
  lastCaptureLabel,
  captureNote,
  planned,
  notMet,
  done,
  distanceLabel,
  rateNote,
  sync,
  onOpenQueue,
  onOpenTransparency,
  loading = false,
  failure = null,
}: DayEndScreenProps): ReactNode => {
  if (failure !== null) {
    return (
      <>
        <Heading>{dayLabel}</Heading>
        <Banner detail={failure.detail} title={failure.title} tone="critical" />
      </>
    );
  }

  return (
    <>
      <View style={styles.head}>
        <Heading>{`${dayLabel} — that's the day`}</Heading>
      </View>

      {/*
        C11's ordering, enforced by position: the stop confirmation is the first
        thing rendered and everything else follows it. This is also the screen's one
        hero card — §05 allows exactly one, and this is what it is for.
      */}
      <Card tone="hero">
        <View style={styles.stopLines}>
          <Heading>Nothing is being recorded.</Heading>
          <BodyText>{captureNote}</BodyText>
        </View>
        {firstCaptureLabel === null && lastCaptureLabel === null ? null : (
          <View style={styles.stamps}>
            {firstCaptureLabel === null ? null : <Label>{firstCaptureLabel}</Label>}
            {lastCaptureLabel === null ? null : <Label>{lastCaptureLabel}</Label>}
          </View>
        )}
      </Card>

      {/*
        Under the confirmation, never over it, and non-blocking: a day already
        finished is not made more finished by a spinner in front of it.
      */}
      {loading ? <Spinner label="Getting your day" /> : null}

      <Label muted>{`Your ${dayLabel}`}</Label>

      <Card>
        <Label muted>Visits</Label>
        <View style={styles.figureRow}>
          <Figure>{`${String(done + notMet)} of ${String(planned)}`}</Figure>
          <Label muted>
            {done + notMet === planned ? 'you went to all of them' : 'visits attended'}
          </Label>
        </View>
        {notMet === 0 ? null : (
          <Label muted>
            {notMet === 1
              ? 'One doctor was not available. That is recorded against the visit, not against you.'
              : `${String(notMet)} doctors were not available. That is recorded against those visits, not against you.`}
          </Label>
        )}
      </Card>

      <Card>
        <Label muted>On your claim</Label>
        {distanceLabel === null ? (
          <BodyText>
            No distance yet. It appears once you have checked into more than one visit.
          </BodyText>
        ) : (
          <View style={styles.figureRow}>
            <Figure>{distanceLabel}</Figure>
          </View>
        )}
        <Label muted>{rateNote}</Label>
      </Card>

      <SyncQueueIndicator onPress={onOpenQueue} state={sync} />

      <View style={styles.spacer} />

      <View style={styles.foot}>
        {/*
          The single action, and it is the transparency screen rather than anything
          that ends or starts a day. There is no day to end: capture is per press,
          so a "Start day tomorrow" button would switch on nothing and tell the MR
          it had.
        */}
        <Button label="See everything recorded today" onPress={onOpenTransparency} />
      </View>
    </>
  );
};
