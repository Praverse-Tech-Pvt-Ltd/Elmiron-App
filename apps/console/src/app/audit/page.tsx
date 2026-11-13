import type { ReactNode } from 'react';
import { ADMIN_RPC, AUDIT_ACTIONS, AuditSearchSchema } from '@fieldforce/core';
import { signedIn } from '../../lib/session';
import { callerRole } from '../../lib/role';
import { Body, Card, Label, MissingNote, Page, PageHeader, Pill, RoleNote } from '../../lib/ui';
import { adminRefusal, dayAfterStart, dayStart } from '../../lib/admin-text';
import { auditQuery, readAuditFilters } from '../../lib/audit-filters';
import { systemRowsNote } from '../../lib/audit';
import { indiaDateTime } from '../../lib/india-date';
import { actionLabel, auditWhat, reasonLabel, tableLabel, whoLabel } from '../../lib/labels';
import { btn } from '../../lib/theme-css';

/**
 * `FE-W77` — the audit log, read-only: filtered by who, by table and action, by date, a page at a
 * time. Rendered on the server from the URL, so a filtered view is a link an auditor can keep.
 *
 * `search_audit_log` is admin-only, company-scoped and audited: every page view writes a row with the
 * reason below, so who read the trail is in the trail. A refusal is shown as a refusal, never as an
 * empty table (the same rule as the compliance panel's `audit.ts`).
 *
 * `FE-W165`: the rows are in words — "Created · AI request" by "Asha Patil · Admin", the console's
 * own reasons as the screen that was opened — and the filters say the same words while still
 * sending the stored values (`user_profiles`, `insert`), so a kept link is unchanged.
 * `FE-W164`: a manager is told the log is an admin's, once, without the filter form they could not
 * use.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Audit log' };

const READ_REASON = 'console audit log screen';
const PAGE = 50;

const ONLY_ADMINS =
  'Only an admin reads the audit log. It records every change in your company, and every read of someone else’s record.';

const header = (
  <PageHeader title="Audit log">
    <Body muted>
      Every change to a record, and every read of someone else’s, by a person in your company —
      newest first. Reading this page is itself recorded here. Times are India time.
    </Body>
  </PageHeader>
);

export default async function AuditPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
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
  if (role !== null && role !== 'admin') {
    return (
      <Page>
        {header}
        <RoleNote>{ONLY_ADMINS}</RoleNote>
      </Page>
    );
  }

  const filters = readAuditFilters(await searchParams);
  const [result, people] = await Promise.all([
    session.db.rpc(ADMIN_RPC.searchAuditLog, {
      p_reason: READ_REASON,
      p_limit: PAGE,
      p_before_id: filters.before,
      p_actor_id: filters.actor,
      p_table_name: filters.table,
      p_action: filters.action,
      p_from: filters.from === null ? null : dayStart(filters.from),
      p_until: filters.until === null ? null : dayAfterStart(filters.until),
      p_include_refused: filters.refused,
    }),
    session.db.from('user_profiles').select('id, full_name').order('full_name'),
  ]);

  if (result.error !== null && result.error.code === '42501') {
    return (
      <Page>
        {header}
        <RoleNote>{ONLY_ADMINS}</RoleNote>
      </Page>
    );
  }

  const page = result.error === null ? AuditSearchSchema.safeParse(result.data) : null;
  const tables = [...(page?.success === true ? page.data.tables : [])].sort((a, b) =>
    tableLabel(a).localeCompare(tableLabel(b)),
  );
  const hidden = page?.success === true ? systemRowsNote(page.data.systemRowsHidden) : null;

  return (
    <Page>
      {header}

      <Card>
        <form className="ff-filters" method="get">
          <div className="ff-field">
            <Label>Who</Label>
            <select name="actor" aria-label="Who" defaultValue={filters.actor ?? ''}>
              <option value="">Anyone</option>
              {(people.data ?? []).map((p) => (
                <option key={String(p.id)} value={String(p.id)}>
                  {String(p.full_name)}
                </option>
              ))}
            </select>
          </div>
          <div className="ff-field">
            <Label>Record type</Label>
            <select name="table" aria-label="Record type" defaultValue={filters.table ?? ''}>
              <option value="">Any</option>
              {tables.map((t) => (
                <option key={t} value={t}>
                  {tableLabel(t)}
                </option>
              ))}
            </select>
          </div>
          <div className="ff-field">
            <Label>Action</Label>
            <select name="action" aria-label="Action" defaultValue={filters.action ?? ''}>
              <option value="">Any</option>
              {AUDIT_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {actionLabel(a)}
                </option>
              ))}
            </select>
          </div>
          <div className="ff-field">
            <Label>From</Label>
            <input name="from" aria-label="From" type="date" defaultValue={filters.from ?? ''} />
          </div>
          <div className="ff-field">
            <Label>Until (inclusive)</Label>
            <input name="until" aria-label="Until" type="date" defaultValue={filters.until ?? ''} />
          </div>
          <label>
            <input type="checkbox" name="refused" value="1" defaultChecked={filters.refused} />{' '}
            Include refused reads
          </label>
          <button type="submit" className={btn('primary')}>
            Show
          </button>
          <a href="/audit" className={btn('quiet')}>
            Clear
          </a>
        </form>
      </Card>

      {result.error !== null ? (
        <MissingNote tone="critical">{adminRefusal(result.error)}</MissingNote>
      ) : page === null || !page.success ? (
        <MissingNote tone="critical">
          The audit log came back in a shape this console does not recognise, so it is not shown.
        </MissingNote>
      ) : (
        <>
          {page.data.data.length === 0 ? (
            <Body muted>
              No entries match. The filters above are the only reason this is empty.
            </Body>
          ) : (
            <Card>
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>What</th>
                    <th>Record</th>
                    <th>Reason given</th>
                  </tr>
                </thead>
                <tbody>
                  {page.data.data.map((row) => (
                    <tr key={row.id}>
                      <td className="ff-nowrap">{indiaDateTime(row.occurredAt)}</td>
                      <td>{whoLabel(row.actorName, row.actorRole)}</td>
                      <td>
                        {auditWhat(row.action, row.tableName)}{' '}
                        {row.refused ? <Pill tone="critical">Refused</Pill> : null}
                      </td>
                      {/*
                        The record's id, shortened: enough to tell two records apart in a list,
                        and the whole id is there on hover for anyone who must match it.
                      */}
                      <td className="ff-mono" title={row.rowId ?? undefined}>
                        {row.rowId === null ? '—' : row.rowId.slice(0, 8)}
                      </td>
                      <td>{reasonLabel(row.reason) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          <div className="ff-row">
            {filters.before === null ? null : (
              <a className={btn('secondary')} href={auditQuery({ ...filters, before: null })}>
                Newest
              </a>
            )}
            {page.data.nextBeforeId === null ? (
              <Body muted>That is the oldest matching entry.</Body>
            ) : (
              <a
                className={btn('secondary')}
                href={auditQuery({ ...filters, before: page.data.nextBeforeId })}
              >
                Older
              </a>
            )}
          </div>
          {hidden === null ? null : <Body muted>{hidden}</Body>}
        </>
      )}
    </Page>
  );
}
