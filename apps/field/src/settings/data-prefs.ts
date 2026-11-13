import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * `FE-W134` — the two "Your data" switches, kept on THIS phone.
 *
 * **AsyncStorage, not a server flag**, for the reason `onboarding/progress.ts` gives for the battery
 * marks: both are facts about this handset. WiFi-only protects the data plan of the SIM in this
 * phone; a server flag would follow the MR to a phone on office WiFi and keep holding audio there.
 *
 * **WiFi-only ships ON.** C4's note (`docs/design/phase2-first-run-and-the-day.dc.html`): "Audio is
 * 62% of the bill and the MR didn't choose to generate it." The warning ships OFF, as C4 draws it.
 *
 * **A read that fails answers the defaults** -- WiFi-only on, which is the side that cannot spend
 * the MR's money. A write that fails is reported to the caller, so a switch is never shown in a
 * position the phone did not keep.
 */
export interface DataPrefs {
  /** Voice notes and visit recordings wait for WiFi. Everything else still sends. */
  readonly wifiOnlyAudio: boolean;
  /** A note on Today once this app's mobile-data uploads pass 100 MB this month. */
  readonly warnOverMonthly: boolean;
}

export const DEFAULT_DATA_PREFS: DataPrefs = { wifiOnlyAudio: true, warnOverMonthly: false };

/** The storage this needs. AsyncStorage on a device; an in-memory map in a test. */
export interface KeyValue {
  readonly getItem: (key: string) => Promise<string | null>;
  readonly setItem: (key: string, value: string) => Promise<void>;
}

export const WIFI_ONLY_KEY = 'settings.wifiOnlyAudio';
export const WARN_OVER_KEY = 'settings.warnOverMonthlyData';

const flag = (raw: string | null, fallback: boolean): boolean =>
  raw === 'on' ? true : raw === 'off' ? false : fallback;

export const readDataPrefs = async (storage: KeyValue = AsyncStorage): Promise<DataPrefs> => {
  const [wifi, warn] = await Promise.all([
    storage.getItem(WIFI_ONLY_KEY).catch(() => null),
    storage.getItem(WARN_OVER_KEY).catch(() => null),
  ]);
  return {
    wifiOnlyAudio: flag(wifi, DEFAULT_DATA_PREFS.wifiOnlyAudio),
    warnOverMonthly: flag(warn, DEFAULT_DATA_PREFS.warnOverMonthly),
  };
};

const listeners = new Set<() => void>();

/**
 * Called after a switch is saved. Today and the queue screen stay mounted behind the settings
 * screen, so without this they would go on showing audio "waiting for WiFi" after the MR turned
 * WiFi-only off -- the same lesson `onQueueChanged` was written for.
 */
export const onDataPrefsChanged = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Throws when the phone did not keep it -- the screen then leaves the switch where it was. */
export const writeDataPref = async (
  key: keyof DataPrefs,
  value: boolean,
  storage: KeyValue = AsyncStorage,
): Promise<void> => {
  await storage.setItem(
    key === 'wifiOnlyAudio' ? WIFI_ONLY_KEY : WARN_OVER_KEY,
    value ? 'on' : 'off',
  );
  for (const listener of listeners) listener();
};
