import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * What the phone remembers about first run.
 *
 * Two things live here, and both existed as bugs before it did:
 *
 * 1. **Whether first run is finished.** Without it, the four onboarding screens are
 *    built and unreachable — signing in went straight to Today, so a new MR never
 *    saw the battery setup that keeps their check-ins working at all.
 * 2. **Which battery steps are done.** `OemBatteryScreen`'s done-marks lived in
 *    component state, so an MR who ticked all three, left the screen and came back
 *    found them unticked. That is the screen whose whole job is to survive being
 *    left, and it was the one thing that did not.
 *
 * **AsyncStorage, not a server flag.** Both facts are about *this handset* — which
 * OEM settings were changed on it, whether this install has been through setup. A
 * server-side flag would follow the MR to a new phone and tell them the battery
 * work was done on a device where it was not.
 *
 * Every read tolerates failure and answers "not done". Storage that throws should
 * cost an MR one extra pass through setup, never a screen that refuses to render.
 */
const FIRST_RUN_KEY = 'onboarding.firstRunCompletedAt';
const BATTERY_STEPS_KEY = 'onboarding.batteryStepsDone';

export const hasCompletedFirstRun = async (): Promise<boolean> => {
  try {
    return (await AsyncStorage.getItem(FIRST_RUN_KEY)) !== null;
  } catch {
    // Answering "not completed" sends the MR through setup again, which is
    // recoverable. Answering "completed" would skip the battery screen on a phone
    // that has never been set up, which is not.
    return false;
  }
};

export const markFirstRunComplete = async (at: string): Promise<void> => {
  try {
    await AsyncStorage.setItem(FIRST_RUN_KEY, at);
  } catch {
    // The MR still reaches Today. They see setup once more next launch.
  }
};

export const batteryStepsDone = async (): Promise<readonly string[]> => {
  try {
    const raw = await AsyncStorage.getItem(BATTERY_STEPS_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    // Anything that is not an array of strings is treated as nothing done. A
    // corrupted value must not become a step the MR is told they finished.
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

export const saveBatteryStepsDone = async (ids: readonly string[]): Promise<void> => {
  try {
    await AsyncStorage.setItem(BATTERY_STEPS_KEY, JSON.stringify([...ids]));
  } catch {
    // Ticks are lost on the next launch. The steps themselves still work, which is
    // what the screen is actually for.
  }
};

/** Test seam, and the reset an MR would need if they changed phones. */
export const forgetOnboarding = async (): Promise<void> => {
  try {
    await AsyncStorage.multiRemove([FIRST_RUN_KEY, BATTERY_STEPS_KEY]);
  } catch {
    // Nothing to do. The caller cannot act on this either.
  }
};
