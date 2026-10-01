import type { MileageDay } from '@fieldforce/core';
import { dayMonthFrom } from '../doctors/profile';

/**
 * FE-D14 — what the mileage and day-end screens show from `daily_mileage`.
 *
 * `daily_mileage` returns one row per travel day and no total, so the total is the sum of the
 * rows the server sent: every distance in it is still the server's, summed from stored
 * coordinates. Nothing here measures or estimates a distance.
 */
export const totalDistanceMetres = (days: readonly MileageDay[]): number =>
  days.reduce((sum, day) => sum + day.distanceMetres, 0);

/**
 * "12 Sep" for a travel date.
 *
 * `travelDate` is a plain calendar date the server reckoned, not an instant, so there is no zone
 * left to apply and `dayMonthFrom` formats it off the characters — the same rule
 * `samplesDateLabel` follows for `visitDay`.
 */
export const travelDateLabel = (travelDate: string): string => dayMonthFrom(travelDate);
