import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { BeatPlanScreen, Button, Screen, t, useLanguage } from '@fieldforce/ui';
import type { SyncQueueItem } from '@fieldforce/core';
import { visitsAsWitnessed, withPhoneTimes } from '../src/capture/visit';
import { mapsEnabled } from '../src/features';
import { loadQueueState, onQueueChanged } from '../src/sync/async-storage-store';
import { usePulledStore } from '../src/sync/pulled-store';
import { doctorsFromStore, visitsFromStore } from '../src/sync/selectors';
import { useBack } from '../src/navigation/back';
import { beatPlanView } from '../src/today/beat-plan-view';
import { durationLabel } from '../src/today/duration';
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

// `FE-W154`. Functions, not constants, so each notice is read in the language current when shown.
const syncing = (): { title: string; detail: string } => ({
  title: t('route.syncingTitle'),
  detail: t('route.syncingDetail'),
});

/**
 * FE-D3 B2. The plan arrived and its stops did not, and the last sync FAILED. It used to show
 * SYNCING above, which told the rep the stops were on their way when nothing was arriving.
 */
const stopsUnreachable = (): { title: string; detail: string } => ({
  title: t('route.stopsUnreachableTitle'),
  detail: t('route.stopsUnreachableDetail'),
});

const noStops = (): { title: string; detail: string } => ({
  title: t('route.noStopsTitle'),
  detail: t('route.noStopsDetail'),
});

const unreachable = (): { title: string; detail: string } => ({
  title: t('route.unreachableTitle'),
  // Not "refused": the store has no answer to report, and a refusal would invent a decision.
  detail: t('route.unreachableDetail'),
});

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
      : fromPhone
        ? t('route.timeOnPhone', { time: clockIn(stop.startedAt, zone) })
        : clockIn(stop.startedAt, zone),
    // `FE-W191`. "8 h 4 min", never "484 min".
    stop.minutes === null ? null : durationLabel(stop.minutes),
    stop.state === 'cancelled' ? t('route.stopCancelled') : null,
    // Attendance, stated plainly. "doctor not available" says what happened without saying
    // whose fault it was, which is the whole of the C5 decision.
    stop.state === 'not_met' ? t('route.stopNotMet') : null,
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
      return syncing();
    case 'stops-unreachable':
      return stopsUnreachable();
    case 'no-stops':
      return noStops();
    default:
      return null;
  }
};

export default function BeatPlanRoute(): ReactNode {
  useLanguage();
  const router = useRouter();
  const back = useBack();
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
    <Screen onBack={back} scrollable>
      <BeatPlanScreen
        done={route?.done ?? 0}
        failure={view.kind === 'unreachable' ? unreachable() : null}
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
          // `FE-W191`. The current stop has begun: it is the visit the rep is in, not the next one.
          inProgress: stop.state === 'current' && stop.startedAt !== null,
          detail: stopDetail(
            stop,
            zone,
            stop.visitId !== null && witnessed.fromPhone.has(stop.visitId),
          ),
        }))}
      />
      {/* `FE-W85`. Only in a maps build, and only when there is a route to show. */}
      {mapsEnabled && route !== null ? (
        <Button
          label={t('route.seeOnMap')}
          variant="secondary"
          onPress={() => {
            router.push('/map?show=today');
          }}
        />
      ) : null}
    </Screen>
  );
}
