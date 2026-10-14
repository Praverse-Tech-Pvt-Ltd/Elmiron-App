import type { ReactNode } from 'react';
import { signedIn } from '../../lib/session';
import { callerRole } from '../../lib/role';
import { Body, MissingNote, Page, PageHeader, RoleNote } from '../../lib/ui';
import { MANAGER_RPC, parseAll, parseCallReport } from '../../lib/manager-rows';
import { queueRefusal, reportView } from '../../lib/call-reports-text';
import { reportLookups } from '../../lib/call-report-reads';
import { CallReportQueue } from '../../lib/call-reports';
import { plural } from '../../lib/plural';

/**
 * `FE-W200` — call reports waiting for the signed-in manager's (or admin's) approval.
 *
 * **Nothing here decides which reports are the caller's to decide.** `approvable_call_reports`
 * returns what the caller may decide — sent, current, written by a rep in their view, never their
 * own — and `approve_call_report` checks every one again when it is approved. A rep who opens the
 * page is told it is not theirs, without asking a function that would answer with nothing.
 *
 * No audit reason is sent: neither function takes one, and the names beside each report are plain
 * reads under the tables' own policies (`call-report-reads.ts`). **No ranking**: reports are in the
 * server's order, oldest first.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Call reports' };

/** The most a page lists; it is also the most `approve_call_reports_bulk` decides in one call. */
const LIMIT = 200;

export default async function CallReports(): Promise<ReactNode> {
  const session = await signedIn();
  if (session === null) {
    return (
      <MissingNote>
        No session reached the server. Signing in again is the first thing to try.
      </MissingNote>
    );
  }

  const role = await callerRole();
  const header = (
    <PageHeader title="Call reports">
      <Body muted>
        Reports your reps sent after their visits, waiting for your approval, oldest first. Read one
        in full before you decide, approve it here, or tick several and approve them together.
      </Body>
    </PageHeader>
  );

  if (role === 'mr') {
    return (
      <Page>
        {header}
        <RoleNote>
          Reps send call reports from the app. A field manager or an admin approves them here.
        </RoleNote>
      </Page>
    );
  }

  const result = await session.db.rpc(MANAGER_RPC.approvableCallReports, { p_limit: LIMIT });
  if (result.error !== null) {
    return (
      <Page>
        {header}
        <MissingNote tone="critical">{queueRefusal(result.error)}</MissingNote>
      </Page>
    );
  }

  const rows = parseAll(result.data, parseCallReport);
  if (rows === null) {
    return (
      <Page>
        {header}
        <MissingNote tone="critical">
          The reports came back in a shape this console does not recognise, so they are not shown.
        </MissingNote>
      </Page>
    );
  }

  if (rows.length === 0) {
    return (
      <Page>
        {header}
        <MissingNote tone="info">Nothing is waiting for your approval.</MissingNote>
      </Page>
    );
  }

  const lookups = await reportLookups(session.db, rows);
  const reports = rows.map((row) => reportView(row, lookups));

  return (
    <Page>
      {header}
      {rows.length >= LIMIT ? (
        <MissingNote tone="info">
          These are the oldest {plural(LIMIT, 'report', 'reports')} waiting for you. When you have
          decided them, the next ones appear.
        </MissingNote>
      ) : null}
      <CallReportQueue reports={reports} />
    </Page>
  );
}
