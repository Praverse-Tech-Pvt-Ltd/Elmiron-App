import { t } from '@fieldforce/ui/i18n';

/**
 * `FE-W191` — how long a visit took, as a person says it.
 *
 * The route printed "484 min" (QA screenshot 17): a figure the rep has to divide by sixty. An hour
 * or more is hours and minutes — "8 h 4 min" — and each part is its own catalogue plural, so a
 * translator can give "1 h" and "8 h" different forms where their language has them.
 *
 * Whole minutes in, as `route.ts` computes them; nothing here reads a clock.
 */
export const durationLabel = (minutes: number): string => {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return t('route.durationMinutes', { count: rest });
  if (rest === 0) return t('route.durationHours', { count: hours });
  return t('route.durationHoursMinutes', {
    hours: t('route.durationHours', { count: hours }),
    minutes: t('route.durationMinutes', { count: rest }),
  });
};
