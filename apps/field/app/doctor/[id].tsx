import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { DoctorProfileScreen, Screen, t, useLanguage } from '@fieldforce/ui';
import { usePulledStore } from '../../src/sync/pulled-store';
import { doctorsFromStore, visitsFromStore } from '../../src/sync/selectors';
import { lastSeenLabel } from '../../src/doctors/list';
import { availabilityFrom, availabilitySentence } from '../../src/doctors/availability';
import { buildDoctorProfile, consentLabel, sentenceCase } from '../../src/doctors/profile';
import { dayMonthIn } from '../../src/today/territory-day';
import { durationLabel } from '../../src/today/duration';
import { SESSION_EXPIRED, sessionExpired } from '../../src/sync/explanation';
import { notPermittedDetail, refusedDetail } from '../../src/errors/plain';
import { witnessedStage } from '../../src/capture/visit';
import { loadQueueState, onQueueChanged } from '../../src/sync/async-storage-store';
import type { QueueLoad } from '../../src/sync/async-storage-store';
import { emptyQueue } from '../../src/sync/reducer';
import { useBack } from '../../src/navigation/back';

/** B9 shows three. More than that is a history screen, which this is not. */
const VISITS_SHOWN = 3;

/**
 * C14, printed on the screen rather than assumed by it. The design's note: a profile
 * screen is exactly where prescriber profiling would creep in, so the absence is
 * stated.
 */
const boundary = (): string => t('doctors.boundary');

export default function DoctorProfile(): ReactNode {
  useLanguage();
  const { id } = useLocalSearchParams<{ id: string }>();
  // MR-14 B2. The doctor and their visits come from the store the pull maintains.
  const { store, status, zone, serverTime, failure: pullFailure } = usePulledStore();
  // `FE-W188`. The screen's Back control.
  const back = useBack();

  const doctor = doctorsFromStore(store).find((candidate) => candidate.id === id);
  const visits = visitsFromStore(store).filter((visit) => visit.doctorId === id);

  // `FE-W190`. Whether the rep is in a visit with this doctor NOW -- read as the visit screen reads
  // it (`witnessedStage`), so a check-in queued with no signal counts as much as one the server
  // has. Kept current while the screen is open, as the visit screen keeps its own queue read.
  const [queueLoad, setQueueLoad] = useState<QueueLoad>({ kind: 'loaded', state: emptyQueue });
  useEffect(() => {
    const read = (): void => {
      void loadQueueState().then(setQueueLoad);
    };
    read();
    return onQueueChanged(read);
  }, []);
  const queued = queueLoad.kind === 'loaded' ? queueLoad.state.items : emptyQueue.items;
  const inVisitNow = visits.some((visit) => witnessedStage(visit, queued).stage === 'during');

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
  // `FE-W42` C1. The SERVER's instant, or none -- see the note in `app/(tabs)/doctors.tsx`.
  // `daysSince` is already null-checked below before it becomes a label, so a null clock
  // renders no age rather than a wrong one.
  const serverNow = serverTime === null ? null : Date.parse(serverTime);
  const profile =
    doctor === undefined ? null : buildDoctorProfile(doctor, visits, [], serverNow, zone);

  const failure =
    pullFailure !== null
      ? sessionExpired(pullFailure)
        ? SESSION_EXPIRED
        : pullFailure.kind === 'refused' && pullFailure.refusal.code === 'not_permitted'
          ? {
              title: t('doctors.noAccessDoctor'),
              detail: notPermittedDetail(),
            }
          : {
              title: t('doctors.couldNotLoadDoctor'),
              detail:
                pullFailure.kind === 'refused'
                  ? refusedDetail(pullFailure.refusal.sqlState)
                  : t('doctors.unreachableDoctor'),
            }
      : status !== 'loading' && doctor === undefined
        ? {
            // Not found is not a denial. Saying "you do not have access" about a doctor who
            // simply is not in the list would be the app inventing a decision the server
            // never made.
            title: t('doctors.notFoundTitle'),
            detail: t('doctors.notFoundDetail'),
          }
        : null;

  return (
    <Screen scrollable onBack={back}>
      <DoctorProfileScreen
        inVisitNow={inVisitNow}
        availability={availabilitySentence(
          availabilityFrom(
            (profile?.recentVisits ?? [])
              .map((entry) => entry.startedAt)
              .filter((at): at is string => at !== null),
            zone,
          ),
        )}
        boundary={boundary()}
        detail={profile?.detail ?? ''}
        failure={failure}
        loading={status === 'loading'}
        name={profile?.name ?? t('doctors.nameFallback')}
        recentVisits={(profile?.recentVisits ?? []).slice(0, VISITS_SHOWN).map((visit) => ({
          id: visit.visitId,
          // MR-25 C1. `dayMonthFrom` slices characters out of the ISO string, which reads
          // the UTC day for a Supabase timestamp. This screen has been on real data since
          // MR-14 and the slice was right only by luck: a visit completed at 08:22Z is the
          // same day in IST, and one completed at 19:00Z is the NEXT day and rendered as the
          // previous one. MR-24's B1 checked "9 Sep" here and it happened to be correct.
          dateLabel: dayMonthIn(visit.completedAt, zone),
          // `FE-W198`. "8 h 4 min", not "484 min" (15 October re-check): the beat plan's words.
          durationLabel: visit.minutes === null ? null : durationLabel(visit.minutes),
          consentLabel: consentLabel(visit.consent),
        }))}
        sinceLabel={
          profile === null || profile.daysSince === null
            ? null
            : sentenceCase(lastSeenLabel(profile.daysSince))
        }
      />
    </Screen>
  );
}
