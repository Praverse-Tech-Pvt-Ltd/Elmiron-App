import type { ReactNode } from 'react';
import {
  ADVERSE_EVENT_ADMIN_RPC,
  AdverseEventClockSummarySchema,
  AdverseEventListSchema,
  adverseEventListArgs,
} from '@fieldforce/core';
import { signedIn } from '../../lib/session';
import { callerRole } from '../../lib/role';
import {
  Body,
  Card,
  Label,
  MissingNote,
  Page,
  PageHeader,
  Pill,
  RoleNote,
  Stat,
  Stats,
} from '../../lib/ui';
import { btn } from '../../lib/theme-css';
import { indiaDateTime } from '../../lib/india-date';
import {
  NOT_ADMIN_NOTE,
  ROUTING_NOTE,
  adverseRefusal,
  cursorFrom,
  deadline,
  olderHref,
  reporterLabel,
  sourceLabel,
  visitDayLabel,
} from '../../lib/adverse-events-text';

/**
 * `FE-W204` — side-effect flags: the company's adverse-event reports and their statutory clock.
 *
 * **Admin only, and the database is the boundary.** `adverse_event_clock_summary` and
 * `list_adverse_events` refuse anybody but an admin, for the caller's own company only (`BE-W215`),
 * and a refusal is itself audited — so a manager who reaches this address is told whose these are
 * without the page asking a function that would refuse them.
 *
 * The list is an audited read: `READ_REASON` names this screen and is recorded with every page.
 * It carries no reported text — that is read one flag at a time, with a reason the admin types
 * (`/adverse-events/[eventId]`). Newest first, a page at a time, the cursor passed back exactly as
 * the server sent it. Nothing is ranked.
 */
const READ_REASON = 'console side-effect flags screen';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Side-effect flags' };

const header = (
  <PageHeader title="Side-effect flags">
    <Body muted>
      Possible side effects your reps flagged after a visit, and passages the transcript check
      found, newest first. Each one starts a 15-day statutory clock when the server receives it.
      Reading what was reported asks you for a reason, which is kept in the audit log.
    </Body>
  </PageHeader>
);

export default async function AdverseEvents({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly before?: string; readonly beforeId?: string }>;
}): Promise<ReactNode> {
  const session = await signedIn();
  if (session === null) {
    return (
      <MissingNote>
        No session reached the server. Signing in again is the first thing to try.
      </MissingNote>
    );
  }

  const role = await callerRole();
  if (role === 'field_manager' || role === 'mr') {
    return (
      <Page>
        {header}
        <RoleNote>{NOT_ADMIN_NOTE}</RoleNote>
      </Page>
    );
  }

  const params = await searchParams;
  const cursor = cursorFrom(params.before, params.beforeId);
  const [summaryRead, listRead] = await Promise.all([
    session.db.rpc(ADVERSE_EVENT_ADMIN_RPC.clockSummary),
    session.db.rpc(
      ADVERSE_EVENT_ADMIN_RPC.list,
      adverseEventListArgs(READ_REASON, { after: cursor }),
    ),
  ]);

  const refusal = summaryRead.error ?? listRead.error;
  if (refusal !== null) {
    return (
      <Page>
        {header}
        {refusal.code === '42501' ? (
          <RoleNote>{NOT_ADMIN_NOTE}</RoleNote>
        ) : (
          <MissingNote tone="critical">{adverseRefusal(refusal)}</MissingNote>
        )}
      </Page>
    );
  }

  const summary = AdverseEventClockSummarySchema.safeParse(summaryRead.data);
  const list = AdverseEventListSchema.safeParse(listRead.data);
  if (!summary.success || !list.success) {
    return (
      <Page>
        {header}
        <MissingNote tone="critical">
          The flags came back in a shape this console does not recognise, so they are not shown.
        </MissingNote>
      </Page>
    );
  }

  const clock = summary.data;
  const page = list.data;
  const older = olderHref(page);

  return (
    <Page>
      {header}
      <MissingNote>{ROUTING_NOTE}</MissingNote>
      <Stats columns={4}>
        <Stat label="Flags in your company">{clock.total}</Stat>
        <Stat
          label="Past their deadline"
          note={
            clock.overdueCount > 0
              ? 'This console does not record whether a flag was passed on, so a flag stays counted here after its date.'
              : undefined
          }
          tone={clock.overdueCount > 0 ? 'critical' : 'neutral'}
        >
          {clock.overdueCount}
        </Stat>
        <Stat label="Due within 24 hours">{clock.dueWithin24Hours}</Stat>
        <Stat label="Next deadline">
          {clock.nextDueAt === null ? 'None' : indiaDateTime(clock.nextDueAt)}
        </Stat>
      </Stats>

      {page.data.length === 0 ? (
        <MissingNote tone="info">
          {cursor === null
            ? 'No side-effect flag has been raised in your company.'
            : 'There are no older flags.'}
        </MissingNote>
      ) : (
        <Card>
          <table>
            <thead>
              <tr>
                <th>Received</th>
                <th>Flagged by</th>
                <th>Doctor</th>
                <th>Visit</th>
                <th>Deadline</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {page.data.map((row) => {
                const due = deadline(row);
                return (
                  <tr key={row.id}>
                    <td>
                      <div className="ff-cell-stack">
                        <span className="ff-one-line">{indiaDateTime(row.receivedAt)}</span>
                        <a className="ff-one-line" href={`/adverse-events/${row.id}`}>
                          Open the flag
                        </a>
                      </div>
                    </td>
                    <td>{reporterLabel(row)}</td>
                    <td>{row.doctorName}</td>
                    <td className="ff-nowrap">{visitDayLabel(row.visitDate)}</td>
                    <td>
                      <div className="ff-cell-stack">
                        {due.overdue ? (
                          <div className="ff-pills">
                            <Pill tone="critical">Overdue</Pill>
                          </div>
                        ) : null}
                        <span className="ff-one-line">{due.when}</span>
                        {due.left === null ? null : <Label>{due.left}</Label>}
                      </div>
                    </td>
                    <td>{sourceLabel(row.source)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {cursor === null && older === null ? null : (
        <div className="ff-row">
          {cursor === null ? null : (
            <a className={btn('quiet')} href="/adverse-events">
              Newest flags
            </a>
          )}
          {older === null ? null : (
            <a className={btn('secondary')} href={older}>
              Show older
            </a>
          )}
        </div>
      )}
    </Page>
  );
}
