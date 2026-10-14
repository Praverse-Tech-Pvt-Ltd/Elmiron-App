import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `FE-W149` — month names follow the app language.
 *
 * A complete stand-in Hindi and Marathi catalogue (every English value prefixed), so the store will
 * let the app switch to them. The dates themselves come from `Intl`, not from the catalogue.
 */
vi.mock('../../../../packages/ui/src/i18n/hi.json', async () => {
  const english = await vi.importActual<{ default: Record<string, string> }>(
    '../../../../packages/ui/src/i18n/en.json',
  );
  return {
    default: Object.fromEntries(Object.entries(english.default).map(([k, v]) => [k, `हि ${v}`])),
  };
});
vi.mock('../../../../packages/ui/src/i18n/mr.json', async () => {
  const english = await vi.importActual<{ default: Record<string, string> }>(
    '../../../../packages/ui/src/i18n/en.json',
  );
  return {
    default: Object.fromEntries(Object.entries(english.default).map(([k, v]) => [k, `म ${v}`])),
  };
});

import { languageStore } from '@fieldforce/ui/i18n';
import { clockIn, dayMonthIn, dayMonthOfDate, localisedWeekday } from './territory-day';
import { dayMonthFrom } from '../doctors/profile';
import type { TerritoryZone } from './territory-day';

const IST: TerritoryZone = { timeZone: 'Asia/Kolkata', source: 'territory' };
// 19:30Z on 10 September is 01:00 IST on the 11th: the zone still decides the day.
const LATE = '2026-09-10T19:30:00Z';

afterEach(() => {
  languageStore.choose('en');
});

describe('day and month, in the app language', () => {
  it('English keeps the app’s own short names ("Sep", never "Sept")', () => {
    expect(dayMonthIn(LATE, IST)).toBe('11 Sep');
    expect(dayMonthOfDate('2026-09-06')).toBe('6 Sep');
  });

  it('Hindi names the month in Hindi, in the territory’s zone, with Latin digits', () => {
    expect(languageStore.choose('hi')).toBe(true);
    expect(dayMonthIn(LATE, IST)).toBe('11 सित॰');
    expect(dayMonthOfDate('2026-09-06')).toBe('6 सित॰');
  });

  it('Marathi names the month in Marathi, and keeps Latin digits (its default is Devanagari)', () => {
    expect(languageStore.choose('mr')).toBe(true);
    expect(dayMonthIn(LATE, IST)).toBe('11 सप्टें');
    expect(dayMonthOfDate('2026-01-31')).toBe('31 जाने');
  });

  it('weekday names follow the language too; English stays with the app’s own table', () => {
    expect(localisedWeekday(1)).toBeNull();
    languageStore.choose('hi');
    expect(localisedWeekday(1)).toBe('सोमवार');
    expect(localisedWeekday(0)).toBe('रविवार');
    languageStore.choose('mr');
    expect(localisedWeekday(4)).toBe('गुरुवार');
  });

  it('the date-only helper used by mileage and samples follows the language', () => {
    expect(dayMonthFrom('2026-09-06')).toBe('6 Sep');
    languageStore.choose('hi');
    expect(dayMonthFrom('2026-09-06')).toBe('6 सित॰');
  });

  it('a clock time does not change with the language', () => {
    languageStore.choose('hi');
    expect(clockIn(LATE, IST)).toBe('01:00');
  });
});
