import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { BodyText, Heading, Label } from './Text';
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
  readonly state: 'done' | 'current' | 'upcoming' | 'cancelled';
  /** "09:20 · consented · 8 min" — assembled by the caller. */
  readonly detail: string;
}

export interface BeatPlanScreenProps {
  readonly planned: number;
  readonly done: number;
  readonly stops: readonly BeatPlanStop[];
  readonly loading?: boolean;
  readonly failure?: { readonly title: string; readonly detail: string } | null;
  readonly onOpenDoctor?: (doctorId: string) => void;
}

const styles = StyleSheet.create({
  head: { gap: 2 },
  rows: { gap: tokens.space.sm },
  currentLines: { gap: 2 },
});

/**
 * `cancelled` is a state, not a failure: a visit called off is a normal thing that
 * happens to a plan, and §02 forbids dressing a normal state as an error.
 */
const STATUS = {
  done: 'success',
  current: 'info',
  upcoming: 'offline',
  cancelled: 'offline',
} as const;

export const BeatPlanScreen = ({
  planned,
  done,
  stops,
  loading = false,
  failure = null,
  onOpenDoctor,
}: BeatPlanScreenProps): ReactNode => {
  if (failure !== null) {
    return (
      <>
        <Heading>Today&apos;s route</Heading>
        <Banner detail={failure.detail} title={failure.title} tone="critical" />
      </>
    );
  }

  return (
    <>
      <View style={styles.head}>
        <Heading>Today&apos;s route</Heading>
        {/*
          "9 planned · 6 done". The design also carries "31.7 km" here; that is
          `daily_mileage()`, server-side and without an endpoint, so it is absent
          rather than computed from positions this app does not take.
        */}
        <Label muted>{`${String(planned)} planned · ${String(done)} done`}</Label>
      </View>

      {loading ? <Spinner label="Getting today's route" /> : null}

      {!loading && stops.length === 0 ? (
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
            <Card
              key={stop.id}
              {...(onOpenDoctor === undefined
                ? {}
                : {
                    onPress: () => {
                      onOpenDoctor(stop.id);
                    },
                  })}
            >
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
              {...(onOpenDoctor === undefined
                ? {}
                : {
                    onPress: () => {
                      onOpenDoctor(stop.id);
                    },
                  })}
            />
          ),
        )}
      </View>
    </>
  );
};
