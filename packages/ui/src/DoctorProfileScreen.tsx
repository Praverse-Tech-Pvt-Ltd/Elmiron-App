import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { BodyText, Figure, Label, Secondary, Title } from './Text';
import { Button } from './Button';
import { Card } from './Card';
import { ListItem } from './ListItem';
import { Spinner } from './Spinner';
import { useT } from './i18n';

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
  /**
   * "6 weeks" — the figure. Null when it cannot be stated: never visited, OR still loading, OR
   * visited with no server clock to measure from. The screen tells those apart (FE-D3 B3) using
   * `loading` and `recentVisits`; only a settled, empty history reads "not visited yet".
   */
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
  /**
   * `FE-W190`. The rep is checked in with this doctor right now. The profile counts only FINISHED
   * visits, so during a first visit it said "You have not visited this doctor yet" to a rep standing
   * in the clinic (QA 21). The caller decides it from the visit's stage, queued check-ins included.
   */
  readonly inVisitNow?: boolean;
  readonly loading?: boolean;
  readonly failure?: { readonly title: string; readonly detail: string } | null;
}

const styles = StyleSheet.create({
  head: { gap: tokens.space.xxs },
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
  inVisitNow = false,
  loading = false,
  failure = null,
}: DoctorProfileScreenProps): ReactNode => {
  const { t } = useT();
  if (failure !== null) {
    return <Banner detail={failure.detail} title={failure.title} tone="critical" />;
  }

  return (
    <>
      {/*
        `FE-W190`. The doctor is what this screen is, so the name is its `Title`, as a visit's is
        its `Display`; `Heading` is for a thing ON a screen. The line under a title is `Secondary`.
      */}
      <View style={styles.head}>
        <Title>{name}</Title>
        <Secondary>{detail}</Secondary>
      </View>

      {loading ? <Spinner label={t('doctors.loadingHistory')} /> : null}

      <Card>
        <Label muted>{t('doctors.sinceLastVisit')}</Label>
        {inVisitNow ? (
          <BodyText>
            {!loading && recentVisits.length === 0
              ? t('doctors.inVisitFirst')
              : t('doctors.inVisitNow')}
          </BodyText>
        ) : null}
        {sinceLabel !== null ? null : !loading && recentVisits.length === 0 ? (
          // FE-D3 B3. Only a SETTLED history with no completed visit is "not visited". This used to
          // show for every null `sinceLabel`: while loading, and when the rep HAD visited but
          // there was no server clock to say how long ago. `FE-W190`: and never during a visit,
          // where the line above already says this is the first.
          inVisitNow ? null : (
            <BodyText>{t('doctors.notVisitedYet')}</BodyText>
          )
        ) : (
          <BodyText>{t('doctors.lastVisitUnknown')}</BodyText>
        )}
        {sinceLabel === null ? null : (
          <View style={styles.since}>
            <Figure>{sinceLabel}</Figure>
          </View>
        )}
      </Card>

      {availability === null ? null : (
        <Card>
          <Label muted>{t('doctors.bestTime')}</Label>
          <BodyText>{availability}</BodyText>
        </Card>
      )}

      {recentVisits.length === 0 ? null : (
        <>
          <Label muted>{t('doctors.lastVisits')}</Label>
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

      {/*
        `FE-W190`. A note about the screen, so `quiet` — flat, with a hairline edge. The dashed
        `offline` card it borrowed says "waiting on this phone", which this is not.
      */}
      <Card tone="quiet">
        <View style={styles.boundary}>
          <BodyText>{boundary}</BodyText>
        </View>
      </Card>

      {onAddToToday === undefined ? null : (
        <Button label={t('doctors.addToToday')} onPress={onAddToToday} variant="primary" />
      )}
    </>
  );
};
