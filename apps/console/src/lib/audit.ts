import type { ListAuditLogResponse } from '@fieldforce/core';
import { auditWhat, reasonLabel } from './labels';
import { plural } from './plural';

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
 * That is a property of the data, not a rendering choice, so the caveat this module supplies
 * says *succeeded* and the empty state never says "no access attempts". A screen that implied
 * it showed every attempt would be overclaiming in exactly the way this product's pitch is
 * that it does not.
 */

/**
 * The panel's own heading, so the claim it makes is asserted rather than typed into JSX.
 *
 * `FE-W165`: it said "Successful reads", over rows that were mostly creations and changes. The
 * claim that matters — everything here SUCCEEDED, and a refusal is not here — moved into the caveat
 * below, where it is a sentence rather than a heading that described the wrong rows.
 */
export const AUDIT_HEADING = 'Recent activity';

/**
 * Why a refusal is absent, shown to the reader rather than only to whoever reads this file.
 */
export const AUDIT_CAVEAT =
  'Every row here is something that succeeded: a read, a change or a creation. A refused read is ' +
  'not recorded in the trail, so this is not a list of every attempt.';

export interface AuditRow {
  readonly id: number;
  readonly actorId: string;
  /** The role as recorded, or null — never a guess. `whoLabel` turns it into a word. */
  readonly actorRole: string | null;
  /** "Created · AI request" — the same words `/audit` uses (`labels.ts`). */
  readonly what: string;
  readonly occurredAt: string;
  /**
   * The reason in a person's words: the screen that was opened for the console's own reads, the
   * typed words for anyone else's, and `—` when none was given (a trigger's row, not a person's).
   */
  readonly reason: string;
}

/**
 * Rows for the table.
 *
 * **A null is rendered as an absence, not as a blank.** A blank cell reads as "nothing happened";
 * `—` reads as "not recorded", which is what a null is. On `reason` that is informative: the read
 * paths require one, so its absence says the row came from a trigger rather than from a person.
 */
export const auditRows = (response: ListAuditLogResponse): readonly AuditRow[] =>
  response.data.map((entry) => ({
    id: entry.id,
    actorId: entry.actorId,
    actorRole: entry.actorRole,
    what: auditWhat(entry.action, entry.tableName),
    occurredAt: entry.occurredAt,
    reason: reasonLabel(entry.reason) ?? '—',
  }));

/**
 * The note for rows the system wrote, or nothing.
 *
 * Rows with no actor have no profile and therefore no organisation, so they cannot be shown to one
 * tenant without being shown to all. **Without this note a scoped page is indistinguishable from an
 * empty one** — which is the whole reason the server returns the count instead of dropping the rows.
 * `FE-W166`: one sentence for both screens, with the noun agreeing ("1 entry", "56 entries").
 */
export const systemRowsNote = (count: number): string | null =>
  count === 0
    ? null
    : `${plural(count, 'entry', 'entries')} made by the system itself, not by a person, ${
        count === 1 ? 'is' : 'are'
      } not shown: ${count === 1 ? 'it belongs' : 'they belong'} to no company.`;

export const hiddenRowsNote = (response: ListAuditLogResponse): string | null =>
  systemRowsNote(response.systemRowsHidden);

/**
 * What to say when the trail comes back empty, and what NOT to say.
 *
 * **Never "no access attempts".** An empty page here means nobody has successfully read
 * anything through the audited paths — it says nothing whatever about attempts, because
 * refusals are not recorded (`BE-W102`).
 */
export const emptyTrailNote = (): string =>
  'Nothing has been recorded yet. This does not mean there were no attempts — refusals are not ' +
  'recorded.';

/**
 * What to say when the read itself was refused or failed.
 *
 * **A refusal must not be rendered as an empty list.** `list_audit_log` raises `42501` for a
 * non-admin rather than returning an empty page, deliberately: an empty list claims there is
 * nothing to see, while a refusal claims something about who is asking.
 */
export const refusedNote = (): string =>
  'The activity could not be read: the request was refused or failed. It is not shown, rather ' +
  'than shown as empty.';

/**
 * The retention panel's own failure, in its own noun. It used to borrow the audit note and say
 * "This log was not shown" about a set of figures.
 */
export const retentionRefusedNote = (): string =>
  'The retention figures could not be read: the request was refused or failed. None are shown, ' +
  'rather than zeros.';
