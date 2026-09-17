import type { AuditLogEntry, ListAuditLogResponse } from '@fieldforce/core';

/**
 * Phase 4 E3's audit panel — `FE-W13`, the half that can be asserted.
 *
 * Same split as `retention.ts` and for the same recorded reason: the pages are React Server
 * Components, there is no renderer, so the page binds and this module decides.
 *
 * ### The one thing this panel must never claim
 *
 * **`BE-W102`: a REFUSED read is not in the audit trail.** All seven read paths audit and then
 * return inside one transaction, so a refusal raised before the insert writes nothing, and one
 * raised after it writes a row the raise rolls back. The trail therefore contains **successful**
 * reads only.
 *
 * That is a property of the data, not a rendering choice, so the heading this module supplies
 * says *successful* and the empty state never says "no access attempts". A screen that implied
 * it showed every attempt would be overclaiming in exactly the way this product's pitch is
 * that it does not.
 */

/** The panel's own heading, so the claim it makes is asserted rather than typed into JSX. */
export const AUDIT_HEADING = 'Successful reads';

/**
 * Why `successful` is in the heading, shown to the reader rather than only to whoever reads
 * this file.
 */
export const AUDIT_CAVEAT =
  'Every row here is a read that succeeded. A refused read is not recorded in the trail, so ' +
  'this is not a list of every attempt.';

const ACTION_WORDS: Record<AuditLogEntry['action'], string> = {
  select: 'read',
  insert: 'created',
  update: 'changed',
  delete: 'deleted',
};

/** The action in the reader's words. `select` in particular is not a word a manager uses. */
export const actionWord = (action: AuditLogEntry['action']): string => ACTION_WORDS[action];

export interface AuditRow {
  readonly id: number;
  readonly actorId: string;
  /** The role as recorded, or the honest absence — never a guess. */
  readonly actorRole: string;
  readonly what: string;
  readonly occurredAt: string;
  /** The reason the caller gave. Required by the read paths, so its absence is meaningful. */
  readonly reason: string;
}

/**
 * Rows for the table.
 *
 * **`actorRole` and `reason` are nullable in the schema and are rendered as an absence, not as
 * a blank.** A blank cell reads as "nothing happened"; `—` with a stated meaning reads as "not
 * recorded", which is what a null is. The distinction matters most on `reason`, because the
 * read paths require one — a null there means the row came from a trigger rather than from a
 * person, and that is worth being able to see.
 */
export const auditRows = (response: ListAuditLogResponse): readonly AuditRow[] =>
  response.data.map((entry) => ({
    id: entry.id,
    actorId: entry.actorId,
    actorRole: entry.actorRole ?? 'not recorded',
    what: `${actionWord(entry.action)} ${entry.tableName}`,
    occurredAt: entry.occurredAt,
    reason: entry.reason ?? 'not recorded',
  }));

/**
 * The note explaining a short page, or nothing.
 *
 * `systemRowsHidden` counts rows with no actor. They have no profile and therefore no
 * organisation, so they cannot be shown to one tenant without being shown to all. **Without
 * this note a scoped page is indistinguishable from an empty one** — which is the whole reason
 * the server returns the count instead of silently dropping the rows.
 */
export const hiddenRowsNote = (response: ListAuditLogResponse): string | null =>
  response.systemRowsHidden === 0
    ? null
    : `${String(response.systemRowsHidden)} row(s) are not shown. They have no actor, so they belong to ` +
      'no organisation and cannot be shown to one without being shown to all.';

/**
 * What to say when the trail comes back empty, and what NOT to say.
 *
 * **Never "no access attempts".** An empty page here means nobody has successfully read
 * anything through the audited paths — it says nothing whatever about attempts, because
 * refusals are not recorded (`BE-W102`).
 */
export const emptyTrailNote = (): string =>
  'No successful reads have been recorded through the audited paths. This does not mean there ' +
  'were no attempts — refusals are not recorded.';

/**
 * What to say when the read itself was refused.
 *
 * **A refusal must not be rendered as an empty list.** `list_audit_log` raises `42501` for a
 * non-admin rather than returning an empty page, deliberately: an empty list claims there is
 * nothing to see, while a refusal claims something about who is asking. Collapsing one into the
 * other converts a true statement into a false one.
 */
export const refusedNote = (): string =>
  'This log was not shown because the request was refused, not because it is empty. Reading it ' +
  'requires an administrator, and the request itself is recorded.';
