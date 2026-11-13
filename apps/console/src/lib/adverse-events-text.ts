import type { AdverseEventList, AdverseEventListRow } from '@fieldforce/core';
import { dayLabel, indiaDateTime } from './india-date';
import { plural } from './plural';

/**
 * `FE-W204` — the side-effect flags screens, in an admin's words.
 *
 * The reads are `BE-W215`'s (`20261014000200_adverse_event_admin_read.sql`): admin only, the
 * caller's own company only, each list or read audited with a reason. **Nothing here judges a
 * flag or ranks anybody**: flags are in the server's order, newest first, and the only emphasis is
 * the statutory deadline, which is a fact about the flag and not about a person.
 *
 * Pure, so it is tested without a renderer.
 */
export interface Refusal {
  readonly code?: string | null;
  readonly message: string;
}

/** The fixed note on both screens: who receives these, and what they must do with them. */
export const ROUTING_NOTE =
  'Until your company names a pharmacovigilance contact, admins receive these flags. Pass each one to your safety team within its deadline.';

/** What a manager is told, without the page asking a function that would refuse them. */
export const NOT_ADMIN_NOTE =
  'Side-effect flags go to your company’s admins until a pharmacovigilance contact is named. Ask an admin about a flag.';

export const sourceLabel = (source: string): string =>
  source === 'mr_reported'
    ? 'Reported by a rep'
    : source === 'transcript_detected'
      ? 'Found in a transcript'
      : 'Source not recognised';

/** Who flagged it. A transcript detection carries nobody's name, by design. */
export const reporterLabel = (
  row: Pick<AdverseEventListRow, 'source' | 'reportedByName'>,
): string =>
  row.reportedByName ??
  (row.source === 'transcript_detected' ? 'Nobody: found in a transcript' : 'Unknown rep');

export const visitDayLabel = (visitDate: string | null): string =>
  visitDate === null ? 'Not recorded' : dayLabel(visitDate);

/** "14 days, 6 hours left", "5 hours left"; null once nothing is left. */
export const timeLeft = (hours: number): string | null => {
  if (hours <= 0) return null;
  if (hours < 24) return `${plural(hours, 'hour', 'hours')} left`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return `${plural(days, 'day', 'days')}${rest === 0 ? '' : `, ${plural(rest, 'hour', 'hours')}`} left`;
};

export interface Deadline {
  /** "Due 29 Oct 2026, 18:05" or "Was due 29 Oct 2026, 18:05", India time. */
  readonly when: string;
  /** How long is left, or null when overdue. */
  readonly left: string | null;
  readonly overdue: boolean;
}

export const deadline = (
  row: Pick<AdverseEventListRow, 'statutoryDueAt' | 'hoursRemaining' | 'overdue'>,
): Deadline => {
  const at = indiaDateTime(row.statutoryDueAt);
  return row.overdue
    ? { when: `Was due ${at}`, left: null, overdue: true }
    : { when: `Due ${at}`, left: timeLeft(row.hoursRemaining), overdue: false };
};

export const adverseRefusal = ({ code, message }: Refusal): string => {
  if (code === '28000' || /not authenticated/u.test(message)) {
    return 'Your session has ended. Sign in again to see side-effect flags.';
  }
  if (/only an admin may read/u.test(message) || code === '42501') {
    return NOT_ADMIN_NOTE;
  }
  if (/requires a reason/u.test(message)) {
    return 'Say why you are opening this. The reason is kept in the audit log with the read.';
  }
  if (/cursor_incomplete/u.test(message)) {
    return 'That page link was incomplete. Go back to the newest flags.';
  }
  return `The server refused this: ${message}`;
};

/** The two cursor strings, both or neither, passed back exactly as the server sent them. */
export interface Cursor {
  readonly nextBeforeReceivedAt: string;
  readonly nextBeforeId: string;
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** The page asked for in the URL, or null for the newest page. Never parsed into a `Date`. */
export const cursorFrom = (
  before: string | undefined,
  beforeId: string | undefined,
): Cursor | null =>
  before !== undefined && beforeId !== undefined && INSTANT.test(before) && UUID.test(beforeId)
    ? { nextBeforeReceivedAt: before, nextBeforeId: beforeId }
    : null;

/** The link to the next, older page, or null on the last one. */
export const olderHref = (
  page: Pick<AdverseEventList, 'nextBeforeReceivedAt' | 'nextBeforeId'>,
): string | null =>
  page.nextBeforeReceivedAt === null || page.nextBeforeId === null
    ? null
    : `/adverse-events?${new URLSearchParams({
        before: page.nextBeforeReceivedAt,
        beforeId: page.nextBeforeId,
      }).toString()}`;
