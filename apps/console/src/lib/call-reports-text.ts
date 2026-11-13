import type { BulkDecision, CallReportRow } from './manager-rows';
import { indiaDate, indiaDateTime } from './india-date';
import { plural } from './plural';

/**
 * `FE-W200` / `FE-W201` — what the call report screens say, in a manager's words.
 *
 * **Every refusal is the database's** (`approve_call_report`, last replaced in
 * `20260917000100_close_the_admin_escape.sql`); this file only names it, by the words the function
 * raises. **Nothing here orders or scores a rep**: reports stay in the order the server gives them,
 * oldest first, which is the order a manager clears them in.
 *
 * Pure, and outside the `'use client'` files, so it is tested without a renderer.
 */
export interface Refusal {
  readonly code?: string | null;
  readonly message: string;
}

/** Why a decision was refused, as a sentence a manager can act on. */
export const decisionRefusal = ({ code, message }: Refusal): string => {
  if (code === '28000' || /not authenticated/u.test(message)) {
    return 'Your session has ended. Sign in again, then decide the report.';
  }
  if (/only a field_manager or admin may decide/u.test(message)) {
    return 'Only a field manager or an admin decides a call report.';
  }
  if (/is not in your scope/u.test(message)) {
    return 'This report is from a rep outside your team, so you cannot decide it.';
  }
  if (/author of a call report may not decide it/u.test(message)) {
    return 'You wrote this report, so somebody else has to decide it.';
  }
  if (/only a submitted report can be decided/u.test(message)) {
    return 'This report is not waiting for a decision: the rep has not sent it for approval.';
  }
  if (/superseded by a newer version/u.test(message)) {
    return 'The rep has sent a newer version of this report. Reload the page to read it.';
  }
  // `BE-W221`: the list on screen was stale -- somebody decided this report after it was loaded.
  if (/already has a decision/u.test(message)) {
    return 'Somebody has already decided this report. Open it to see the decision, or to change it.';
  }
  if (/needs a reason/u.test(message)) {
    return 'Say why the report is not approved. The rep reads the reason.';
  }
  if (/no call reports supplied/u.test(message)) {
    return 'Tick at least one report first.';
  }
  return `The server refused this: ${message}`;
};

/** Why the list itself could not be read. */
export const queueRefusal = ({ code, message }: Refusal): string =>
  code === '28000' || /not authenticated/u.test(message)
    ? 'Your session has ended. Sign in again to see the reports waiting for you.'
    : `The reports waiting for you could not be read. The server said: ${message}`;

