import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ApiRequestError } from '@fieldforce/core';
import { DoctorProfileScreen, Screen } from '@fieldforce/ui';
import { createClientForScenario } from '../../src/api';
import { lastSeenLabel } from '../../src/doctors/list';
import { availabilityFrom, availabilitySentence } from '../../src/doctors/availability';
import { buildDoctorProfile, consentLabel, dayMonthFrom } from '../../src/doctors/profile';
import type { DoctorProfile } from '../../src/doctors/profile';

/** B9 shows three. More than that is a history screen, which this is not. */
const VISITS_SHOWN = 3;

/**
 * C14, printed on the screen rather than assumed by it. The design's note: a profile
 * screen is exactly where prescriber profiling would creep in, so the absence is
 * stated.
 */
const BOUNDARY =
  'Nothing here about what he prescribes, and nothing about his patients. Neither is recorded anywhere in this app.';

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly profile: DoctorProfile }
  | { readonly kind: 'failed'; readonly title: string; readonly detail: string };

export default function DoctorProfile(): ReactNode {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const client = createClientForScenario();
    let cancelled = false;

    void Promise.all([
      client.listDoctors(),
      client.listVisits({ doctorId: id }),
      client.listConsentRecords({ doctorId: id }),
    ])
      .then(([doctorPage, visitPage, consentPage]) => {
        if (cancelled) return;
        const doctor = doctorPage.items.find((candidate) => candidate.id === id);
        if (doctor === undefined) {
          // Not found is not a denial, and saying "you do not have access" to a
          // doctor who simply is not in the list would be the app inventing a
          // decision the server never made.
          setState({
            kind: 'failed',
            title: 'That doctor is not in your list',
            detail: 'They may belong to another territory, or have been made inactive.',
          });
          return;
        }
        setState({
          kind: 'loaded',
          profile: buildDoctorProfile(doctor, visitPage.items, consentPage.items, Date.now()),
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiRequestError && error.code === 'permission_denied') {
          setState({
            kind: 'failed',
            title: 'You do not have access to this doctor',
            detail: error.message,
          });
          return;
        }
        setState({
          kind: 'failed',
          title: 'Could not load this doctor',
          detail: error instanceof Error ? error.message : 'Unknown failure',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  const profile = state.kind === 'loaded' ? state.profile : null;

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
        failure={state.kind === 'failed' ? { title: state.title, detail: state.detail } : null}
        loading={state.kind === 'loading'}
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
