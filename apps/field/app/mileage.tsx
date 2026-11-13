import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { MileageDay } from '@fieldforce/core';
import { MileageScreen, Screen, t, useLanguage } from '@fieldforce/ui';
import { totalDistanceMetres, travelDateLabel } from '../src/capture/mileage';
import { listMileage } from '../src/capture/visits';
import { useBack } from '../src/navigation/back';
import { usePulledStore } from '../src/sync/pulled-store';
import { noServerClock, monthWindowIn } from '../src/today/server-window';
import { failureDetail, refusedDetail } from '../src/errors/plain';

/**
 * C2 — the mileage binding.
 *
 * **FE-D14. It reads the real server**, through `daily_mileage` (`listMileage`), which CR-3
 * proved an MR may call. It used to read `GET /mileage` on the mock at `127.0.0.1:4010`, which a
 * release build on a phone cannot reach. The travel dates are plain dates the server reckoned, so
 * the MR-25 C1 character-slice exemption this file carried is gone with the mock.
 *
 * The window is the current calendar month, which is what "on this month's claim"
 * means to an MR and to whoever processes it. Both dates are built from the device
 * calendar — that is a question about *which month the MR is looking at*, not a
 * claim about when anything happened, so the device is the right source.
 */
const KM = (metres: number): string => t('common.km', { km: (metres / 1000).toFixed(1) });

/**
 * Why there is no rupee figure. Shown to the MR rather than kept in a comment,
 * because they came to this screen for that number. A function, so it is read in the
 * language in use when it is shown (`FE-W155`).
 */
const rateNote = (): string => t('mileage.rateNote');

/**
 * `FE-W155`. What went wrong, kept as a fact rather than as sentences: the words are built at
 * render, so a language change repaints a failure already on screen.
 */
type Failure =
  | { readonly kind: 'no-clock' }
  | { readonly kind: 'refused'; readonly denied: boolean; readonly sqlState: string | null }
  | { readonly kind: 'unreachable'; readonly error: unknown };

const failureText = (failure: Failure): { title: string; detail: string } => {
  switch (failure.kind) {
    case 'no-clock':
      return { title: t('mileage.whichMonth'), detail: noServerClock() };
    case 'refused':
      return {
        title: failure.denied ? t('mileage.noAccess') : t('mileage.couldNotLoad'),
        detail: refusedDetail(failure.sqlState),
      };
    case 'unreachable':
      return { title: t('mileage.couldNotLoad'), detail: failureDetail(failure.error) };
  }
};

export default function Mileage(): ReactNode {
  const [days, setDays] = useState<readonly MileageDay[] | null>(null);
  const [loading, setLoading] = useState(true);
  useLanguage();
  const [failure, setFailure] = useState<Failure | null>(null);
  const back = useBack();
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
      setFailure({ kind: 'no-clock' });
      setLoading(false);
      return;
    }

    let cancelled = false;
    const window = monthWindowIn(serverTime, zone);
    void listMileage(window.fromDate, window.toDate)
      .then((outcome) => {
        if (cancelled) return;
        if (outcome.kind === 'loaded') {
          setDays(outcome.days);
          return;
        }
        setFailure({
          kind: 'refused',
          denied: outcome.refusal.code === 'not_permitted',
          sqlState: outcome.refusal.sqlState,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFailure({ kind: 'unreachable', error });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serverTime, zone]);

  return (
    <Screen onBack={back} scrollable>
      <MileageScreen
        days={(days ?? []).map((day) => ({
          id: `${day.mrId}-${day.travelDate}`,
          dateLabel: travelDateLabel(day.travelDate),
          distanceLabel: KM(day.distanceMetres),
          checkInCount: day.checkInCount,
        }))}
        failure={failure === null ? null : failureText(failure)}
        loading={loading}
        rateNote={rateNote()}
        // FE-D3 B5. Null until the server has answered. `?? 0` showed "0.0 km" while loading.
        totalLabel={days === null ? null : KM(totalDistanceMetres(days))}
      />
    </Screen>
  );
}