/** The first words of a summary, cut at a word, so a row stays a row. The full text is one click on. */
export const preview = (text: string, max = 140): string => {
  const flat = text.replace(/\s+/gu, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/u, '')}…`;
};

/** A visit as the console reads it from `visits`, under RLS. */
export interface VisitFacts {
  readonly doctorId: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly scheduledFor: string | null;
}

/** What the screens print, gathered from the reads beside the report. A name not readable is null. */
export interface ReportLookups {
  /** Names of the people involved: the reps who wrote, and whoever decided. */
  readonly people: ReadonlyMap<string, string>;
  readonly visits: ReadonlyMap<string, VisitFacts>;
  readonly doctors: ReadonlyMap<string, string>;
  readonly products: ReadonlyMap<string, string>;
}

/** One report, ready to print: names and India dates in place of ids and instants. */
export interface CallReportView {
  readonly id: string;
  readonly repName: string;
  readonly doctorName: string;
  /** The visit's date in India ("14 Oct 2026"), or null when the visit could not be read. */
  readonly visitDay: string | null;
  /** When the report reached the server, in India time. */
  readonly sentAt: string;
  readonly summary: string;
  readonly products: readonly string[];
  readonly objections: string | null;
  readonly nextStep: string | null;
  readonly version: number;
  readonly fromVoiceNote: boolean;
  readonly effectiveStatus: string;
  readonly decidedAt: string | null;
  readonly decidedByName: string | null;
}

/** The day the visit happened: when it ended, else when it started, else the day it was planned for. */
export const visitDay = (visit: VisitFacts | undefined): string | null => {
  const at = visit?.completedAt ?? visit?.startedAt ?? visit?.scheduledFor ?? null;
  return at === null ? null : indiaDate(at);
};

const blankToNull = (value: string | null): string | null =>
  value === null || value.trim() === '' ? null : value;

export const reportView = (row: CallReportRow, look: ReportLookups): CallReportView => {
  const visit = look.visits.get(row.visitId);
  const doctor =
    visit === undefined || visit.doctorId === null ? undefined : look.doctors.get(visit.doctorId);
  return {
    id: row.id,
    repName: look.people.get(row.mrId) ?? 'Unknown rep',
    doctorName: doctor ?? 'A doctor you cannot see',
    visitDay: visitDay(visit),
    sentAt: indiaDateTime(row.createdAt),
    summary: row.summary,
    // A product the caller cannot read is still counted, never silently dropped.
    products: row.productIds.map((id) => look.products.get(id) ?? 'A product no longer listed'),
    objections: blankToNull(row.objections),
    nextStep: blankToNull(row.nextStep),
    version: row.version,
    fromVoiceNote: row.draftSource === 'voice_note',
    effectiveStatus: row.effectiveStatus,
    decidedAt: row.decidedAt === null ? null : indiaDateTime(row.decidedAt),
    decidedByName: row.decidedBy === null ? null : (look.people.get(row.decidedBy) ?? null),
  };
};

/** "Rep 1 (Pune), Dr Rao": how one report is named in a sentence about several. */
export const reportName = (view: Pick<CallReportView, 'repName' | 'doctorName'>): string =>
  `${view.repName}, ${view.doctorName}`;

/** What a decided report's status reads as. A draft is a report the rep has not sent. */
export const decisionLine = (view: CallReportView): string => {
  const by = view.decidedByName === null ? '' : ` by ${view.decidedByName}`;
  const on = view.decidedAt === null ? '' : ` on ${view.decidedAt}`;
  switch (view.effectiveStatus) {
    case 'approved':
      return `Approved${by}${on}.`;
    case 'rejected':
      return `Not approved${by}${on}.`;
    case 'submitted':
      return 'Waiting for a decision.';
    case 'draft':
      return 'The rep has not sent this report for approval yet.';
    default:
      return 'This report’s state is not one this console recognises.';
  }
};

/** A report's line under its title: who sent it, when, and which version. */
export const sentLine = (view: CallReportView): string => {
  const version = view.version > 1 ? ` This is version ${String(view.version)}.` : '';
  const voice = view.fromVoiceNote ? ' Drafted from a voice note.' : '';
  return `Sent by ${view.repName} on ${view.sentAt}.${version}${voice}`;
};

/** The outcome of approving several at once, said as the server answered it. */
export interface BulkOutcome {
  readonly approved: string;
  /** One line per report the server did not approve, naming the report and the reason. */
  readonly refused: readonly string[];
}

export const bulkOutcome = (
  decision: BulkDecision,
  nameOf: (id: string) => string,
): BulkOutcome => {
  const decided = decision.results.filter((r) => r.decided).length;
  const refused = decision.results
    .filter((r) => !r.decided)
    .map((r) => `${nameOf(r.id)}: ${decisionRefusal({ message: r.error ?? 'no reason given' })}`);
  const truncated = decision.truncated
    ? ['More reports were ticked than can be approved at once. The rest are still waiting.']
    : [];
  return {
    approved:
      decided === 0
        ? 'No report was approved.'
        : `Approved ${plural(decided, 'report', 'reports')}.`,
    refused: [...refused, ...truncated],
  };
};

/** The line above the table: how many are waiting, and how many are ticked. */
export const selectionLine = (waiting: number, ticked: number): string =>
  ticked === 0
    ? `${plural(waiting, 'report is', 'reports are')} waiting for you.`
    : `${String(ticked)} of ${plural(waiting, 'report', 'reports')} ticked.`;
