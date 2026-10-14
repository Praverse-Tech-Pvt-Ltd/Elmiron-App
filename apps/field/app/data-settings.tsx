import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { DataSettingsScreen, Screen } from '@fieldforce/ui';
import type { DataSettingKey } from '@fieldforce/ui';
import { readDataPrefs, writeDataPref } from '../src/settings/data-prefs';
import type { DataPrefs } from '../src/settings/data-prefs';
import { megabytes, usedThisMonth } from '../src/sync/data-use';
import type { DataUseRecord } from '../src/sync/data-use';
import { readDataUse } from '../src/sync/data-use-store';
import { usePulledStore } from '../src/sync/pulled-store';

/**
 * `FE-W139` — route binding for C4's "Your data" settings. Reads the two switches and this month's
 * count off the phone, saves a change, and moves a switch only once the phone has kept it.
 *
 * The month is the SERVER's (`serverTime` from the pulled store): with no server instant yet, the
 * screen shows no figure rather than one for a month the handset's clock chose.
 */
export default function DataSettings(): ReactNode {
  const { serverTime } = usePulledStore();
  const [prefs, setPrefs] = useState<DataPrefs | null>(null);
  const [record, setRecord] = useState<DataUseRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailure, setSaveFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([readDataPrefs(), readDataUse()]).then(([nextPrefs, nextRecord]) => {
      if (!live) return;
      setPrefs(nextPrefs);
      setRecord(nextRecord);
    });
    return () => {
      live = false;
    };
  }, []);

  const change = (key: DataSettingKey, next: boolean): void => {
    if (saving || prefs === null) return;
    setSaving(true);
    setSaveFailure(null);
    void writeDataPref(key, next)
      .then(() => {
        setPrefs({ ...prefs, [key]: next });
      })
      .catch(() => {
        setSaveFailure('This phone could not save it. The switch shows what is still in effect.');
      })
      .finally(() => {
        setSaving(false);
      });
  };

  return (
    <Screen scrollable>
      <DataSettingsScreen
        wifiOnlyAudio={prefs?.wifiOnlyAudio ?? null}
        warnOverMonthly={prefs?.warnOverMonthly ?? null}
        onChange={change}
        saving={saving}
        saveFailure={saveFailure}
        usedThisMonth={serverTime === null ? null : megabytes(usedThisMonth(record, serverTime))}
      />
    </Screen>
  );
}
