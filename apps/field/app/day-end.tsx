import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { DayEndScreen, Screen } from '@fieldforce/ui';
import { totalDistanceMetres } from '../src/capture/mileage';
import { listMileage } from '../src/capture/visits';
import { loadQueueState } from '../src/sync/async-storage-store';
import { usePulledStore } from '../src/sync/pulled-store';
import { visitsFromStore } from '../src/sync/selectors';
import { NO_SERVER_CLOCK } from '../src/today/server-window';
import { indicatorStateFor } from '../src/sync/indicator';
import { emptyQueue } from '../src/sync/reducer';
import type { QueueLoad } from '../src/sync/async-storage-store';
import { CAPTURE_NOTE, summariseDayEnd } from '../src/today/day-end';
import { onDay } from '../src/today/plan';
import { clockIn } from '../src/today/territory-day';
import { refusedDetail } from '../src/errors/plain';

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
  const { store, status, today, zone, failure: pullFailure } = usePulledStore();
  const [noDay, setNoDay] = useState<{ title: string; detail: string } | null>(null);
  // `FE-W44`. The load, not the state — see the note in app/(tabs)/home.tsx.
  const [queue, setQueue] = useState<QueueLoad>({ kind: 'loaded', state: emptyQueue });

  useEffect(() => {
    let live = true;
    void loadQueueState().then((next) => {
      if (live) setQueue(next);
    });
    return () => {
      live = false;
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
      />
    </Screen>
  );
}
