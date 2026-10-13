import type { TeamWorkDay, TeamWorkDayStatus } from '@fieldforce/core';

/**
 * `BE-W191` — what the team's-day screen says, in a manager's words.
 *
 * **Every refusal is the database's** (`20261013000310_work_days`); this file only names it, by the
 * stable token at the start of the message (`reopen_needs_reason`, `work_day_not_closed`, …) --
 * never by SQLSTATE alone, because `42501` and `22023` each mean several things here.
 *
 * Pure, and outside the `'use client'` file, so it is tested without a renderer.
 */
export interface Refusal {
  readonly code?: string | null;
  readonly message: string;
}

export const reopenRefusal = ({ message }: Refusal): string => {
  if (/reopen_needs_reason/u.test(message)) {
    return 'Say why the day is being reopened — at least three characters. The reason is kept with the day.';
  }
  if (/work_day_not_closed/u.test(message)) {
    return 'This day is already open, so there is nothing to reopen. Reload the page to see it.';
  }
  if (/only a manager or an admin reopens/u.test(message)) {
    return 'Only a field manager or an admin reopens a rep’s day.';
  }
  if (/is not one you may reopen/u.test(message)) {
    return 'This rep is not in your team, so you cannot reopen their day.';
  }
  return `The server refused this: ${message}`;
};

export const teamDaysRefusal = ({ message }: Refusal): string => {
  if (/only a manager or an admin sees/u.test(message)) {
    return 'Only a field manager or an admin sees the team’s working days.';
  }
  return `The server refused this: ${message}`;
};

export const dayStatusLabel = (status: TeamWorkDayStatus): string =>
  ({ not_started: 'Not started', open: 'Open', closed: 'Ended' })[status];

/** "14:05", in the zone the day was reckoned in -- never the browser's or the server's. */
export const timeIn = (iso: string | null, zone: string | null): string | null => {
  if (iso === null || zone === null) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
};

/**
 * The day's visits as attendance, from the server's snapshot: "4 of 5 attended, 1 missed". Null
 * while the day is open -- an open day has no snapshot, and a live count here would be a second
 * derivation of the same figure.
 */
export const attendance = (day: TeamWorkDay): string | null => {
  if (
    day.visits_total === null ||
    day.visits_completed === null ||
    day.visits_not_met === null ||
    day.visits_missed === null
  ) {
    return null;
  }
  const attended = day.visits_completed + day.visits_not_met;
  const missed = day.visits_missed === 0 ? '' : `, ${String(day.visits_missed)} not started`;
  return `${String(attended)} of ${String(day.visits_total)} attended${missed}`;
};

export const distanceLabel = (metres: number | null): string | null =>
  metres === null ? null : `${(metres / 1000).toFixed(1)} km`;
