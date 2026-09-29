import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { BodyText, Heading, Label, Title } from './Text';
import { Card } from './Card';
import { ListItem } from './ListItem';
import { Spinner } from './Spinner';

/**
 * B3 — today's route, as a timeline.
 *
 * **Exactly one stop is a card.** The design is explicit that only the current stop
 * gets one, and the reason is not visual: a screen with three cards has told the MR
 * nothing about which one to walk to. Done stops are rows behind it; upcoming stops
 * are rows ahead of it.
 *
 * **There is no map.** Maps are slow on a mid-range phone, costly on data, and a
 * drawn trail of where an MR has been is the surveillance reading of this product.
 * There is no prop here to pass route geometry to, which is the structural half of
 * that decision.
 */
export interface BeatPlanStop {
  readonly id: string;
  readonly doctorName: string;
  readonly clinic: string | null;
  readonly state: 'done' | 'current' | 'upcoming' | 'cancelled' | 'not_met';
  /** "09:20 · consented · 8 min" — assembled by the caller. */
  readonly detail: string;
  /**
   * FE-D2 3. The visit this stop is, when there is one. A stop with a visit opens the VISIT; a
   * stop without one (the plan names a doctor with no visit row yet) opens the doctor.
   */
  readonly visitId?: string | null;
}

export interface BeatPlanScreenProps {
  readonly planned: number;
  readonly done: number;
  readonly stops: readonly BeatPlanStop[];
  readonly loading?: boolean;
  readonly failure?: { readonly title: string; readonly detail: string } | null;
  readonly onOpenDoctor?: (doctorId: string) => void;
  /**
   * FE-D2 3 (operator ruling). Tapping a stop that has a visit opens that visit. Before this,
   * every stop opened the doctor, whose profile has no visit action, so the only visit a rep
   * could open all day was the single "next" one on Today.
   */
  readonly onOpenVisit?: (visitId: string) => void;
  /**
   * MR-45 (`BE-W89`). The plan's state, in the MR's words — *"Submitted — not yet
   * approved"*. Null when there is no plan to describe.
   *
   * It is a prop rather than derived here because the wording is a claim about a server
   * record, and that decision is made and asserted in the field app's `beat-plan-view.ts`.
   */
  readonly statusLine?: string | null;
  /**
   * MR-45 (`BE-W89`). A condition that REPLACES the "no route" card — a plan whose stops are
   * still syncing, or a plan with none.
   *
   * **This exists because the only empty state used to be "No beat plan came through"**, which
   * is false when a plan did come through and its stops have not arrived yet. That is the
   * defect this screen was left on the mock for six weeks to avoid. Info tone, never critical:
   * syncing is a normal state, and §02 forbids dressing one as an error.
   */
  readonly notice?: { readonly title: string; readonly detail: string } | null;
}

const styles = StyleSheet.create({
  head: { gap: 2 },
  rows: { gap: tokens.space.sm },
  currentLines: { gap: 2 },
});

/**
 * `cancelled` is a state, not a failure: a visit called off is a normal thing that
 * happens to a plan, and §02 forbids dressing a normal state as an error.
 *
 * FE-D8 1. **None of these is `offline`.** `offline` is the dashed "saved on phone" mark —
 * work on this phone waiting to send — and a stop not reached, called off or not met has
 * nothing waiting. Drawing them with it told the rep their upcoming doctors were in the queue.
 * `neutral` is B3's hollow ring on a plain row.
 */
const STATUS = {
  done: 'success',
  current: 'info',
  upcoming: 'neutral',
  cancelled: 'neutral',
  /**
   * MR-12 D3. **Not `success` and not `critical`.**
   *
   * `success` would render a stop where the doctor was absent identically to one where
   * they were seen -- the congratulation defect, in glyph form. `critical` would dress an
   * ordinary event as an error and, worse, would read as the MR's error: §02 forbids the
   * first and the MR-11 C5 decision forbids the second.
   *
   * Neutral, with the reason carried in the row's detail text, which is where a manager
   * reading the plan actually learns what happened.
   */
  not_met: 'neutral',
} as const;

export const BeatPlanScreen = ({
  planned,
  done,
  stops,
  loading = false,
  failure = null,
  onOpenDoctor,
  onOpenVisit,
  statusLine = null,
  notice = null,
}: BeatPlanScreenProps): ReactNode => {
  /** The visit when the stop has one and the caller can open it; otherwise the doctor, as before. */
  const pressFor = (stop: BeatPlanStop): { onPress: () => void } | Record<string, never> => {
    const visitId = stop.visitId ?? null;
    if (visitId !== null && onOpenVisit !== undefined) {
      return {
        onPress: () => {
          onOpenVisit(visitId);
        },
      };
    }
    if (onOpenDoctor !== undefined) {
      return {
        onPress: () => {
          onOpenDoctor(stop.id);
        },
      };
    }
    return {};
  };

  if (failure !== null) {
    return (
      <>
        <Title>Today&apos;s route</Title>
        <Banner detail={failure.detail} title={failure.title} tone="critical" />
      </>
    );
  }

  return (
    <>
      <View style={styles.head}>
        <Title>Today&apos;s route</Title>
        {/*
          "9 planned · 6 done". The design also carries "31.7 km" here; that is
          `daily_mileage()`, server-side and without an endpoint, so it is absent
          rather than computed from positions this app does not take.
        */}
        <Label muted>{`${String(planned)} planned · ${String(done)} done`}</Label>
        {statusLine === null ? null : <Label>{statusLine}</Label>}
      </View>

      {loading ? <Spinner label="Getting today's route" /> : null}

      {!loading && notice !== null ? (
        <Banner detail={notice.detail} title={notice.title} tone="info" />
      ) : null}

      {!loading && notice === null && stops.length === 0 ? (
        <Card>
          <BodyText>No route for today</BodyText>
          <Label muted>
            No beat plan came through. You can still visit anyone in your territory and it&apos;ll
            all be logged.
          </Label>
        </Card>
      ) : null}

      <View style={styles.rows}>
        {stops.map((stop) =>
          stop.state === 'current' ? (
            <Card key={stop.id} {...pressFor(stop)}>
              <Label muted>Next stop</Label>
              <View style={styles.currentLines}>
                <Heading>{stop.doctorName}</Heading>
                {stop.clinic === null ? null : <BodyText muted>{stop.clinic}</BodyText>}
                {stop.detail === '' ? null : <Label muted>{stop.detail}</Label>}
              </View>
            </Card>
          ) : (
            <ListItem
              detail={stop.detail === '' ? 'Not started' : stop.detail}
              key={stop.id}
              status={STATUS[stop.state]}
              title={stop.doctorName}
              {...pressFor(stop)}
            />
          ),
        )}
      </View>
    </>
  );
};
