import type { VisitOrigin, VisitStatus } from '@fieldforce/core';

/**
 * `BE-W171` / `BE-C78` — what the planning screens say, in the manager's and the admin's words.
 *
 * **Every refusal is the database's** (`20261009000200_manager_planning`); this file only names it.
 * The functions put a stable token at the start of each message that a person needs to act on
 * (`plan_date_in_past`, `doctor_outside_target_territory`, …), and those tokens are what is matched
 * here -- never a SQLSTATE alone, because `42501` means four different things on these screens.
 *
 * Pure, and outside the `'use client'` files, so it is tested without a renderer.
 */
export interface Refusal {
  readonly code?: string | null;
  readonly message: string;
}

const unsoftened = (message: string): string => `The server refused this: ${message}`;

export const planRefusal = ({ code, message }: Refusal): string => {
  if (/plan_date_in_past/u.test(message)) {
    return 'That day has already ended for this rep. Plan today or a later day. Nothing was saved.';
  }
  if (/only a field manager plans/u.test(message)) {
    return 'Only a field manager plans a rep’s day. Admins grant planning access instead. Nothing was saved.';
  }
  if (/you may not plan for rep/u.test(message)) {
    return 'This rep is outside your territory on that day, and no admin has granted you access. Nothing was saved.';
  }
  if (/not an active doctor in rep/u.test(message)) {
    return 'One of the doctors is not an active doctor in this rep’s territory. Nothing was saved.';
  }
  if (/appears twice in one plan/u.test(message)) {
    return 'A doctor is on the plan twice. Remove one and save again.';
  }
  if (/at most 60 stops/u.test(message)) {
    return 'A day has at most 60 stops. Nothing was saved.';
  }
  if (code === '22023' && /already used for a different plan/u.test(message)) {
    return 'This save was already used for a different plan. Reload the page and save again.';
  }
  return unsoftened(message);
};

export const reassignRefusal = ({ message }: Refusal): string => {
  if (/reassignment_needs_reason/u.test(message)) {
    return 'Say why the visit is moving — the reason is kept with the reassignment.';
  }
  if (/doctor_outside_target_territory/u.test(message)) {
    return 'That rep does not cover this doctor’s territory, so the visit cannot move to them.';
  }
  if (/visit_not_reassignable/u.test(message)) {
    return 'Only a planned visit that has not started can move. A visit already worked stays with the rep who worked it.';
  }
  if (/plan_date_in_past/u.test(message)) {
    return 'That day has already ended. Its visits are history and do not move.';
  }
  if (/you may not plan for rep/u.test(message)) {
    return 'One of the two reps is outside your planning scope on that day.';
  }
  return unsoftened(message);
};

export const grantRefusal = ({ message }: Refusal): string => {
  if (/only an admin (grants|revokes)/u.test(message)) {
    return 'Only an admin grants or revokes planning access.';
  }
  if (/not an active field manager in your organisation/u.test(message)) {
    return 'Planning access can only be given to an active field manager in your company.';
  }
  if (/territory .* is not in your organisation/u.test(message)) {
    return 'That territory is not one of your company’s.';
  }
  if (/grant .* is not yours/u.test(message)) {
    return 'That grant is not one of your company’s. Nothing was revoked.';
  }
  if (/a grant has a start date/u.test(message)) {
    return 'Choose the day the grant starts.';
  }
  if (/planning_grants_dates_ordered/u.test(message)) {
    return 'The end date is before the start date.';
  }
  if (/planning_grants_not_self/u.test(message)) {
    return 'You cannot grant planning access to yourself.';
  }
  if (/check constraint .*reason|reason_check/u.test(message)) {
    return 'Say why — a reason of at least three characters is kept with the grant.';
  }
  return unsoftened(message);
};

/** A grant's state, as an admin reads it. */
export const grantStateLabel = (state: 'revoked' | 'ended' | 'not_started' | 'active'): string =>
  ({
    active: 'Active',
    not_started: 'Not started yet',
    ended: 'Ended',
    revoked: 'Revoked',
  })[state];

/** How a visit's origin is named on screen. Unclassified is never called "unplanned". */
export const originLabel = (origin: VisitOrigin): string =>
  ({
    planned: 'Planned',
    unplanned: 'Unplanned',
    unclassified: 'Before planning existed',
  })[origin];

export const statusLabel = (status: VisitStatus): string =>
  ({
    planned: 'Not started',
    in_progress: 'In progress',
    completed: 'Completed',
    cancelled: 'Cancelled',
    not_met: 'Doctor not met',
  })[status];

/** A planned visit may be moved only before it starts, and only on a day that has not ended. */
export const canReassign = (
  visit: {
    readonly origin: VisitOrigin;
    readonly status: VisitStatus;
    readonly startedAt: string | null;
  },
  plannedDate: string | null,
  repToday: string,
): boolean =>
  visit.origin === 'planned' &&
  visit.status === 'planned' &&
  visit.startedAt === null &&
  plannedDate !== null &&
  plannedDate >= repToday;
