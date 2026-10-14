import AsyncStorage from '@react-native-async-storage/async-storage';
import type { KeyValue } from '../settings/data-prefs';
import { accrue, dataUseFrom } from './data-use';
import type { DataUseRecord } from './data-use';
import type { UploadUse } from './upload-conditions';

/**
 * `FE-W137` — where the month's count is kept: one key, per PHONE rather than per rep, because the
 * data plan belongs to the SIM in this handset, not to whoever is signed in.
 */
export const DATA_USE_KEY = 'dataUse.mobileUploads';

export const readDataUse = async (
  storage: KeyValue = AsyncStorage,
): Promise<DataUseRecord | null> =>
  dataUseFrom(await storage.getItem(DATA_USE_KEY).catch(() => null));

/**
 * Add one upload. **Serialised**: a flush and a screen's own send can finish together, and two
 * read-add-write cycles interleaved would lose one of the two additions.
 */
export const dataUseRecorder = (
  storage: KeyValue = AsyncStorage,
): ((use: UploadUse) => Promise<void>) => {
  let last: Promise<void> = Promise.resolve();
  return (use) => {
    const next = last.then(async () => {
      const current = await readDataUse(storage);
      const updated = accrue(current, use.bytes, use.serverTime);
      if (updated !== null && updated !== current) {
        await storage.setItem(DATA_USE_KEY, JSON.stringify(updated));
      }
    });
    // A failed write must not jam every later one behind it.
    last = next.catch(() => undefined);
    return next;
  };
};
