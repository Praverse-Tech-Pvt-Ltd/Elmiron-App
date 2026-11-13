import { z } from 'zod';
import { IsoDateSchema, IsoDateTimeSchema, UuidSchema } from '../shared/primitives.js';
import { AdverseEventSourceSchema } from './adverse-event.js';

/**
 * `BE-W216` — the contract for the adverse-event admin reads (`BE-W215`,
 * `20261014000200_adverse_event_admin_read`).
 *
 * **Who these are for.** Until Q-13 names a pharmacovigilance contact, a company's own ADMIN is the
 * human a flagged adverse event routes to — and C1 makes that admin a TENANT administrator, so every
 * read below is the caller's own organisation and nothing else. A manager or a rep is refused with
 * `42501` (an HTTP 403 whose body is PostgREST's error envelope), and the refusal is in the audit
 * trail. Nothing here writes to a report: there is still no triage state, acknowledgement or
 * escalation, because none of that has been decided.
 *
 * Every call is an RPC run as the signed-in user; the database decides. The schemas parse exactly
 * what each returns, so the console and the database tests read one shape.
 */
export const ADVERSE_EVENT_ADMIN_RPC = {
  /**
   * Admin. The company's statutory clock: `AdverseEventClockSummarySchema` (`./adverse-event.js`).
   * No arguments and no reason — counts and deadlines name nobody — and a served call is not
   * audited; a refused one is.
   */
  clockSummary: 'adverse_event_clock_summary',
  /** Admin. The company's reports, newest first, a page at a time. Audited, needs a reason. */
  list: 'list_adverse_events',
  /** Admin. One report with the rep's own words. Audited, needs a reason. */
  read: 'read_adverse_event',
} as const;

/** `list_adverse_events`' page size when none is asked for, and its ceiling (the database clamps). */
export const ADVERSE_EVENT_LIST_DEFAULT = 50;
export const ADVERSE_EVENT_LIST_MAX = 200;

/**
 * One row of the list. **There is no `reportedText` here, by design**: the list is read every time
 * the screen opens, and the rep's words — the one field that can carry patient information — are
 * read only through `read_adverse_event`, with a reason of their own.
 */
export const AdverseEventListRowSchema = z.object({
  id: UuidSchema,
  visitId: UuidSchema,
  /** `transcript_detected` rows are listed too: routing is to a human, always. */
  source: AdverseEventSourceSchema,
  /** The server's receipt, which started the clock. */
  receivedAt: IsoDateTimeSchema,
  /** Fifteen calendar days from `receivedAt` (IPC PV Guidance §2.8). */
  statutoryDueAt: IsoDateTimeSchema,
  /** Whole hours left on the clock; negative once overdue. */
  hoursRemaining: z.number().int(),
  overdue: z.boolean(),
  /** Null for a pipeline detection: a detection carries nobody's name. */
  reportedByMrId: UuidSchema.nullable(),
  reportedByName: z.string().nullable(),
  doctorId: UuidSchema,
  doctorName: z.string(),
  /** The visit's day in the rep's zone (`visit_day`); null when the visit has no time at all. */
  visitDate: IsoDateSchema.nullable(),
});
export type AdverseEventListRow = z.infer<typeof AdverseEventListRowSchema>;

export const AdverseEventListSchema = z.object({
  data: z.array(AdverseEventListRowSchema),
  /**
   * The cursor for the next page, both null on the last one. Pass them back **exactly as returned**
   * — never through `new Date(...)`, which keeps milliseconds where the database keeps microseconds
   * and would skip rows at the page boundary. `adverseEventListArgs` does this for you.
   */
  nextBeforeReceivedAt: IsoDateTimeSchema.nullable(),
  nextBeforeId: UuidSchema.nullable(),
  readAt: IsoDateTimeSchema,
  auditLogId: z.number().int().positive(),
});
export type AdverseEventList = z.infer<typeof AdverseEventListSchema>;

/** The whole report: the list's fields and the ones a list deliberately leaves out. */
export const AdverseEventDetailSchema = AdverseEventListRowSchema.extend({
  /**
   * The rep's own words for `mr_reported`; null for a detection. May carry patient information —
   * the §2.6-versus-DPDP question the PV signatory (Q-13) has to rule on — so show it only on the
   * screen that asked for it, and never cache or log it.
   */
  reportedText: z.string().nullable(),
  /** A pointer into the redacted transcript; it dangles once a withdrawal destroys the transcript. */
  redactedTranscriptId: UuidSchema.nullable(),
  transcriptSegmentId: UuidSchema.nullable(),
  /** What the phone claimed. Evidence about the rep's experience, and not the clock. */
  clientReportedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type AdverseEventDetail = z.infer<typeof AdverseEventDetailSchema>;

export const AdverseEventReadSchema = z.object({
  /**
   * Null when no report with that id is in the caller's company — which is also what another
   * company's report looks like. The two are indistinguishable on purpose.
   */
  data: AdverseEventDetailSchema.nullable(),
  readAt: IsoDateTimeSchema,
  auditLogId: z.number().int().positive(),
});
export type AdverseEventRead = z.infer<typeof AdverseEventReadSchema>;

/** `list_adverse_events`' arguments, named as the database names them. */
export interface ListAdverseEventsArgs {
  /** Required and non-blank, or `22023`. Recorded with the read. */
  readonly p_reason: string;
  readonly p_limit: number;
  /** Both, or neither (`22023 cursor_incomplete`). */
  readonly p_before_received_at: string | null;
  readonly p_before_id: string | null;
}

/** `read_adverse_event`'s arguments. */
export interface ReadAdverseEventArgs {
  readonly p_id: string;
  /** Required and non-blank, or `22023`. Recorded with the read. */
  readonly p_reason: string;
}

/**
 * The arguments for a page of `list_adverse_events`: the first page with no `after`, the next one
 * with the previous page. The cursor strings are passed through untouched (see
 * `AdverseEventListSchema`), and the limit is clamped as the database clamps it.
 */
export const adverseEventListArgs = (
  reason: string,
  options: {
    readonly limit?: number;
    readonly after?: Pick<AdverseEventList, 'nextBeforeReceivedAt' | 'nextBeforeId'> | null;
  } = {},
): ListAdverseEventsArgs => {
  const asked = Math.trunc(options.limit ?? ADVERSE_EVENT_LIST_DEFAULT);
  const limit = Number.isFinite(asked)
    ? Math.min(Math.max(asked, 1), ADVERSE_EVENT_LIST_MAX)
    : ADVERSE_EVENT_LIST_DEFAULT;
  const after = options.after ?? null;
  const hasCursor =
    after !== null && after.nextBeforeReceivedAt !== null && after.nextBeforeId !== null;
  return {
    p_reason: reason,
    p_limit: limit,
    p_before_received_at: hasCursor ? after.nextBeforeReceivedAt : null,
    p_before_id: hasCursor ? after.nextBeforeId : null,
  };
};
