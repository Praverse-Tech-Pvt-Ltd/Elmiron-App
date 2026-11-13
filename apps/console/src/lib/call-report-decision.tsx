'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { browserClient } from './supabase';
import { Body, Card, Heading, MissingNote } from './ui';
import { btn } from './theme-css';
import { MANAGER_RPC } from './manager-rows';
import { decisionRefusal } from './call-reports-text';

/**
 * `FE-W201` — approve one call report, or decide not to, with a reason.
 *
 * Both are `approve_call_report` as the signed-in user; not approving is the same function with
 * `p_approved` false, and the reason is kept with the decision. The database decides whether the
 * caller may decide this report at all; the page is refreshed from the server afterwards, so what it
 * then shows is the decision the server recorded, not one this component assumed.
 *
 * **The rep is not told in the app.** Decisions are not part of what the app downloads, so the copy
 * says so rather than implying a notification that does not happen.
 */

type Outcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy'; readonly approving: boolean }
  | { readonly kind: 'refused'; readonly message: string };

const REASON_MIN = 3;

export const CallReportDecision = ({ reportId }: { readonly reportId: string }): ReactNode => {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const busy = outcome.kind === 'busy';

  const decide = (approved: boolean): void => {
    setOutcome({ kind: 'busy', approving: approved });
    void browserClient()
      .rpc(MANAGER_RPC.approveCallReport, {
        p_call_report_id: reportId,
        p_approved: approved,
        p_reason: approved ? null : reason.trim(),
      })
      .then(({ error }) => {
        if (error !== null) {
          setOutcome({ kind: 'refused', message: decisionRefusal(error) });
          return;
        }
        setReason('');
        setOutcome({ kind: 'idle' });
        router.refresh();
      });
  };

  return (
    <Card>
      <Heading>Your decision</Heading>
      <Body muted>
        Approve the report if it is a fair record of the visit. If it is not, say why and record it
        as not approved; your reason is kept with the report. The app does not show the rep your
        decision, so tell them yourself if they need to act on it.
      </Body>
      <div className="ff-row">
        <button
          className={btn('primary')}
          disabled={busy}
          onClick={() => {
            decide(true);
          }}
          type="button"
        >
          {busy && outcome.approving ? 'Approving…' : 'Approve'}
        </button>
      </div>
      <label className="ff-label" htmlFor="report-reason">
        Why it is not approved
      </label>
      <textarea
        id="report-reason"
        onChange={(e) => {
          setReason(e.target.value);
        }}
        placeholder="For example: the products discussed are missing"
        value={reason}
      />
      <button
        className={btn('danger')}
        disabled={busy || reason.trim().length < REASON_MIN}
        onClick={() => {
          decide(false);
        }}
        type="button"
      >
        {busy && !outcome.approving ? 'Recording…' : 'Do not approve'}
      </button>
      {outcome.kind === 'refused' ? (
        <MissingNote tone="critical">{outcome.message}</MissingNote>
      ) : null}
    </Card>
  );
};
