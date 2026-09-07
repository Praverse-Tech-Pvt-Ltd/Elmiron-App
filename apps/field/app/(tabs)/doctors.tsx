import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiRequestError } from '@fieldforce/core';
import type { Doctor, Visit } from '@fieldforce/core';
import { DoctorListScreen, Screen } from '@fieldforce/ui';
import { useRouter } from 'expo-router';
import { createClientForScenario } from '../../src/api';
import { FILTER_LABELS, buildDoctorRows, lastSeenLabel, rankDoctors } from '../../src/doctors/list';
import type { DoctorFilter } from '../../src/doctors/list';

/**
 * B8 — the doctor list, searchable.
 *
 * This route used to run against the mock's `denied` scenario on purpose, as FE-W1's
 * non-happy-path demonstration. That scenario is gone; the *pattern* it established
 * is not. A `permission_denied` still reaches the UI as a denial with its own state
 * and its own words, never as an empty list — an empty list is what a client-side
 * filter looks like, and the client never decides what an MR may see. The route
 * tests hold that, and they are the reason it was safe to point this at real data.
 *
 * Ranking, matching and the "overdue" threshold live in `src/doctors/list.ts` so
 * they can be tested without a renderer.
 */
export default function Doctors(): ReactNode {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<DoctorFilter>('all');
  const [onPlanIds, setOnPlanIds] = useState<ReadonlySet<string>>(new Set());
  const [doctors, setDoctors] = useState<readonly Doctor[]>([]);
  const [visits, setVisits] = useState<readonly Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<{ title: string; detail: string } | null>(null);

  useEffect(() => {
    const client = createClientForScenario();
    let cancelled = false;

    void Promise.all([client.listDoctors(), client.listVisits(), client.listBeatPlans()])
      .then(([doctorPage, visitPage, planPage]) => {
        if (cancelled) return;
        setDoctors(doctorPage.items);
        setVisits(visitPage.items);
        // "On plan" is the server's approved plan, never a guess. The newest
        // approved version wins, for the reason the beat plan route gives: a changed
        // plan is a new row, so an earlier version is a plan the manager replaced.
        const newest = planPage.items
          .filter((plan) => plan.status === 'approved')
          .slice()
          .sort((a, b) => b.version - a.version)[0];
        setOnPlanIds(new Set((newest?.entries ?? []).map((entry) => entry.doctorId)));
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoading(false);
        if (error instanceof ApiRequestError && error.code === 'permission_denied') {
          setFailure({ title: 'You do not have access to this list', detail: error.message });
          return;
        }
        setFailure({
          title: 'Could not load doctors',
          detail: error instanceof Error ? error.message : 'Unknown failure',
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // `Date.now()` is read once per data change rather than per render: a list whose
  // "6 weeks ago" labels recompute on every keystroke is doing arithmetic nobody
  // asked for, and could tick over mid-search.
  const all = useMemo(() => buildDoctorRows(doctors, visits, Date.now()), [doctors, visits]);
  const ranked = useMemo(
    () => rankDoctors(all, query, filter, onPlanIds),
    [all, query, filter, onPlanIds],
  );

  return (
    <Screen scrollable>
      <DoctorListScreen
        activeFilter={filter}
        failure={failure}
        filters={(['all', 'overdue', 'on-plan'] as const).map((id) => ({
          id,
          label: FILTER_LABELS[id],
        }))}
        onFilterChange={(id) => {
          setFilter(id as DoctorFilter);
        }}
        loading={loading}
        onOpenDoctor={(doctorId) => {
          router.push(`/doctor/${doctorId}`);
        }}
        onQueryChange={setQuery}
        query={query}
        rows={ranked.map((row) => ({
          id: row.id,
          name: row.name,
          detail: row.detail,
          lastSeenLabel: lastSeenLabel(row.daysSince),
          overdue: row.overdue,
        }))}
        total={all.length}
      />
    </Screen>
  );
}
