import { useEffect, useState } from 'react';
import { onDataPrefsChanged, readDataPrefs } from '../settings/data-prefs';
import { onQueueChanged } from './async-storage-store';
import { dataNoteFor } from './data-use';
import type { DataUseRecord } from './data-use';
import { readDataUse } from './data-use-store';
import { deviceUploadConditions, uploadDevice } from './upload-conditions';
import type { UploadSnapshot } from './upload-conditions';

/**
 * `FE-W136` — the network and the WiFi-only switch, live, for the screens that say what is waiting.
 *
 * Re-read when the switch is saved and when the phone changes network, so Today and the queue
 * screen never keep saying "waiting for WiFi" about audio that WiFi-only no longer holds. `null`
 * until the first read lands -- and `heldAudioIds(…, null)` holds nothing, so nothing is claimed
 * before it is known.
 */
export const useUploadSnapshot = (): UploadSnapshot | null => {
  const [snapshot, setSnapshot] = useState<UploadSnapshot | null>(null);
  useEffect(() => {
    let live = true;
    const read = (): void => {
      void deviceUploadConditions.read().then((next) => {
        if (live) setSnapshot(next);
      });
    };
    read();
    const stopPrefs = onDataPrefsChanged(read);
    const stopNetwork = uploadDevice()?.onConnectionChange(read) ?? ((): void => undefined);
    return () => {
      live = false;
      stopPrefs();
      stopNetwork();
    };
  }, []);
  return snapshot;
};

/**
 * `FE-W138` — the note Today shows once this app's mobile-data uploads pass 100 MB this month, or
 * null. Re-read when the switch changes and whenever the queue is written (a flush that counted
 * something has just written it). The month is the SERVER's, from the pulled store's `serverTime`.
 */
export const useDataNote = (
  serverTime: string | null,
): { readonly title: string; readonly detail: string } | null => {
  const [state, setState] = useState<{ warnOn: boolean; record: DataUseRecord | null }>({
    warnOn: false,
    record: null,
  });
  useEffect(() => {
    let live = true;
    const read = (): void => {
      void Promise.all([readDataPrefs(), readDataUse()])
        .then(([prefs, record]) => {
          if (live) setState({ warnOn: prefs.warnOverMonthly, record });
        })
        .catch(() => undefined);
    };
    read();
    const stopPrefs = onDataPrefsChanged(read);
    const stopQueue = onQueueChanged(read);
    return () => {
      live = false;
      stopPrefs();
      stopQueue();
    };
  }, []);
  return dataNoteFor({ warnOn: state.warnOn, record: state.record, serverTime });
};
