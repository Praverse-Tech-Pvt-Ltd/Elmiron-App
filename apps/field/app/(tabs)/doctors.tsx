import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { DoctorListScreen, Screen } from '@fieldforce/ui';
import { useRouter } from 'expo-router';
import { usePulledStore } from '../../src/sync/pulled-store';
import { doctorsFromStore, visitsFromStore } from '../../src/sync/selectors';
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
  // MR-14 B2. Doctors and visits come from the store the pull maintains.
  const { store, status, failure: pullFailure } = usePulledStore();
  const doctors = doctorsFromStore(store);
  const visits = visitsFromStore(store);

  /**
   * **"On plan" is not offered, and that is a finding rather than a simplification.**
   *
   * The chip filters by today's approved beat plan, which means `BeatPlan.entries`.
   * `sync_pull` emits `visit`, `doctor`, `beat_plan` and `clinic_address` and has no
   * `beat_plan_entry` entity, so `BeatPlanRecord` is `BeatPlan` with `entries` omitted --
   * the rows exist in `public.beat_plan_entries` and simply never reach the client.
   *
   * Offering the chip anyway would filter against an empty set and show NO DOCTORS, which
   * is indistinguishable from "none of your doctors are on today's plan". That is the
   * client presenting its own gap as a fact about the day, which is the one thing this
   * screen's own header says it must never do about a denial. So the chip is absent until
   * the entity exists. Registered as BE-W89 -- see PROJECT-OVERVIEW.md, MR-14 B9.
   */
  /**
   * **A denial and a dropped connection are different screens.**
   *
   * `not_permitted` (42501) means the server considered the request and refused it. An
   * unreachable server means nobody answered. Telling an MR they lack access when their
   * wifi dropped is how trust in the app dies, and an empty list in place of either is
   * what a client-side filter looks like — which this client never does.
   */
  const failure =
    pullFailure === null
      ? null
      : pullFailure.kind === 'refused' && pullFailure.refusal.code === 'not_permitted'
        ? {
            title: 'You do not have access to this list',
            detail: 'The server refused this request for your account.',
          }
        : {
            title: 'Could not load doctors',
            detail:
              pullFailure.kind === 'refused'
                ? `The server refused this sync (${pullFailure.refusal.sqlState}).`
                : 'The app could not reach the server. It will try again when you come back to it.',
          };
  const loading = status === 'loading';

  // `Date.now()` is read once per data change rather than per render: a list whose
  // "6 weeks ago" labels recompute on every keystroke is doing arithmetic nobody
  // asked for, and could tick over mid-search.
  const all = useMemo(() => buildDoctorRows(doctors, visits, Date.now()), [doctors, visits]);
  const ranked = useMemo(() => rankDoctors(all, query, filter), [all, query, filter]);

  return (
    <Screen scrollable>
      <DoctorListScreen
        activeFilter={filter}
        failure={failure}
        filters={(['all', 'overdue'] as const).map((id) => ({
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
