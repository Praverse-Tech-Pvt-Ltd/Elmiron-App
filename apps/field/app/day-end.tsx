import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import uuid from 'expo-modules-core/src/uuid';
import { DayEndScreen, Screen } from '@fieldforce/ui';
import type { DayEndWorkDay } from '@fieldforce/ui';
import { totalDistanceMetres } from '../src/capture/mileage';
import { visitsAsWitnessed } from '../src/capture/visit';
import { listMileage } from '../src/capture/visits';
import {
  QUEUE_UNREADABLE,
  loadQueueState,
  onQueueChanged,
  queueOwner,
} from '../src/sync/async-storage-store';
import { presentRejection } from '../src/sync/explanation';
import { enqueueFirst, flushOutbox, workDayQueueItem } from '../src/sync/outbox';
import { createPushClient } from '../src/sync/push-client';
import { usePulledStore } from '../src/sync/pulled-store';
import { visitsFromStore } from '../src/sync/selectors';
import { NO_SERVER_CLOCK } from '../src/today/server-window';
import { indicatorStateFor } from '../src/sync/indicator';
import { emptyQueue } from '../src/sync/reducer';
import type { QueueLoad } from '../src/sync/async-storage-store';
import { CAPTURE_NOTE, summariseDayEnd, workDayCopy } from '../src/today/day-end';
import { onDay } from '../src/today/plan';
import { clockIn } from '../src/today/territory-day';
import { endDayBlocker, workDayRequest, workDayStatus } from '../src/today/work-day';
import { refusedDetail } from '../src/errors/plain';
import { useLiveTracker } from '../src/tracking/tracker';

/**
 * B7 — the day-end binding.
 *
 * **FE-D14. It reads the real server.** The day's visits come from the pulled store
 * (`sync_pull`), chosen by Today's own `onDay` rule, so the two screens cannot disagree about
 * which visits were today's. The distance comes from `daily_mileage`, which CR-3 proved an MR
 * may call. It used to read `GET /visits` and `GET /mileage` on the mock at `127.0.0.1:4010`,
 * which a release build on a phone cannot reach. Times are rendered in the territory zone with
 * `clockIn`: Supabase sends them in UTC, and the old character slice would have shown 03:25 for
 * an 08:55 check-in.
 *
 * **The screen renders before the network answers and keeps rendering if it never
 * does.** C11's ordering makes the stop confirmation the load-bearing part, and
 * that part needs nothing from the server: it is true because of how this app
 * reads a position, not because of anything the day contained. Gating it behind a
 * request would leave an MR with no signal staring at a spinner while wondering
 * whether they are still being tracked — which is the exact moment C11 says they
 * kill the app from Recents.
 *
 * So a failure to load the totals is not this screen's failure state. It is shown
 * as absent numbers under a confirmation that still stands; only a denial, which
 * says something different, is surfaced as one.
 *
 * **`FE-W80` / `BE-W190`. "End my day" is a real act now.** The working day is a server record
 * (`work_days`), carried back by the pull. Pressing "End my day" puts the request on the queue
 * BEHIND anything still waiting (a check-out made with no signal must reach the server first) and
 * flushes; offline it waits and the card says so, in the phone's words. Once the server has it,
 * the pull brings the server's stamp and the card says that instead. A refusal (a visit still
 * checked in, 45016) is shown on the card with its remedy, and the button is offered again.
 */
const KM = (metres: number): string => `${(metres / 1000).toFixed(1)} km`;

/** The same refusal `MileageScreen` makes, on the screen that shows the day's total. */
const RATE_NOTE =
  'Distance only. Your rate per kilometre is set by your company and this app has not been given it, so the amount comes from payroll rather than from here.';

