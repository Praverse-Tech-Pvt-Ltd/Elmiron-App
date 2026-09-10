import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { BodyText, Figure, Heading, Label } from './Text';
import { Banner } from './Banner';
import { Button } from './Button';
import { Card } from './Card';
import { Spinner } from './Spinner';
import { SyncQueueIndicator } from './SyncQueueIndicator';
import type { SyncQueueState } from './SyncQueueIndicator';

/**
 * Phase 2 B1 — "the screen everything is judged on".
 *
 * The shape of the screen is an argument, not a layout: the next visit is the
 * largest thing, the day's progress sits under it, and the single primary action is
 * pinned at the bottom inside the reach zone (§04) because it is pressed while
 * walking.
 *
 * **What is missing from this component is the point of most of its comments.**
 * B1 also draws a travel estimate ("11 min by bike"), a distance ("2.4 km from
 * here") and a money figure (₹412 earned today). None is here, and none is
 * omitted for effort:
 *
 * - The first two need the device's position while the app is merely open, and
 *   whether this app may take that fix is an open policy question — `fe-w3-spec.md`
 *   §4 forbids writing code against an assumed answer.
 * - The money figure is `daily_mileage()`, computed server-side, with no endpoint
 *   in the contract client today. It is the screen's most load-bearing number and
 *   the worst possible one to invent on the client.
 *
 * The props below are structural for the same reason `QueueScreenProps` is:
 * `packages/ui` cannot import the app's data layer, so the binding's
 * straight-through pass is the compile-time check.
 */
export interface TodayNextVisit {
  readonly doctorName: string;
  readonly clinic: string | null;
  /**
   * MR-14 B4. The clinic address is expected and has not synced yet.
   *
   * Distinguishes "this visit has no clinic address" from "this visit's address has not
   * arrived", which `clinic: null` alone conflated — both rendered as a missing line. The
   * second is a state of the client, not a fact about the day. `clinic` is always null
   * when this is true.
   */
  readonly clinicPending: boolean;
  /** Already formatted by the caller — this component does no clock arithmetic. */
  readonly scheduledLabel: string | null;
}

export interface TodayScreenProps {
  /** "Thursday" — the caller formats it; the device locale is the caller's problem. */
  readonly dayLabel: string;
  /** "Started 8:55 · South Mumbai", or null before the first visit begins. */
  readonly startedLabel: string | null;
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
  readonly next: TodayNextVisit | null;
  readonly sync: SyncQueueState;
  readonly onOpenQueue: () => void;
  /**
   * C10/A9 — "What this app records about me", reachable from home every day and
   * never buried in settings.
   *
   * Optional only because the screen behind it is not built yet, and pointing the
   * link at some other destination would make the app's own transparency promise
   * the first thing it breaks. Omit it and the row is absent; do not aim it
   * elsewhere.
   */
  readonly onOpenTransparency?: () => void;
  /**
   * B1's primary action. It opens the visit, where the MR checks in — it does not
   * check them in from here, because a check-in takes a position and a position is
   * only ever taken on the press that needs it.
   */
  readonly onStartNextVisit?: () => void;
  /**
   * S1. Renders as a line above the day, never as a blocking spinner — "a blocking
   * spinner in a waiting room is a lost visit". Whatever is already known stays on
   * screen underneath it.
   */
  readonly loading?: boolean;
  /** S2's second action: somewhere useful to go when no plan arrived. */
  readonly onFindDoctor?: () => void;
  /**
   * B7. Offered only once the day has nothing left on it — a day-end summary
   * opened at 11am would be reporting a day that is still happening. It is not the
   * primary action even then: the day being over is not something the MR has to
   * act on, and §04 reserves the pinned primary for the thing that is.
   */
  readonly onOpenDayEnd?: () => void;
  /**
   * B3. Deliberately not the primary action: opening the route is looking at the
   * day, not starting a visit, and B1's "Start the trip to Dr Iyer" cannot exist
   * honestly until check-in does.
   */
  readonly onOpenRoute?: () => void;
  /** A denial or a failure the MR needs to see instead of the day. */
  readonly failure?: { readonly title: string; readonly detail: string } | null;
  /**
   * MR-14 B6 and B8. Things the SERVER said about this sync, in its own words.
   *
   * Two kinds arrive here and both are the server's sentence rather than this component's:
   * the completeness notice when a full re-sync carried no tombstones, and the wording for
   * a record that has left the MR's scope.
   *
   * **Empty must render nothing at all.** The silence is load-bearing: a notice that
   * appears on every sync teaches people to dismiss it, and then it is not there on the
   * sync where it mattered. `noticeFor` returns null when the server omits nothing, and
   * this renders that as an absence rather than as an empty container.
   */
  readonly notices?: readonly { readonly title: string; readonly body: string }[];
}

