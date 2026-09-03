import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { ApiRequestError } from '@fieldforce/core';
import { BeatPlanScreen, Screen } from '@fieldforce/ui';
import { createClientForScenario } from '../src/api';
import { consentLabel } from '../src/doctors/profile';
import { buildDayRoute, clockFromOrNull } from '../src/today/route-labels';
import type { DayRoute } from '../src/today/route';

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly route: DayRoute }
  | { readonly kind: 'failed'; readonly title: string; readonly detail: string };

/**
 * B3 — the route binding.
 *
 * The plan is taken as the server's newest approved one for this MR. `version` and
 * `supersedesBeatPlanId` exist because a changed plan is a new row rather than an
 * edit, so "newest" is the only correct reading — showing an earlier version would
 * send the MR to a clinic their manager already removed.
 */
export default function BeatPlanRoute(): ReactNode {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const client = createClientForScenario();
    let cancelled = false;

    void Promise.all([
      client.listBeatPlans(),
      client.listVisits(),
      client.listDoctors(),
      client.listConsentRecords(),
    ])
      .then(([plans, visits, doctors, consents]) => {
        if (cancelled) return;
        const newest = plans.items
          .filter((plan) => plan.status === 'approved')
          .slice()
          .sort((a, b) => b.version - a.version)[0];
        setState({
          kind: 'loaded',
          route: buildDayRoute(newest ?? null, visits.items, doctors.items, consents.items),
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiRequestError && error.code === 'permission_denied') {
          setState({
            kind: 'failed',
            title: 'You do not have access to this plan',
            detail: error.message,
          });
          return;
        }
        setState({
          kind: 'failed',
          title: 'Could not load your route',
          detail: error instanceof Error ? error.message : 'Unknown failure',
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const route = state.kind === 'loaded' ? state.route : null;

  return (
    <Screen scrollable>
      <BeatPlanScreen
        done={route?.done ?? 0}
        failure={state.kind === 'failed' ? { title: state.title, detail: state.detail } : null}
        loading={state.kind === 'loading'}
        onOpenDoctor={(doctorId) => {
          router.push(`/doctor/${doctorId}`);
        }}
        planned={route?.planned ?? 0}
        stops={(route?.stops ?? []).map((stop) => ({
          id: stop.doctorId,
          doctorName: stop.doctorName,
          clinic: stop.clinic,
          state: stop.state,
          detail: [
            clockFromOrNull(stop.startedAt),
            consentLabel(stop.consent),
            stop.minutes === null ? null : `${String(stop.minutes)} min`,
            stop.state === 'cancelled' ? 'cancelled' : null,
          ]
            .filter((part): part is string => part !== null)
            .join(' · '),
        }))}
      />
    </Screen>
  );
}
