import type { ReactNode } from 'react';
import { signedIn } from '../../../lib/session';
import { callerRole } from '../../../lib/role';
import {
  Body,
  Card,
  Heading,
  MissingNote,
  Page,
  PageHeader,
  Pill,
  RoleNote,
} from '../../../lib/ui';
import { parseCallReport } from '../../../lib/manager-rows';
import { decisionLine, reportView, sentLine } from '../../../lib/call-reports-text';
import { reportLookups } from '../../../lib/call-report-reads';
import { CallReportDecision } from '../../../lib/call-report-decision';

/**
 * `FE-W201` — one call report, in full, and the decision on it.
 *
 * The report is read from `call_report_current` as the signed-in user: the `call_reports` policy is
 * the scope (the view is `security_invoker`), so a report outside the caller's team does not come
 * back, and the page says so rather than guessing. The decision is `approve_call_report`, which
 * checks again; the controls are shown only while the report waits for one.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Call report' };

const STATUS_TONE: Readonly<Record<string, 'success' | 'neutral' | 'attention'>> = {
  approved: 'success',
  rejected: 'neutral',
  submitted: 'attention',
  draft: 'neutral',
};

const STATUS_WORD: Readonly<Record<string, string>> = {
  approved: 'Approved',
  rejected: 'Not approved',
  submitted: 'Waiting for you',
  draft: 'Not sent yet',
};

const Section = ({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactNode => (
  <Card>
    <Heading>{title}</Heading>
    {children}
  </Card>
);

export default async function CallReport({
  params,
}: {
  readonly params: Promise<{ readonly reportId: string }>;
}): Promise<ReactNode> {
  const { reportId } = await params;
  const session = await signedIn();
  if (session === null) {
    return (
      <MissingNote>
        No session reached the server. Signing in again is the first thing to try.
      </MissingNote>
    );
  }

  const role = await callerRole();
  if (role === 'mr') {
    return (
      <Page width="narrow">
        <PageHeader title="Call report" />
        <RoleNote>
          Reps send call reports from the app. A field manager or an admin approves them here.
        </RoleNote>
      </Page>
    );
  }

  const read = /^[0-9a-f-]{36}$/iu.test(reportId)
    ? await session.db.from('call_report_current').select('*').eq('id', reportId).maybeSingle()
    : null;
  const row = read === null || read.error !== null ? null : parseCallReport(read.data);
  if (row === null) {
    return (
      <Page width="narrow">
        <PageHeader title="Call report" />
        <MissingNote tone="critical">
          This report could not be shown. It may be from a rep outside your team, or the rep may
          have replaced it with a newer version. <a href="/reports">Back to call reports</a>
        </MissingNote>
      </Page>
    );
  }

  const [lookups, approval] = await Promise.all([
    reportLookups(session.db, [row]),
    // The reason kept with the latest decision, read under `call_report_approvals_select_scope`.
    row.decidedAt === null
      ? null
      : session.db
          .from('call_report_approvals')
          .select('reason')
          .eq('call_report_id', row.id)
          .order('decided_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
  ]);
  const view = reportView(row, lookups);
  const reason = (approval?.data as { reason?: string | null } | null)?.reason ?? null;
  const title = view.visitDay === null ? view.doctorName : `${view.doctorName} · ${view.visitDay}`;

  return (
    <Page>
      <div className="ff-split">
        <div className="ff-split-main">
          <PageHeader eyebrow={view.repName} title={title}>
            <Body muted>{sentLine(view)}</Body>
            <div className="ff-pills">
              <Pill tone={STATUS_TONE[view.effectiveStatus] ?? 'neutral'}>
                {STATUS_WORD[view.effectiveStatus] ?? 'Unknown'}
              </Pill>
            </div>
          </PageHeader>

          <Section title="What was discussed">
            <Body>
              <span className="ff-prewrap">{view.summary}</span>
            </Body>
          </Section>

          <Section title="Products discussed">
            {view.products.length === 0 ? (
              <Body muted>No product was recorded for this visit.</Body>
            ) : (
              <ul className="ff-plain-list">
                {view.products.map((name, i) => (
                  <li key={`${name}-${String(i)}`}>{name}</li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Objections the doctor raised">
            {view.objections === null ? (
              <Body muted>None recorded.</Body>
            ) : (
              <Body>
                <span className="ff-prewrap">{view.objections}</span>
              </Body>
            )}
          </Section>

          <Section title="Next step">
            {view.nextStep === null ? (
              <Body muted>None recorded.</Body>
            ) : (
              <Body>
                <span className="ff-prewrap">{view.nextStep}</span>
              </Body>
            )}
          </Section>
        </div>

        <div className="ff-split-side">
          {view.effectiveStatus === 'submitted' ? (
            <CallReportDecision reportId={view.id} />
          ) : (
            <Card>
              <Heading>Decision</Heading>
              <Body>{decisionLine(view)}</Body>
              {reason === null || reason.trim() === '' ? null : (
                <Body muted>Reason given: {reason}</Body>
              )}
            </Card>
          )}
          <Body>
            <a href="/reports">Back to call reports</a>
          </Body>
        </div>
      </div>
    </Page>
  );
}
