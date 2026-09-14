import { dayIn } from './territory-day';
import type { TerritoryZone } from './territory-day';

/**
 * `FE-W42` — the day, month and month-window a screen asks the server for, reckoned in the
 * TERRITORY's zone from the SERVER's clock.
 *
 * **The five screens this replaces were wrong twice over, not once.** Each built its window
 * with `new Date()` and then read it with local getters — `getFullYear()`, `getMonth()` — so
 * the handset supplied both the instant AND the zone. For an MR in IST that is a 5h30m
 * offset applied to a date, which moves the answer on the last day of a month and on every
 * day near midnight.
 *
 * `dayIn` already returns `YYYY-MM-DD` as the territory experiences it, so everything here is
 * a slice or a calendar computation on top of that. No function in this file reads a clock;
 * the instant is always passed in, and it is always `serverTime`.
 */

/** `2026-09` — the territory month an instant falls in. */
export const monthIn = (iso: string, zone: TerritoryZone): string => dayIn(iso, zone).slice(0, 7);

/**
 * The first and last calendar dates of the territory month an instant falls in.
 *
 * The arithmetic is deliberately done on a `YYYY-MM` string rather than a `Date`: once the
 * territory month is known, "the first of it" and "the last of it" are calendar facts with no
 * zone left in them. `Date.UTC(y, m, 0)` is the last day of month `m` counting from 1, which
 * is the one place a `Date` is still convenient — and it is UTC-only arithmetic over integers
 * the caller supplied, never a reading of one.
 */
export const monthWindowIn = (
  iso: string,
  zone: TerritoryZone,
): { readonly fromDate: string; readonly toDate: string } => {
  const month = monthIn(iso, zone);
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    fromDate: `${month}-01`,
    toDate: `${month}-${String(lastDay).padStart(2, '0')}`,
  };
};

/**
 * The last `count` territory months, oldest first, as `YYYY-MM`.
 *
 * Counts backwards from the territory month rather than from the device's, which is the
 * whole point: an MR opening the app at 23:50 IST on 30 September was being shown July,
 * August and **September** by a handset that had already rolled over to October in UTC.
 */
export const recentMonthsIn = (
  iso: string,
  zone: TerritoryZone,
  count: number,
): readonly string[] => {
  const month = monthIn(iso, zone);
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  return Array.from({ length: count }, (_, index) => {
    const offset = monthNumber - (count - 1 - index);
    const shifted = new Date(Date.UTC(year, offset - 1, 1));
    return `${String(shifted.getUTCFullYear())}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
  });
};

/**
 * `FE-W42` C1 — what a screen says when the server has never told it the time.
 *
 * **Names the missing thing rather than the network.** "Could not load" is true and sends
 * the MR to check their signal, which is not the problem when they are online and have
 * simply never completed a pull. Exported so the three screens that can hit this state say
 * one sentence between them rather than three that drift.
 */
export const NO_SERVER_CLOCK =
  'This app has not been able to ask the server what day it is, so it cannot tell which period to show you. It will try again when you come back to it.';
