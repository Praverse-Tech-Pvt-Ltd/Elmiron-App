import type { ReactNode } from 'react';
import { ADMIN_RPC, AUDIT_ACTIONS, AuditSearchSchema } from '@fieldforce/core';
import { tokens } from '@fieldforce/ui-tokens';
import { signedIn } from '../../lib/session';
import { Body, Card, Label, MissingNote, Pill, Title, cell, headerCell } from '../../lib/ui';
import { adminRefusal, dayAfterStart, dayStart } from '../../lib/admin-text';
import { auditQuery, readAuditFilters } from '../../lib/audit-filters';
import { btn } from '../../lib/theme-css';

/**
 * `FE-W77` — the audit log, read-only: filtered by who, by table and action, by date, a page at a
 * time. Rendered on the server from the URL, so a filtered view is a link an auditor can keep.
 *
 * `search_audit_log` is admin-only, company-scoped and audited: every page view writes a row with the
 * reason below, so who read the trail is in the trail. A refusal is shown as a refusal, never as an
 * empty table (the same rule as the compliance panel's `audit.ts`).
 */
export const dynamic = 'force-dynamic';

const READ_REASON = 'console audit log screen';
const PAGE = 50;

const dateTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'medium',
  });

const field = {
  padding: tokens.space.sm,
  border: `1px solid ${tokens.color.border}`,
  borderRadius: tokens.radius.control,
  fontFamily: 'inherit',
};

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

  const page = result.error === null ? AuditSearchSchema.safeParse(result.data) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.lg, maxWidth: 1320 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.xs }}>
        <Title>Audit log</Title>
        <Body muted>
          Every change to a record, and every read of someone else’s, by a person in your company —
          newest first. Reading this page is itself recorded here. Times are India time.
        </Body>
      </div>

      <Card>
        <form
          method="get"
          style={{
            display: 'flex',
            gap: tokens.space.md,
            flexWrap: 'wrap',
            alignItems: 'flex-end',
          }}
        >
          <div>
            <Label>Who</Label>
            <select name="actor" aria-label="Who" defaultValue={filters.actor ?? ''} style={field}>
              <option value="">Anyone</option>
              {(people.data ?? []).map((p) => (
                <option key={String(p.id)} value={String(p.id)}>
                  {String(p.full_name)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Table</Label>
            <select
              name="table"
              aria-label="Table"
              defaultValue={filters.table ?? ''}
              style={field}
            >
              <option value="">Any</option>
              {(page?.success === true ? page.data.tables : []).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Action</Label>
            <select
              name="action"
              aria-label="Action"
              defaultValue={filters.action ?? ''}
              style={field}
            >
              <option value="">Any</option>
              {AUDIT_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a === 'select' ? 'read' : a}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>From</Label>
            <input
              name="from"
              aria-label="From"
              type="date"
              defaultValue={filters.from ?? ''}
              style={field}
            />
          </div>
          <div>
            <Label>Until (inclusive)</Label>
            <input
              name="until"
              aria-label="Until"
              type="date"
              defaultValue={filters.until ?? ''}
              style={field}
            />
          </div>
          <label style={{ display: 'flex', gap: tokens.space.xs, alignItems: 'center' }}>
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
        <MissingNote tone="critical">
          {result.error.code === '42501'
            ? 'Only an admin reads the audit log. This refusal is itself recorded in it.'
            : adminRefusal(result.error)}
        </MissingNote>
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
            <table className="ff-table" style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={headerCell}>When</th>
                  <th style={headerCell}>Who</th>
                  <th style={headerCell}>What</th>
                  <th style={headerCell}>Record</th>
                  <th style={headerCell}>Reason given</th>
                </tr>
              </thead>
              <tbody>
                {page.data.data.map((row) => (
                  <tr key={row.id}>
                    <td style={{ ...cell, whiteSpace: 'nowrap' }}>{dateTime(row.occurredAt)}</td>
                    <td style={cell}>
                      {row.actorName}
                      {row.actorRole === null ? '' : ` (${row.actorRole})`}
                    </td>
                    <td style={cell}>
                      {row.action === 'select' ? 'read' : row.action} {row.tableName}{' '}
                      {row.refused ? <Pill tone="critical">refused</Pill> : null}
                    </td>
                    <td style={{ ...cell, fontFamily: 'ui-monospace, monospace' }}>
                      {row.rowId ?? '—'}
                    </td>
                    <td style={cell}>{row.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ display: 'flex', gap: tokens.space.md, alignItems: 'center' }}>
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
          {page.data.systemRowsHidden > 0 ? (
            <Body muted>
              {String(page.data.systemRowsHidden)} entries written by the system itself (no person)
              belong to no company and are not shown to any.
            </Body>
          ) : null}
        </>
      )}
    </div>
  );
}