const styles = StyleSheet.create({
  head: { gap: 2 },
  progress: { flexDirection: 'row', alignItems: 'baseline', gap: tokens.space.sm },
  heroLines: { gap: 2 },
  // The single primary action is pinned rather than scrolled to: §04 puts it inside
  // the bottom reach zone, where a thumb already is.
  spacer: { flex: 1, minHeight: tokens.space.md },
  foot: { gap: tokens.space.sm },
});

export const TodayScreen = ({
  dayLabel,
  startedLabel,
  planned,
  notMet,
  done,
  next,
  sync,
  onOpenQueue,
  onOpenTransparency,
  onStartNextVisit,
  onFindDoctor,
  onOpenRoute,
  onOpenDayEnd,
  loading = false,
  failure = null,
  notices = [],
}: TodayScreenProps): ReactNode => {
  if (failure !== null) {
    return <Banner detail={failure.detail} title={failure.title} tone="critical" />;
  }

  return (
    <>
      <View style={styles.head}>
        <Heading>{dayLabel}</Heading>
        {startedLabel === null ? null : <Label muted>{startedLabel}</Label>}
      </View>

      {/*
        S1. The day underneath stays visible and interactive while this is up: the
        MR is standing in a waiting room, and a screen that blocks until the network
        answers is a visit they do not log.
      */}
      {loading ? <Spinner label="Getting today's plan" /> : null}

      {/*
        B6/B8. Rendered only when the server actually said something. `notices` is empty on
        an ordinary sync and this whole block disappears -- see the prop's comment for why
        that silence is the point rather than an optimisation.
      */}
      {notices.map((item) => (
        <Card key={`${item.title}:${item.body}`}>
          <BodyText>{item.title}</BodyText>
          <Label muted>{item.body}</Label>
        </Card>
      ))}

      {loading && planned === 0 ? null : next === null ? (
        // Two different nulls, and conflating them would be a lie in one direction
        // or the other: a day with no plan (S2) is not a day that has been worked
        // through. S2's copy never says "ask your manager for a beat plan" — that
        // hands the MR's day to somebody else.
        <Card>
          <BodyText>
            {planned === 0 ? 'Nothing planned for today' : "That's everyone on the plan"}
          </BodyText>
          <Label muted>
            {planned === 0
              ? "No beat plan came through. You can still visit anyone in your territory and it'll all be logged."
              : notMet === 0
                ? 'You went to every visit on the plan.'
                : notMet === 1
                  ? 'You went to every visit on the plan. One doctor was not available.'
                  : `You went to every visit on the plan. ${String(notMet)} doctors were not available.`}
          </Label>
        </Card>
      ) : (
        <Card tone="hero">
          <Label>Next visit</Label>
          <View style={styles.heroLines}>
            <Heading>{next.doctorName}</Heading>
            {next.clinic !== null ? (
              <BodyText>{next.clinic}</BodyText>
            ) : next.clinicPending ? (
              // MR-14 B4. The address is expected and has not arrived. Said plainly,
              // because silence here reads as "this visit has no clinic" -- and the one
              // thing this screen must never do is present an absence as a fact. Never a
              // wrong address, never an empty one dressed up as an answer.
              <BodyText>Address still syncing</BodyText>
            ) : null}
            {next.scheduledLabel === null ? null : <BodyText>{next.scheduledLabel}</BodyText>}
          </View>
        </Card>
      )}

      {loading && planned === 0 ? null : (
        <Card>
          <Label muted>Today</Label>
          <View style={styles.progress}>
            <Figure>{`${String(done + notMet)} of ${String(planned)}`}</Figure>
            <Label muted>visits attended</Label>
          </View>
        </Card>
      )}

      <SyncQueueIndicator onPress={onOpenQueue} state={sync} />

      <View style={styles.spacer} />

      <View style={styles.foot}>
        {onOpenTransparency === undefined ? null : (
          <Button
            label="What this app records about me"
            onPress={onOpenTransparency}
            variant="quiet"
          />
        )}
        {next !== null && onOpenRoute !== undefined ? (
          <Button label="See today's route" onPress={onOpenRoute} variant="secondary" />
        ) : null}
        {next === null && planned === 0 && onFindDoctor !== undefined ? (
          <Button label="Find a doctor" onPress={onFindDoctor} variant="secondary" />
        ) : null}
        {next === null && planned > 0 && onOpenDayEnd !== undefined ? (
          <Button label="How today ended" onPress={onOpenDayEnd} variant="secondary" />
        ) : null}
        {next === null || onStartNextVisit === undefined ? null : (
          <Button
            label={`Start the visit to ${next.doctorName}`}
            onPress={onStartNextVisit}
            variant="primary"
          />
        )}
      </View>
    </>
  );
};
