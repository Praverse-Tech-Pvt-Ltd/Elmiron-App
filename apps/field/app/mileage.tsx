import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiRequestError } from '@fieldforce/core';
import type { ListMileageResponse } from '@fieldforce/core';
import { MileageScreen, Screen } from '@fieldforce/ui';
import { createClientForScenario } from '../src/api';
import { usePulledStore } from '../src/sync/pulled-store';
import { NO_SERVER_CLOCK, monthWindowIn } from '../src/today/server-window';
// MR-25 C1. This screen still READS from the mock at :4010, which sends the territory's
// own offset, so the character slice is correct here. **DELETE THE DISABLE BELOW WHEN
// THIS SCREEN IS CONVERTED** and move to dayMonthIn / clockIn with the zone from
// usePulledStore(). MR-21 converted app/visit/[id].tsx and kept clockFrom; the gotcha
// entry did not stop it, and this line sitting on the import is what will.
// eslint-disable-next-line no-restricted-imports
import { dayMonthFrom } from '../src/doctors/profile';

/**
 * C2 — the mileage binding.
 *
 * The window is the current calendar month, which is what "on this month's claim"
 * means to an MR and to whoever processes it. Both dates are built from the device
 * calendar — that is a question about *which month the MR is looking at*, not a
 * claim about when anything happened, so the device is the right source.
 */
const KM = (metres: number): string => `${(metres / 1000).toFixed(1)} km`;

/**
 * Why there is no rupee figure. Shown to the MR rather than kept in a comment,
 * because they came to this screen for that number.
 */
const RATE_NOTE =
  'Your rate per kilometre is set by your company, and this app has not been given it. Distance here is what your claim is calculated from; the amount comes from payroll.';

export default function Mileage(): ReactNode {
  const [data, setData] = useState<ListMileageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<{ title: string; detail: string } | null>(null);
  // `FE-W42` C1. The instant and the zone both come from the server.
  const { serverTime, zone } = usePulledStore();

  useEffect(() => {
    /**
     * **`FE-W42` C1. Which MONTH is requested, reckoned in the territory from the server.**
     *
     * `monthWindow(new Date())` read the handset for the instant AND used local `getMonth()`
     * for the calendar, so for an IST territory it was wrong by 5h30m applied to a date. On
     * the first or last day of a month that returns the wrong month, and the MR reads a
     * claim total that is not theirs for this period.
     *
     * With no server clock this screen asks for nothing rather than guessing a month.
     */
    if (serverTime === null) {
      setFailure({ title: 'Could not tell which month to show', detail: NO_SERVER_CLOCK });
      setLoading(false);
      return;
    }

    let cancelled = false;
    void createClientForScenario()
      .listMileage(monthWindowIn(serverTime, zone))
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFailure(
          error instanceof ApiRequestError && error.code === 'permission_denied'
            ? { title: 'You do not have access to this mileage', detail: error.message }
            : {
                title: 'Could not load your mileage',
                detail: error instanceof Error ? error.message : 'Unknown failure',
              },
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serverTime, zone]);

  return (
    <Screen scrollable>
      <MileageScreen
        days={(data?.days ?? []).map((day) => ({
          id: `${day.mrId}-${day.travelDate}`,
          dateLabel: dayMonthFrom(`${day.travelDate}T00:00:00+05:30`),
          distanceLabel: KM(day.distanceMetres),
          checkInCount: day.checkInCount,
        }))}
        failure={failure}
        loading={loading}
        rateNote={RATE_NOTE}
        totalLabel={KM(data?.totalDistanceMetres ?? 0)}
      />
    </Screen>
  );
}