export default function DayEnd(): ReactNode {
  const router = useRouter();
  const [distanceMetres, setDistanceMetres] = useState<number | null>(null);
  const [distanceLoading, setDistanceLoading] = useState(true);
  // `FE-W42` C1. The territory's day, from the server's clock -- never the handset's.
  const { store, status, today, zone, failure: pullFailure, refresh } = usePulledStore();
  const tracker = useLiveTracker();
  const [noDay, setNoDay] = useState<{ title: string; detail: string } | null>(null);
  // `FE-W44`. The load, not the state — see the note in app/(tabs)/home.tsx.
  const [queue, setQueue] = useState<QueueLoad>({ kind: 'loaded', state: emptyQueue });
  // `FE-W80`. The note the rep leaves with the day, the press in flight, and a failure to even
  // put the request on the phone (an unreadable queue) -- the one outcome the queue cannot show.
  const [note, setNote] = useState('');
  const [ending, setEnding] = useState(false);
  const [notSaved, setNotSaved] = useState<{ title: string; detail: string } | null>(null);

  useEffect(() => {
    // `FE-W80`. Re-read whenever the queue is written (the note in app/(tabs)/home.tsx, `BE-W151`):
    // the working-day card follows "End my day" from queued, to sent, to refused.
    let live = true;
    const read = (): void => {
      void loadQueueState().then((next) => {
        if (live) setQueue(next);
      });
    };
    read();
    const stop = onQueueChanged(read);
    return () => {
      live = false;
      stop();
    };
  }, []);

  useEffect(() => {
    /**
     * **`FE-W42` C1. The day is the SERVER's, and with none this screen asks for nothing.**
     *
     * It used to be `todayIso(new Date())`, which read the handset for both the instant and
     * the calendar, and it is not merely rendered -- it is the `fromDate`/`toDate` this
     * screen asks the server for. A phone drifted across the 18:30Z IST midnight counted
     * the wrong day's visits and pulled the wrong day's mileage, and nothing said so.
     *
     * `today` is the territory date from the pull's `serverTime`, and after `FE-W40` it
     * survives a cold start bounded at the territory day boundary -- so when it is present
     * it is the right day, and when it is absent there is no honest day to substitute.
     */
    if (today === null) {
      setNoDay({ title: 'Could not confirm which day this is', detail: NO_SERVER_CLOCK });
      setDistanceLoading(false);
      return;
    }
    setNoDay(null);

    let cancelled = false;
    // Settled on its own: a mileage the server refuses must not take the visit counts down
    // with it. The day still happened. FE-D3 B4: a failure leaves the distance null, which the
    // screen reports as "not available" rather than "no distance yet".
    void listMileage(today, today)
      .then((outcome) => {
        if (cancelled) return;
        setDistanceMetres(outcome.kind === 'loaded' ? totalDistanceMetres(outcome.days) : null);
      })
      .catch(() => {
        if (!cancelled) setDistanceMetres(null);
      })
      .finally(() => {
        if (!cancelled) setDistanceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [today]);

  // The day's visits, from the pull. Only a pull that LANDED says what the day held: while the
  // first one is in flight, or after one failed, the counts are unknown and stay null (FE-D2 7).
  const summary =
    today === null || status !== 'ready'
      ? null
      : summariseDayEnd(visitsFromStore(store).filter((visit) => onDay(visit, today)));

  // `FE-W80`. The working day: the server's row from the pull, with what this phone is still sending.
  // `queueOwner()` rather than `useSession()`, for the reason app/visit/[id].tsx gives: the signed-in
  // rep owns the queue, and the session module cannot load under the test runner.
  const mrId = queueOwner();
  const items = queue.kind === 'loaded' ? queue.state.items : [];
  const dayStatus = workDayStatus(store, mrId, today, items);
  // The server's last "no" to ending this day, if the newest act on it was refused.
  const lastAct = [...items]
    .reverse()
    .find(
      (item) =>
        item.entity === 'work_day' && (item.payload as { workDate?: unknown }).workDate === today,
    );
  const lastRejection =
    lastAct?.status === 'failed' && queue.kind === 'loaded'
      ? queue.state.rejections[lastAct.id]
      : undefined;
  const shown = lastRejection === undefined ? null : presentRejection(lastRejection);
  const refusal =
    notSaved ??
    (shown === null
      ? null
      : {
          title: 'Your day was not ended',
          detail: [shown.explanation ?? shown.fallback, shown.remedy]
            .filter((line): line is string => line !== null && line !== '')
            .join(' '),
        });
  const copy = workDayCopy(dayStatus, zone, refusal);
  // As this phone witnessed them: a check-out made offline counts, and goes before the close.
  const blockedBy =
    today === null
      ? null
      : endDayBlocker(
          visitsAsWitnessed(visitsFromStore(store), items).filter((visit) => onDay(visit, today)),
        );

  const endDay = (): void => {
    if (ending || today === null || mrId === null) return;
    setEnding(true);
    setNotSaved(null);
    const body = workDayRequest({
      id: uuid.v4(),
      action: 'close',
      workDate: today,
      // A RECORD of when the rep pressed -- the phone is its only witness. The server stamps its
      // own `closed_at` beside it and bounds this one (45013).
      // eslint-disable-next-line no-restricted-syntax
      occurredAt: new Date().toISOString(),
      note,
    });
    // BE-W200 / FE-W90: ending the day ends the sharing at once, on this phone, before the request
    // is even sent; the server refuses any later position for an ended day (`day_ended`) regardless.
    void tracker?.closeDay();
    void (async () => {
      const queued = await enqueueFirst(workDayQueueItem(body));
      if (queued.kind === 'queue_unreadable') {
        setNotSaved({ title: 'Your day was NOT ended', detail: QUEUE_UNREADABLE });
        setEnding(false);
        return;
      }
      try {
        await flushOutbox(createPushClient());
      } catch {
        // No signal is not a failure here: the request is on the phone and goes later.
      }
      setEnding(false);
      // The server's stamp and snapshot arrive with the pull.
      refresh();
    })();
  };

  const workDay: DayEndWorkDay | null =
    copy === null
      ? null
      : {
          title: copy.title,
          detail: copy.detail,
          tone: copy.tone,
          note: copy.offerEnd ? { value: note, onChange: setNote } : null,
          action: copy.offerEnd
            ? { label: 'End my day', onPress: endDay, busy: ending, blockedBy }
            : null,
        };
  // Only a refusal says something different from "not loaded", so only a refusal is a failure
  // state. Anything else leaves the confirmation standing and the totals absent.
  const denial =
    noDay ??
    (pullFailure?.kind === 'refused' && pullFailure.refusal.code === 'not_permitted'
      ? {
          title: 'You do not have access to this day',
          detail: refusedDetail(pullFailure.refusal.sqlState),
        }
      : null);

  return (
    <Screen scrollable>
      <DayEndScreen
        captureNote={CAPTURE_NOTE}
        dayLabel="Today"
        distanceLabel={distanceMetres === null ? null : KM(distanceMetres)}
        // FE-D2 7. Null, not 0, when there is no summary: still loading, or the fetch failed. The
        // comment above always said a failure leaves "the totals absent"; `?? 0` made them present.
        done={summary?.done ?? null}
        notMet={summary?.notMet ?? null}
        failure={denial}
        firstCaptureLabel={
          summary?.firstCaptureAt == null
            ? null
            : `First check-in ${clockIn(summary.firstCaptureAt, zone)}`
        }
        lastCaptureLabel={
          summary?.lastCaptureAt == null
            ? null
            : `Last check-out ${clockIn(summary.lastCaptureAt, zone)}`
        }
        loading={status === 'loading' || distanceLoading}
        onOpenQueue={() => {
          router.push('/queue');
        }}
        onOpenTransparency={() => {
          router.push('/transparency');
        }}
        planned={summary?.planned ?? null}
        rateNote={RATE_NOTE}
        sync={indicatorStateFor(queue, zone)}
        workDay={workDay}
      />
    </Screen>
  );
}
