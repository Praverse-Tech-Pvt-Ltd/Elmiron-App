import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { BodyText, Figure, Heading, Label } from './Text';
import { Button } from './Button';
import { Card } from './Card';
import { ListItem } from './ListItem';
import { Spinner } from './Spinner';

/**
 * B9 — the doctor profile.
 *
 * **`boundary` is the most important prop on this component.** B9 closes with
 * "Nothing here about what they prescribe, and nothing about their patients. Neither
 * is recorded anywhere in this app," and the design's note explains why it is
 * printed rather than assumed: a profile screen is exactly where prescriber
 * profiling would creep in. It is required, not optional — a build of this screen
 * without that sentence is the build where somebody added a prescribing panel and
 * nobody noticed the line had gone.
 *
 * Everything rendered here is the MR's own history with this doctor: when they
 * went, how long they stayed, what the doctor said about recording. There is no
 * prop on this component for anything else, which is the structural half of the
 * same promise.
 */
export interface DoctorProfileVisitRow {
  readonly id: string;
  /** "3 Jul" — formatted by the caller. */
  readonly dateLabel: string;
  /** "9 min", or null when the visit has no usable duration. */
  readonly durationLabel: string | null;
  /** "declined recording", or null when consent was never recorded. */
  readonly consentLabel: string | null;
}

export interface DoctorProfileScreenProps {
  readonly name: string;
  readonly detail: string;
  /** "6 weeks" — the figure. Null when this doctor has never been visited. */
  readonly sinceLabel: string | null;
  readonly recentVisits: readonly DoctorProfileVisitRow[];
  /**
   * "Tuesdays and Thursdays, 09:00–13:00 — from your last 5 visits."
   *
   * Derived from the MR's own visits and nothing else, and it always travels with
   * the count it came from so the MR can weigh it. Null when there were too few
   * visits to say anything, which is the common case for a new territory.
   */
  readonly availability?: string | null;
  /** C14, verbatim and mandatory. See the note above. */
  readonly boundary: string;
  readonly onAddToToday?: () => void;
  readonly loading?: boolean;
  readonly failure?: { readonly title: string; readonly detail: string } | null;
}

const styles = StyleSheet.create({
  head: { gap: 2 },
  since: { flexDirection: 'row', alignItems: 'baseline', gap: tokens.space.sm },
  rows: { gap: tokens.space.sm },
  // The boundary is a card of its own so it cannot be mistaken for a caption on the
  // list above it.
  boundary: { gap: tokens.space.xs },
});

export const DoctorProfileScreen = ({
  name,
  detail,
  sinceLabel,
  recentVisits,
  availability = null,
  boundary,
  onAddToToday,
  loading = false,
  failure = null,
}: DoctorProfileScreenProps): ReactNode => {
  if (failure !== null) {
    return <Banner detail={failure.detail} title={failure.title} tone="critical" />;
  }

  return (
    <>
      <View style={styles.head}>
        <Heading>{name}</Heading>
        <Label muted>{detail}</Label>
      </View>

      {loading ? <Spinner label="Getting this doctor's history" /> : null}

      <Card>
        <Label muted>Since your last visit</Label>
        {sinceLabel === null ? (
          <BodyText>You have not visited this doctor yet.</BodyText>
        ) : (
          <View style={styles.since}>
            <Figure>{sinceLabel}</Figure>
          </View>
        )}
      </Card>

      {availability === null ? null : (
        <Card>
          <Label muted>Best time to catch them</Label>
          <BodyText>{availability}</BodyText>
        </Card>
      )}

      {recentVisits.length === 0 ? null : (
        <>
          <Label muted>Your last visits</Label>
          <View style={styles.rows}>
            {recentVisits.map((visit) => (
              <ListItem
                detail={[visit.durationLabel, visit.consentLabel]
                  .filter((part): part is string => part !== null)
                  .join(' · ')}
                key={visit.id}
                // Every row here is a visit that happened. `success` is the state of
                // the visit, not a verdict on the consent outcome — a doctor who
                // declined recording is not a worse visit, and §02 forbids dressing
                // a normal state as a failure.
                status="success"
                title={visit.dateLabel}
              />
            ))}
          </View>
        </>
      )}

      <Card tone="offline">
        <View style={styles.boundary}>
          <BodyText>{boundary}</BodyText>
        </View>
      </Card>

      {onAddToToday === undefined ? null : (
        <Button label="Add to today" onPress={onAddToToday} variant="primary" />
      )}
    </>
  );
};
