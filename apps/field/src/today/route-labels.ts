import { clockFrom } from './plan';

export { buildDayRoute } from './route';
export type { DayRoute, RouteStop, StopState } from './route';

/** `clockFrom`, but tolerant of a stop that has not started. */
export const clockFromOrNull = (iso: string | null): string | null =>
  iso === null ? null : clockFrom(iso);
