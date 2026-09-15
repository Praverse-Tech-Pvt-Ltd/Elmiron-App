import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { ApiRequestError } from '@fieldforce/core';
import { DayEndScreen, Screen } from '@fieldforce/ui';
import { createClientForScenario } from '../src/api';
import { loadQueueState } from '../src/sync/async-storage-store';
import { usePulledStore } from '../src/sync/pulled-store';
import { NO_SERVER_CLOCK } from '../src/today/server-window';
import { indicatorStateFor } from '../src/sync/indicator';
import { emptyQueue } from '../src/sync/reducer';
import type { QueueLoad } from '../src/sync/async-storage-store';
import { CAPTURE_NOTE, summariseDayEnd } from '../src/today/day-end';
// MR-25 C1. This screen still READS from the mock at :4010, which sends the territory's
// own offset, so the character slice is correct here. **DELETE THE DISABLE BELOW WHEN
// THIS SCREEN IS CONVERTED** and move to dayMonthIn / clockIn with the zone from
// usePulledStore(). MR-21 converted app/visit/[id].tsx and kept clockFrom; the gotcha
// entry did not stop it, and this line sitting on the import is what will.
// eslint-disable-next-line no-restricted-imports
import { clockFrom } from '../src/today/plan';

/**
 * B7 — the day-end binding.
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
  const [summary, setSummary] = useState<ReturnType<typeof summariseDayEnd> | null>(null);
  const [distanceMetres, setDistanceMetres] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  // `FE-W42` C1. The territory's day, from the server's clock -- never the handset's.
  const { today } = usePulledStore();
  const [denial, setDenial] = useState<{ title: string; detail: string } | null>(null);
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
      setDenial({ title: 'Could not confirm which day this is', detail: NO_SERVER_CLOCK });
      setLoading(false);
      return;
    }

    const client = createClientForScenario();
    const day = today;
    let cancelled = false;

    void Promise.all([
      client.listVisits(),
      // Settled separately: a mileage window the server refuses must not take the
      // visit counts down with it. The day still happened.
      client.listMileage({ fromDate: day, toDate: day }).catch(() => null),
    ])
      .then(([visits, mileage]) => {
        if (cancelled) return;
        setSummary(summariseDayEnd(visits.items));
        setDistanceMetres(mileage === null ? null : mileage.totalDistanceMetres);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiRequestError && error.code === 'permission_denied') {
          setDenial({ title: 'You do not have access to this day', detail: error.message });
        }
        // Anything else leaves the confirmation standing and the totals absent.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [today]);

  return (
    <Screen scrollable>
      <DayEndScreen
        captureNote={CAPTURE_NOTE}
        dayLabel="Today"
        distanceLabel={distanceMetres === null ? null : KM(distanceMetres)}
        done={summary?.done ?? 0}
        notMet={summary?.notMet ?? 0}
        failure={denial}
        firstCaptureLabel={
          summary?.firstCaptureAt == null
            ? null
            : `First check-in ${clockFrom(summary.firstCaptureAt)}`
        }
        lastCaptureLabel={
          summary?.lastCaptureAt == null
            ? null
            : `Last check-out ${clockFrom(summary.lastCaptureAt)}`
        }
        loading={loading}
        onOpenQueue={() => {
          router.push('/queue');
        }}
        onOpenTransparency={() => {
          router.push('/transparency');
        }}
        planned={summary?.planned ?? 0}
        rateNote={RATE_NOTE}
        sync={indicatorStateFor(queue)}
      />
    </Screen>
  );
}
