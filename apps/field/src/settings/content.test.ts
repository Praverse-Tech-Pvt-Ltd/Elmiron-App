import { describe, expect, it } from 'vitest';
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

  it('the two language rows are still honestly not built', () => {
    const rows = settingsGroups(nav).flatMap((group) => group.rows);
    for (const id of ['app-language', 'consent-language']) {
      const row = rows.find((each) => each.id === id);
      expect(row?.state).toBe('not-yet');
      expect(row?.onPress).toBeUndefined();
    }
  });
});
