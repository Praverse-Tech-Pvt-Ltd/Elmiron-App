import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { BeatPlanScreen, Screen } from '@fieldforce/ui';
import { usePulledStore } from '../src/sync/pulled-store';
import { doctorsFromStore, visitsFromStore } from '../src/sync/selectors';
import { beatPlanView } from '../src/today/beat-plan-view';
import type { BeatPlanView } from '../src/today/beat-plan-view';
import { clockIn } from '../src/today/territory-day';
import type { TerritoryZone } from '../src/today/territory-day';
import type { RouteStop } from '../src/today/route';

/**
 * B3 — the route binding. **On the pulled store as of MR-45 (`BE-W89`)**, after six weeks on
 * the mock.
 *
 * ### Why it was on the mock, and what changed
 *
 * `sync_pull` did not carry `beat_plan_entry`, so the handset had plans with no stops, and the
 * only empty state this screen had said *"No beat plan came through"* — false when a plan DID
 * come through. MR-14 left it on the mock rather than present that as the day's plan. MR-44
 * put the entity in the pull; this converts the read.
 *
 * ### What it shows now, and what it no longer shows
 *
 * **Every plan for today, with its status stated** — *"Submitted — not yet approved"*. The old
 * binding kept only `status === 'approved'`, and nothing in v1 ever writes `approved`: the
 * approval action is out of v1 with the manager console. So the filter hid every real plan.
 * The fix is to show the plan honestly, never to mark it approved.
 *
 * **Consent per stop is gone, and that is honest rather than a regression to repair.** The
 * mock sent consent records; the pull does not carry them (MR-12 Q4). A stop's consent is
 * therefore unknown on this screen, and it says nothing rather than something it cannot know.
 *
 * All the decisions live in `src/today/beat-plan-view.ts` and are asserted there. This file
 * binds them to the component and nothing else.
 */

const SYNCING = {
  title: 'Your stops are still syncing',
  detail:
    'Your plan for today arrived. Its stops have not yet — they will appear here when they do.',
};

const NO_STOPS = {
  title: 'This plan has no stops',
  detail: 'Your plan for today came through with no doctors on it.',
};

const UNREACHABLE = {
  title: 'Your route could not be loaded',
  // Not "refused": the store has no answer to report, and a refusal would invent a decision.
  detail: 'The last sync did not finish, so this screen cannot tell which plan is today’s.',
};

/**
 * A stop's line — attendance, the time it began, and how long it took.
 *
 * **The time is the TERRITORY's clock, via `clockIn`.** This used to be `clockFromOrNull`, a
 * character slice of the ISO string, which is only right when the string happens to carry the
 * territory's own offset — true of the mock at :4010, and false of Postgres, which stores UTC.
 * The slice was left behind a lint disable with a note saying to remove it on conversion; this
 * is the conversion.
 */
const stopDetail = (stop: RouteStop, zone: TerritoryZone): string =>
  [
    stop.startedAt === null ? null : clockIn(stop.startedAt, zone),
    stop.minutes === null ? null : `${String(stop.minutes)} min`,
    stop.state === 'cancelled' ? 'cancelled' : null,
    // Attendance, stated plainly. "doctor not available" says what happened without saying
    // whose fault it was, which is the whole of the C5 decision.
    stop.state === 'not_met' ? 'doctor not available' : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

const statusLineOf = (view: BeatPlanView): string | null =>
  view.kind === 'route' || view.kind === 'syncing' || view.kind === 'no-stops'
    ? view.statusLine
    : null;

const noticeOf = (view: BeatPlanView): { title: string; detail: string } | null => {
  switch (view.kind) {
    case 'syncing':
      return SYNCING;
    case 'no-stops':
      return NO_STOPS;
    default:
      return null;
  }
};

export default function BeatPlanRoute(): ReactNode {
  const router = useRouter();
  const { store, status, today, zone } = usePulledStore();

  const view = beatPlanView({
    status,
    today,
    plans: [...store.beat_plan.values()],
    entries: [...store.beat_plan_entry.values()],
    visits: visitsFromStore(store),
    doctors: doctorsFromStore(store),
    zone,
  });

  const route = view.kind === 'route' ? view.route : null;

  return (
    <Screen scrollable>
      <BeatPlanScreen
        done={route?.done ?? 0}
        failure={view.kind === 'unreachable' ? UNREACHABLE : null}
        loading={view.kind === 'loading'}
        notice={noticeOf(view)}
        onOpenDoctor={(doctorId) => {
          router.push(`/doctor/${doctorId}`);
        }}
        planned={route?.planned ?? 0}
        statusLine={statusLineOf(view)}
        stops={(route?.stops ?? []).map((stop) => ({
          id: stop.doctorId,
          doctorName: stop.doctorName,
          clinic: stop.clinic,
          state: stop.state,
          detail: stopDetail(stop, zone),
        }))}
      />
    </Screen>
  );
}
