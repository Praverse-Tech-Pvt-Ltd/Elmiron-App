import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DATA_PREFS,
  WARN_OVER_KEY,
  WIFI_ONLY_KEY,
  readDataPrefs,
  writeDataPref,
} from './data-prefs';
import type { KeyValue } from './data-prefs';

/** `FE-W134` — the two "Your data" switches, kept on this phone. */

const memory = (): KeyValue & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => Promise.resolve(map.get(key) ?? null),
    setItem: (key, value) => {
      map.set(key, value);
      return Promise.resolve();
    },
  };
};

describe('the defaults C4 ships', () => {
  it('WiFi-only is ON and the warning is OFF on a phone that has never been asked', async () => {
    expect(DEFAULT_DATA_PREFS).toEqual({ wifiOnlyAudio: true, warnOverMonthly: false });
    await expect(readDataPrefs(memory())).resolves.toEqual(DEFAULT_DATA_PREFS);
  });

  it('storage that cannot be read answers the defaults — WiFi-only stays on', async () => {
    const broken: KeyValue = {
      getItem: () => Promise.reject(new Error('no storage')),
      setItem: () => Promise.resolve(),
    };
    await expect(readDataPrefs(broken)).resolves.toEqual(DEFAULT_DATA_PREFS);
  });

  it('a value it does not recognise is the default, never a guess', async () => {
    const storage = memory();
    storage.map.set(WIFI_ONLY_KEY, 'true');
    storage.map.set(WARN_OVER_KEY, '1');
    await expect(readDataPrefs(storage)).resolves.toEqual(DEFAULT_DATA_PREFS);
  });
});

describe('persistence', () => {
  it('what is set is what is read back, each switch on its own', async () => {
    const storage = memory();
    await writeDataPref('wifiOnlyAudio', false, storage);
    await expect(readDataPrefs(storage)).resolves.toEqual({
      wifiOnlyAudio: false,
      warnOverMonthly: false,
    });
    await writeDataPref('warnOverMonthly', true, storage);
    await writeDataPref('wifiOnlyAudio', true, storage);
    await expect(readDataPrefs(storage)).resolves.toEqual({
      wifiOnlyAudio: true,
      warnOverMonthly: true,
    });
    expect(storage.map.get(WIFI_ONLY_KEY)).toBe('on');
  });

  it('a write the phone did not keep is reported, so the switch does not move', async () => {
    const broken: KeyValue = {
      getItem: () => Promise.resolve(null),
      setItem: () => Promise.reject(new Error('disk full')),
    };
    await expect(writeDataPref('wifiOnlyAudio', false, broken)).rejects.toThrow('disk full');
  });
});
