import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { BodyText, Figure, Heading, Label } from './Text';
import { Card } from './Card';
import { ListItem } from './ListItem';
import { Spinner } from './Spinner';

/**
 * C2 — mileage and expenses.
 *
 * **There is no money figure, and that is the hardest omission on this screen.**
 * C2 draws "₹412 you've earned", and it is the number an MR opens this screen for.
 * The server sends metres; rupees need a per-kilometre rate, which is a company
 * policy value that exists in no contract, no endpoint and no config this app can
 * read. A rate guessed on the client becomes a number in somebody's expense claim
 * and then an argument with their manager about why the app said one thing and
 * payroll another.
 *
 * So the distance is shown, exactly as the server computed it, and the money is
 * named as missing rather than invented. That is also why `rateNote` is required:
 * an MR must be told *why* the figure they came for is absent.
 *
 * **Straight-line, and it says so.** `daily_mileage()` measures between check-in
 * fixes, so it under-counts real roads. Telling the MR that up front is what stops
 * the first "this is wrong" conversation from being a surprise — and it under-counts
 * rather than over-counts, which is the direction that protects them.
 */
export interface MileageDayRow {
  readonly id: string;
  /** "10 Aug" — formatted by the caller. */
  readonly dateLabel: string;
  /** "41.3 km" — formatted by the caller, from the server's metres. */
  readonly distanceLabel: string;
  readonly checkInCount: number;
}

export interface MileageScreenProps {
  readonly days: readonly MileageDayRow[];
  /** "148.7 km" across the period. */
  readonly totalLabel: string;
  /** Why there is no rupee figure. Required — see the note above. */
  readonly rateNote: string;
  readonly loading?: boolean;
  readonly failure?: { readonly title: string; readonly detail: string } | null;
}

const styles = StyleSheet.create({
  total: { flexDirection: 'row', alignItems: 'baseline', gap: tokens.space.sm },
  rows: { gap: tokens.space.sm },
});

export const MileageScreen = ({
  days,
  totalLabel,
  rateNote,
  loading = false,
  failure = null,
}: MileageScreenProps): ReactNode => {
  if (failure !== null) {
    return (
      <>
        <Heading>Mileage</Heading>
        <Banner detail={failure.detail} title={failure.title} tone="critical" />
      </>
    );
  }

  return (
    <>
      <Heading>Mileage</Heading>

      {loading ? <Spinner label="Getting your mileage" /> : null}

      <Card>
        <Label muted>This month, on your claim</Label>
        <View style={styles.total}>
          <Figure>{totalLabel}</Figure>
        </View>
        <Label muted>
          Measured in straight lines between the visits you checked into, so it counts less than the
          roads you actually rode.
        </Label>
      </Card>

      <Card tone="offline">
        <BodyText>{rateNote}</BodyText>
      </Card>

      {days.length === 0 && !loading ? (
        <Card>
          <BodyText>No mileage yet</BodyText>
          <Label muted>Distance appears once you have checked into more than one visit.</Label>
        </Card>
      ) : null}

      <View style={styles.rows}>
        {days.map((day) => (
          <ListItem
            detail={`${day.distanceLabel} · ${String(day.checkInCount)} check-ins`}
            key={day.id}
            // Every row is a day that happened. There is no verdict on it here —
            // approval is the manager's, and this screen is the MR's record.
            status="success"
            title={day.dateLabel}
          />
        ))}
      </View>
    </>
  );
};
