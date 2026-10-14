'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { browserClient } from './supabase';
import { Card, Label, MissingNote } from './ui';
import { btn } from './theme-css';
import { plural } from './plural';
import { MANAGER_RPC, parseBulkDecision } from './manager-rows';
import {
  bulkOutcome,
  decisionRefusal,
  preview,
  reportName,
  selectionLine,
} from './call-reports-text';
import type { CallReportView } from './call-reports-text';

/**
 * `FE-W200` — the client half of `/reports`: tick, approve, and say what the server answered.
 *
 * The browser sends report ids; `approve_call_report` and `approve_call_reports_bulk` decide, as the
 * signed-in user, whether each may be approved — in scope, sent, current, not the caller's own. The
 * list is then refreshed from the server (`router.refresh()`), never patched here, so a report the
 * server did not approve stays on the screen and the reason is shown beside the outcome.
 *
 * **Rows keep the server's order**, oldest first. Nothing here sorts, counts or compares reps.
 */

type Outcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy'; readonly ids: readonly string[] }
  | { readonly kind: 'done'; readonly message: string; readonly refused: readonly string[] }
  | { readonly kind: 'refused'; readonly message: string };

const Say = ({ outcome }: { readonly outcome: Outcome }): ReactNode => {
  if (outcome.kind === 'refused')
    return <MissingNote tone="critical">{outcome.message}</MissingNote>;
  if (outcome.kind !== 'done') return null;
  return (
    <>
      <MissingNote tone="info">{outcome.message}</MissingNote>
      {outcome.refused.length === 0 ? null : (
        <MissingNote tone="critical">
          <div className="ff-stack ff-stack-sm">
            <span>
              {outcome.refused.length === 1
                ? 'One report was not approved:'
                : `${String(outcome.refused.length)} reports were not approved:`}
            </span>
            <ul className="ff-plain-list">
              {outcome.refused.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </MissingNote>
      )}
    </>
  );
};

export const CallReportQueue = ({
  reports,
}: {
  readonly reports: readonly CallReportView[];
}): ReactNode => {
  const router = useRouter();
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });

  // A report that has left the list (approved here, or elsewhere) is no longer ticked.
  const chosen = reports.filter((r) => ticked.has(r.id));
  const busy = outcome.kind === 'busy';
  const everyTicked = reports.length > 0 && chosen.length === reports.length;
  const nameOf = (id: string): string => {
    const view = reports.find((r) => r.id === id);
    return view === undefined ? 'A report' : reportName(view);
  };

  const tick = (id: string, on: boolean): void => {
    const next = new Set(ticked);
    if (on) next.add(id);
    else next.delete(id);
    setTicked(next);
  };

  const approveOne = (view: CallReportView): void => {
    setOutcome({ kind: 'busy', ids: [view.id] });
    void browserClient()
      .rpc(MANAGER_RPC.approveCallReport, {
        p_call_report_id: view.id,
        p_approved: true,
        p_reason: null,
      })
      .then(({ error }) => {
        if (error !== null) {
          setOutcome({
            kind: 'refused',
            message: `${reportName(view)}: ${decisionRefusal(error)}`,
          });
          return;
        }
        tick(view.id, false);
        setOutcome({
          kind: 'done',
          message: `Approved the report from ${view.repName} on ${view.doctorName}.`,
          refused: [],
        });
        router.refresh();
      });
  };

  const approveTicked = (): void => {
    const ids = chosen.map((r) => r.id);
    if (ids.length === 0) return;
    setOutcome({ kind: 'busy', ids });
    void browserClient()
      .rpc(MANAGER_RPC.approveCallReportsBulk, {
        p_call_report_ids: ids,
        p_approved: true,
        p_reason: null,
      })
      .then(({ data, error }) => {
        if (error !== null) {
          setOutcome({ kind: 'refused', message: decisionRefusal(error) });
          return;
        }
        const decision = parseBulkDecision(data);
        if (decision === null) {
          setOutcome({
            kind: 'refused',
            message:
              'The server answered in a shape this console does not recognise. Reload the page to see which reports were approved.',
          });
          router.refresh();
          return;
        }
        const said = bulkOutcome(decision, nameOf);
        setTicked(new Set());
        setOutcome({ kind: 'done', message: said.approved, refused: said.refused });
        router.refresh();
      });
  };

  return (
    <Card>
      <div className="ff-row">
        <button
          className={btn('primary')}
          disabled={chosen.length === 0 || busy}
          onClick={approveTicked}
          type="button"
        >
          {busy && outcome.ids.length > 1
            ? 'Approving…'
            : chosen.length === 0
              ? 'Approve ticked reports'
              : `Approve ${plural(chosen.length, 'report', 'reports')}`}
        </button>
        <span className="ff-muted">{selectionLine(reports.length, chosen.length)}</span>
      </div>
      <Say outcome={outcome} />
      <table>
        <thead>
          <tr>
            <th className="ff-check">
              <input
                aria-label="Tick every report"
                checked={everyTicked}
                disabled={busy}
                onChange={(e) => {
                  setTicked(e.target.checked ? new Set(reports.map((r) => r.id)) : new Set());
                }}
                type="checkbox"
              />
            </th>
            <th>Rep</th>
            <th>Visit</th>
            <th className="ff-w-md">What was discussed</th>
            <th>Products</th>
            <th>Next step</th>
            <th>
              <span className="ff-visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {reports.map((view) => (
            <tr key={view.id}>
              <td className="ff-check">
                <input
                  aria-label={`Tick the report from ${view.repName} on ${view.doctorName}`}
                  checked={ticked.has(view.id)}
                  disabled={busy}
                  onChange={(e) => {
                    tick(view.id, e.target.checked);
                  }}
                  type="checkbox"
                />
              </td>
              <td>
                <div className="ff-cell-stack">
                  <span className="ff-strong">{view.repName}</span>
                  <Label>Sent {view.sentAt}</Label>
                </div>
              </td>
              <td>
                <div className="ff-cell-stack">
                  <span>{view.doctorName}</span>
                  <Label>{view.visitDay ?? 'Visit date not available'}</Label>
                </div>
              </td>
              <td className="ff-cell-prose">
                <div className="ff-cell-stack">
                  <span>{preview(view.summary)}</span>
                  {view.version > 1 ? <Label>Version {String(view.version)}</Label> : null}
                  <a className="ff-one-line" href={`/reports/${view.id}`}>
                    Read in full
                  </a>
                </div>
              </td>
              <td>
                {view.products.length === 0 ? (
                  <span className="ff-muted">None recorded</span>
                ) : (
                  view.products.join(', ')
                )}
              </td>
              <td>{view.nextStep ?? <span className="ff-muted">None recorded</span>}</td>
              <td>
                <button
                  className={btn('secondary')}
                  disabled={busy}
                  onClick={() => {
                    approveOne(view);
                  }}
                  type="button"
                >
                  {busy && outcome.ids.length === 1 && outcome.ids[0] === view.id
                    ? 'Approving…'
                    : 'Approve'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
};
