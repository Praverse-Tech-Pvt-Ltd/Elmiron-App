import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { DoctorListScreen, Screen } from '@fieldforce/ui';
import { useRouter } from 'expo-router';
import { usePulledStore } from '../../src/sync/pulled-store';
import { dayMonthIn } from '../../src/today/territory-day';
import { beatPlanView, onPlanDoctorIds } from '../../src/today/beat-plan-view';
import { doctorsFromStore, visitsFromStore } from '../../src/sync/selectors';
import { FILTER_LABELS, buildDoctorRows, lastSeenLabel, rankDoctors } from '../../src/doctors/list';
import type { DoctorFilter } from '../../src/doctors/list';
import { SESSION_EXPIRED, sessionExpired } from '../../src/sync/explanation';

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
  const { store, status, serverTime, today, zone, failure: pullFailure } = usePulledStore();
  const doctors = doctorsFromStore(store);
  const visits = visitsFromStore(store);

  /**
   * **"On plan" — `BE-W89`'s last piece, MR-46 D1.**
   *
   * The chip keeps the doctors on the plan the Beat plan screen shows, derived through the
   * same `beatPlanView` so the two cannot disagree about which plan is today's. It is offered
   * only when that plan has settled: `onPlanDoctorIds` returns `null` while the pull is
   * loading, the stops are syncing, the pull failed, or there is no plan today -- an empty
   * filter there would say "no doctors on your plan" about stops that have not arrived.
   *
   * MR-44 recorded this screen as mock and wrote that here; MR-45 established otherwise by
   * elimination and corrected it.
   */
  const onPlan = useMemo(
    () =>
      onPlanDoctorIds(
        beatPlanView({
          status,
          today,
          plans: [...store.beat_plan.values()],
          entries: [...store.beat_plan_entry.values()],
          visits,
          doctors,
        }),
      ),
    [status, today, store, visits, doctors],
  );
  // If the chip goes away while selected (a refresh re-opens the pull), the list must not keep
  // filtering by a set the screen no longer offers.
  const activeFilter: DoctorFilter = filter === 'on-plan' && onPlan === null ? 'all' : filter;

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
      : sessionExpired(pullFailure)
        ? SESSION_EXPIRED
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
  /**
   * **`FE-W42` C1. The reference instant is the SERVER's, and there is no fallback.**
   *
   * `serverTime` is the last instant the server gave this device. It is null until a pull has
   * succeeded at least once, and after `FE-W40` it is also restored from the day anchor on a
   * cold start -- bounded at the territory day boundary, so it is never more than one
   * territory day old.
   *
   * Null produces no age and no Overdue claim rather than a fallback, because every candidate
   * fallback is a lie of the same shape: the device clock is `FE-W40` option B, and any fixed
   * number renders an age that looks exactly like a measured one. See the sentinel entry in
   * `gotchas.md`.
   */
  const serverNow = serverTime === null ? null : Date.parse(serverTime);
  const all = useMemo(
    () => buildDoctorRows(doctors, visits, serverNow),
    [doctors, visits, serverNow],
  );
  const ranked = useMemo(
    () => rankDoctors(all, query, activeFilter, onPlan ?? new Set()),
    [all, query, activeFilter, onPlan],
  );

  return (
    <Screen scrollable>
      <DoctorListScreen
        activeFilter={activeFilter}
        failure={failure}
        filters={(onPlan === null
          ? (['all', 'overdue'] as const)
          : (['all', 'overdue', 'on-plan'] as const)
        ).map((id) => ({
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
          /**
           * **MR-31 C1/C3. Three states, not two, and the third is new.**
           *
           * `lastSeenLabel(null)` reads *"never visited"*. With a nullable server clock a
           * visited doctor now also produces `daysSince === null`, so routing both through
           * it would have told the MR a doctor they saw last week had never been seen --
           * the sentinel class, inside this very conversion.
           *
           * The third state renders the DATE instead of the age. It is a fact the server
           * gave, it needs no clock at all, and it is more useful than the age it replaces.
           */
          lastSeenLabel:
            row.lastSeenAt === null
              ? lastSeenLabel(null)
              : row.daysSince === null
                ? `last seen ${dayMonthIn(row.lastSeenAt, zone)}`
                : lastSeenLabel(row.daysSince),
          overdue: row.overdue,
        }))}
        total={all.length}
      />
    </Screen>
  );
}
