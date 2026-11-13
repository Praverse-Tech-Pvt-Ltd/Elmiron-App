import { describe, expect, it } from 'vitest';
import type { SettingRow } from '@fieldforce/ui';
import { CATALOGUES } from '@fieldforce/ui/i18n';
import { settingsGroups } from './content';

/**
 * W2-C C / `BE-W160` — the "Product questions" row exists only when its flag is on.
 *
 * Off is the default: a build with `EXPO_PUBLIC_PRODUCT_QA` unset must carry no trace of the row.
 */
const nav = {
  onOpenMileage: () => undefined,
  onOpenDayEnd: () => undefined,
  onOpenBattery: () => undefined,
  onOpenTransparency: () => undefined,
  onOpenLocation: () => undefined,
  onOpenDataSettings: () => undefined,
  onChooseLanguage: () => undefined,
};
const ids = (groups: ReturnType<typeof settingsGroups>): string[] =>
  groups.flatMap((group) => group.rows.map((row) => row.id));

describe('settingsGroups — Product questions', () => {
  it('has NO row when the flag is off', () => {
    expect(ids(settingsGroups(nav))).not.toContain('product-qa');
  });

  it('has the row, opening the screen, when the flag is on', () => {
    let opened = false;
    const groups = settingsGroups({
      ...nav,
      onOpenProductQa: () => {
        opened = true;
      },
    });
    const row = groups.flatMap((group) => group.rows).find((each) => each.id === 'product-qa');
    expect(row?.title).toBe('Product questions');
    row?.onPress?.();
    expect(opened).toBe(true);
  });
});

describe('settingsGroups — Live location (`FE-W71`)', () => {
  it('has NO row when the flag is off', () => {
    expect(ids(settingsGroups(nav))).not.toContain('live-tracking');
  });

  it('has the row, opening the screen, when the flag is on', () => {
    let opened = false;
    const row = settingsGroups({
      ...nav,
      onOpenLiveTracking: () => {
        opened = true;
      },
    })
      .flatMap((group) => group.rows)
      .find((each) => each.id === 'live-tracking');
    expect(row?.title).toBe('Live location');
    row?.onPress?.();
    expect(opened).toBe(true);
  });
});

describe('settingsGroups — Your data (`FE-W139`)', () => {
  it('both rows govern something now, and open the Mobile data screen', () => {
    let opened = 0;
    const rows = settingsGroups({
      ...nav,
      onOpenDataSettings: () => {
        opened += 1;
      },
    }).flatMap((group) => group.rows);
    for (const id of ['wifi-only', 'warn-over']) {
      const row = rows.find((each) => each.id === id);
      expect(row?.state).toBe('available');
      row?.onPress?.();
    }
    expect(opened).toBe(2);
  });

  it('the consent-language row states a fact, and is not a setting (`FE-W148`)', () => {
    const row = settingsGroups(nav)
      .flatMap((group) => group.rows)
      .find((each) => each.id === 'consent-language');
    expect(row?.state).toBe('info');
    expect(row?.onPress).toBeUndefined();
    expect(row?.detail).toMatch(/English only/u);
  });
});

/**
 * `FE-W142` — the language rows, against the catalogues this build ships.
 *
 * Today the Hindi and Marathi files are empty: the rows must SHOW both languages, say how far the
 * translators have got, and refuse to be pressed. The other half — a complete file becomes
 * pressable with no code change — is `packages/ui/src/i18n/store.test.ts`.
 */
describe('settingsGroups — the language rows (`FE-W142`)', () => {
  const languageRows = (): SettingRow[] =>
    settingsGroups(nav)
      .flatMap((group) => group.rows)
      .filter((row) => row.id.startsWith('language-'));

  it('shows English, Hindi and Marathi, each named in its own script', () => {
    expect(languageRows().map((row) => row.title)).toEqual(['English', 'हिन्दी', 'मराठी']);
  });

  it('marks English as the one in use, and not pressable', () => {
    const english = languageRows().find((row) => row.id === 'language-en');
    expect(english?.state).toBe('chosen');
    expect(english?.onPress).toBeUndefined();
  });

  it('shows an untranslated language as waiting, with its progress, and never offers it', () => {
    const total = Object.keys(CATALOGUES.en).length;
    for (const [id, name] of [
      ['language-hi', 'Hindi'],
      ['language-mr', 'Marathi'],
    ] as const) {
      const row = languageRows().find((each) => each.id === id);
      expect(row?.state).toBe('not-yet');
      expect(row?.onPress).toBeUndefined();
      expect(row?.note).toBe(`${name}: waiting for translation (0 of ${String(total)} done)`);
    }
  });
});
