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
