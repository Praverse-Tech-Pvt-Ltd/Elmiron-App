import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * `FE-W71` — the territory date on which the rep last opened their day for live location.
 *
 * Kept per signed-in account, because these phones are shared: one rep opening their day must not
 * open the next rep's. A read that fails is "not opened" — the safe reading, since the cost is one
 * more press of "Start sharing for today", and the opposite error would track somebody who did not
 * start it.
 */
const keyFor = (userId: string): string => `fieldforce.liveTracking.openedDay.${userId}`;

export const readOpenedDay = async (userId: string): Promise<string | null> => {
  try {
    return await AsyncStorage.getItem(keyFor(userId));
  } catch {
    return null;
  }
};

export const writeOpenedDay = async (userId: string, day: string | null): Promise<void> => {
  if (day === null) await AsyncStorage.removeItem(keyFor(userId));
  else await AsyncStorage.setItem(keyFor(userId), day);
};
