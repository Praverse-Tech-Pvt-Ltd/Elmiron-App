import type { ReactNode } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { DoctorProfileScreen, Screen } from '@fieldforce/ui';
import { usePulledStore } from '../../src/sync/pulled-store';
import { doctorsFromStore, visitsFromStore } from '../../src/sync/selectors';
import { lastSeenLabel } from '../../src/doctors/list';
import { availabilityFrom, availabilitySentence } from '../../src/doctors/availability';
import { buildDoctorProfile, consentLabel, dayMonthFrom } from '../../src/doctors/profile';

/** B9 shows three. More than that is a history screen, which this is not. */
const VISITS_SHOWN = 3;

/**
 * C14, printed on the screen rather than assumed by it. The design's note: a profile
 * screen is exactly where prescriber profiling would creep in, so the absence is
 * stated.
 */
const BOUNDARY =
  'Nothing here about what they prescribe, and nothing about their patients. Neither is recorded anywhere in this app.';

export default function DoctorProfile(): ReactNode {
  const { id } = useLocalSearchParams<{ id: string }>();
  // MR-14 B2. The doctor and their visits come from the store the pull maintains.
  const { store, status, failure: pullFailure } = usePulledStore();

  const doctor = doctorsFromStore(store).find((candidate) => candidate.id === id);
  const visits = visitsFromStore(store).filter((visit) => visit.doctorId === id);

  /**
   * **Consent records are not in the pull, by the server's own declaration.**
   *
   * `sync_pull`'s completeness field lists `consent_record` in `omittedEntities` alongside
   * the other capture entities -- a deliberate phase-2 scope, not a gap in this screen. So
   * the profile is built with none, and `consentLabel(null)` renders NOTHING rather than
   * "not asked". That distinction is the whole reason this is safe to do: an absent line
   * makes no claim, while "not asked" against a doctor who agreed would be a false
   * statement about a consent decision -- the one record in this product where being wrong
   * is worst. Recorded as a B9 divergence with its verdict in PROJECT-OVERVIEW.md.
   */
  const profile = doctor === undefined ? null : buildDoctorProfile(doctor, visits, [], Date.now());

  const failure =
    pullFailure !== null
      ? pullFailure.kind === 'refused' && pullFailure.refusal.code === 'not_permitted'
        ? {
            title: 'You do not have access to this doctor',
            detail: 'The server refused this request for your account.',
          }
        : {
            title: 'Could not load this doctor',
            detail:
              pullFailure.kind === 'refused'
                ? `The server refused this sync (${pullFailure.refusal.sqlState}).`
                : 'The app could not reach the server. It will try again.',
          }
      : status !== 'loading' && doctor === undefined
        ? {
            // Not found is not a denial. Saying "you do not have access" about a doctor who
            // simply is not in the list would be the app inventing a decision the server
            // never made.
            title: 'That doctor is not in your list',
            detail: 'They may belong to another territory, or have been made inactive.',
          }
        : null;

  return (
    <Screen scrollable>
      <DoctorProfileScreen
        availability={availabilitySentence(
          availabilityFrom(
            (profile?.recentVisits ?? [])
              .map((entry) => entry.startedAt)
              .filter((at): at is string => at !== null),
          ),
        )}
        boundary={BOUNDARY}
        detail={profile?.detail ?? ''}
        failure={failure}
        loading={status === 'loading'}
        name={profile?.name ?? 'Doctor'}
        recentVisits={(profile?.recentVisits ?? []).slice(0, VISITS_SHOWN).map((visit) => ({
          id: visit.visitId,
          dateLabel: dayMonthFrom(visit.completedAt),
          durationLabel: visit.minutes === null ? null : `${String(visit.minutes)} min`,
          consentLabel: consentLabel(visit.consent),
        }))}
        sinceLabel={
          profile === null || profile.daysSince === null ? null : lastSeenLabel(profile.daysSince)
        }
      />
    </Screen>
  );
}
