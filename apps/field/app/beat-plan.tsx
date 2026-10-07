import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { BeatPlanScreen, Screen } from '@fieldforce/ui';
import type { SyncQueueItem } from '@fieldforce/core';
import { visitsAsWitnessed, withPhoneTimes } from '../src/capture/visit';
import { loadQueueState, onQueueChanged } from '../src/sync/async-storage-store';
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

/**
 * FE-D3 B2. The plan arrived and its stops did not, and the last sync FAILED. It used to show
 * SYNCING above, which told the rep the stops were on their way when nothing was arriving.
 */
const STOPS_UNREACHABLE = {
  title: 'Your stops could not be loaded',
  detail:
    'Your plan for today arrived, but the last sync did not finish before its stops came through. They are not on this phone yet.',
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
const stopDetail = (stop: RouteStop, zone: TerritoryZone, fromPhone: boolean): string =>
  [
    // W2-E D (`BE-W165`): a time this phone recorded and the server has not yet returned is SAID to
    // be the phone's — the consent card's wording — never shown as though the server confirmed it.
    stop.startedAt === null
      ? null
      : `${clockIn(stop.startedAt, zone)}${fromPhone ? ' on this phone' : ''}`,
    stop.minutes === null ? null : `${String(stop.minutes)} min`,
    stop.state === 'cancelled' ? 'cancelled' : null,
    // Attendance, stated plainly. "doctor not available" says what happened without saying
    // whose fault it was, which is the whole of the C5 decision.
    stop.state === 'not_met' ? 'doctor not available' : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

const statusLineOf = (view: BeatPlanView): string | null =>
  view.kind === 'route' ||
  view.kind === 'syncing' ||
  view.kind === 'no-stops' ||
  view.kind === 'stops-unreachable'
    ? view.statusLine
    : null;

const noticeOf = (view: BeatPlanView): { title: string; detail: string } | null => {
  switch (view.kind) {
    case 'syncing':
      return SYNCING;
    case 'stops-unreachable':
      return STOPS_UNREACHABLE;
    case 'no-stops':
      return NO_STOPS;
    default:
      return null;
  }
};

export default function BeatPlanRoute(): ReactNode {
  const router = useRouter();
  const { store, status, today, zone } = usePulledStore();

  // W2-C A2 / `BE-W154`. The queue, kept current, so the route counts what this phone witnessed:
  // offline on the emulator it said "0 done" after four visits and kept a finished visit "Next".
  const [items, setItems] = useState<readonly SyncQueueItem[]>([]);
  useEffect(() => {
    let live = true;
    const read = (): void => {
      void loadQueueState().then((load) => {
        if (live) setItems(load.kind === 'loaded' ? load.state.items : []);
      });
    };
    read();
    const stop = onQueueChanged(read);
    return () => {
      live = false;
      stop();
    };
  }, []);

  // W2-E D (`BE-W165`): and the TIMES it witnessed, labelled as the phone's in `stopDetail`.
  const witnessed = withPhoneTimes(visitsAsWitnessed(visitsFromStore(store), items), items);
  const view = beatPlanView({
    status,
    today,
    plans: [...store.beat_plan.values()],
    entries: [...store.beat_plan_entry.values()],
    visits: witnessed.visits,
    doctors: doctorsFromStore(store),
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
        // FE-D2 3. A stop with a visit opens that visit; one without still opens the doctor.
        onOpenVisit={(visitId) => {
          router.push(`/visit/${visitId}`);
        }}
        planned={route?.planned ?? 0}
        statusLine={statusLineOf(view)}
        stops={(route?.stops ?? []).map((stop) => ({
          id: stop.doctorId,
          visitId: stop.visitId,
          doctorName: stop.doctorName,
          clinic: stop.clinic,
          state: stop.state,
          detail: stopDetail(
            stop,
            zone,
            stop.visitId !== null && witnessed.fromPhone.has(stop.visitId),
          ),
        }))}
      />
    </Screen>
  );
}
