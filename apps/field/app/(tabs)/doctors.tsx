import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { DoctorListScreen, Screen } from '@fieldforce/ui';
import { useRouter } from 'expo-router';
import { usePulledStore } from '../../src/sync/pulled-store';
import { dayMonthIn } from '../../src/today/territory-day';
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
  const { store, status, serverTime, zone, failure: pullFailure } = usePulledStore();
  const doctors = doctorsFromStore(store);
  const visits = visitsFromStore(store);

  /**
   * **"On plan" is not offered, and that is a finding rather than a simplification.**
   *
   * The chip filters by today's beat plan, which means `BeatPlan.entries`.
   *
   * **MR-45 correction: the reason this comment gave in MR-44 was FALSE.** It said this screen
   * was "still on `createClientForScenario()`". It is not, and was not then: it reads
   * `usePulledStore()` a few lines above. MR-45 established that by ELIMINATION -- with the
   * mock dead, this screen still renders the server's doctors and their visit ages. MR-44
   * had asserted the opposite by inspection, and inspected the wrong thing.
   *
   * **What actually remains is smaller, and it is now only a decision to build it.**
   * `sync_pull` carries `beat_plan_entry` (MR-44), this screen reads the store, and as of
   * MR-45 `app/beat-plan.tsx` reads `store.beat_plan_entry` for today's plan through
   * `todaysPlan` in `src/today/beat-plan-view.ts`. The chip needs that same selection, so it
   * uses the plan the route screen uses rather than a second definition of "today's plan".
   *
   * **Until it is built, it stays absent rather than half-built.** Offering it with the wrong
   * plan, or before the stops have arrived, would filter against an empty set and show NO
   * DOCTORS -- indistinguishable from "none of your doctors are on today's plan", the client
   * presenting its own gap as a fact about the day. `BE-W89` -- PROJECT-OVERVIEW.md, MR-14 B9,
   * MR-44 B and MR-45 B5.
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
