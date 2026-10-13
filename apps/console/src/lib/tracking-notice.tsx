'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { LIVE_TRACKING_RPC } from '@fieldforce/core';
import type { CompanyNoticeVersion } from '@fieldforce/core';
import { browserClient } from './supabase';
import { Body, Card, Heading, Label, MissingNote, Pill } from './ui';
import {
  DRAFT_DOC_URL,
  REACCEPT_NOTE,
  approvalAffordance,
  attestationProblem,
  blankWarning,
  noticeRefusal,
  proposalProblem,
  statusLabel,
  statusTone,
  when,
} from './tracking-notice-text';
import { btn } from './theme-css';

/**
 * `FE-W91` — the client half of `/tracking/notice`: loading the company's own live location notice,
 * and a SECOND admin approving it. Every rule is the database's: `propose_live_tracking_notice` and
 * `approve_live_tracking_notice` refuse anybody who is not an admin, and the approvals trigger
 * refuses the author whatever this file draws. What is drawn is only the server's answer, in words.
 */
type Outcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'done'; readonly message: string }
  | { readonly kind: 'refused'; readonly message: string };

const OutcomeNote = ({ outcome }: { readonly outcome: Outcome }): ReactNode =>
  outcome.kind === 'done' ? (
    <MissingNote tone="info">{outcome.message}</MissingNote>
  ) : outcome.kind === 'refused' ? (
    <MissingNote tone="critical">{outcome.message}</MissingNote>
  ) : null;

/** The full text, with its line breaks. An approver approving a truncated text did not read it. */
export const NoticeText = ({ body }: { readonly body: string }): ReactNode => (
  <div className="ff-well ff-prewrap ff-notice-text">{body}</div>
);

export const ProposeNotice = (): ReactNode => {
  const router = useRouter();
  const [label, setLabel] = useState('');
  const [body, setBody] = useState('');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const problem = proposalProblem(label, body);
  const warning = blankWarning(body);
  const busy = outcome.kind === 'busy';

  const load = (): void => {
    setOutcome({ kind: 'busy' });
    void browserClient()
      .rpc(LIVE_TRACKING_RPC.proposeNotice, { p_version_label: label.trim(), p_body: body.trim() })
      .then(({ error }) => {
        if (error !== null) {
          setOutcome({ kind: 'refused', message: noticeRefusal(error) });
          return;
        }
        setOutcome({
          kind: 'done',
          message: `Loaded “${label.trim()}”. It is not shown to anybody until a second admin approves it.`,
        });
        setLabel('');
        setBody('');
        router.refresh();
      });
  };

  return (
    <Card>
      <Heading>Load a new version</Heading>
      <Body muted>
        Paste your company’s full, approved-by-legal text. It is shown to nobody until a second
        admin approves it. The engineering draft is{' '}
        <a href={DRAFT_DOC_URL} rel="noopener noreferrer" target="_blank">
          docs/operator/live-tracking-notice-DRAFT.md
        </a>{' '}
        — its [[ BLANK ]] items are decisions for your company to fill, not wording.
      </Body>
      <Label>Version label</Label>
      <input
        aria-label="Version label"
        maxLength={80}
        placeholder="for example: v1 — October 2026"
        value={label}
        onChange={(e) => {
          setLabel(e.target.value);
        }}
      />
      <Label>The full text reps will read</Label>
      <textarea
        aria-label="Notice text"
        rows={12}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
        }}
      />
      {(label !== '' || body !== '') && problem !== null ? <Body muted>{problem}</Body> : null}
      {warning === null ? null : <MissingNote>{warning}</MissingNote>}
      <div>
        <button
          className={btn('primary')}
          disabled={problem !== null || busy}
          type="button"
          onClick={load}
        >
          {busy ? 'Loading…' : 'Load this version'}
        </button>
      </div>
      <OutcomeNote outcome={outcome} />
    </Card>
  );
};

export const NoticeVersionCard = ({
  version,
}: {
  readonly version: CompanyNoticeVersion;
}): ReactNode => {
  const router = useRouter();
  const [attestation, setAttestation] = useState('');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const affordance = approvalAffordance(version);
  const problem = attestationProblem(attestation);
  const busy = outcome.kind === 'busy';

  const approve = (): void => {
    setOutcome({ kind: 'busy' });
    void browserClient()
      .rpc(LIVE_TRACKING_RPC.approveNotice, {
        p_notice_version_id: version.id,
        p_attestation: attestation.trim(),
      })
      .then(({ error }) => {
        if (error !== null) {
          setOutcome({ kind: 'refused', message: noticeRefusal(error) });
          return;
        }
        setOutcome({
          kind: 'done',
          message: `Approved. “${version.versionLabel}” is now in force; every rep must accept it again.`,
        });
        router.refresh();
      });
  };

  return (
    <Card>
      <div className="ff-row">
        <Heading>{version.versionLabel}</Heading>
        <Pill tone={statusTone(version.status)}>{statusLabel(version.status)}</Pill>
      </div>
      <Body muted>
        Loaded by {version.authoredByYou ? 'you' : (version.authorName ?? 'an admin')} on{' '}
        {when(version.createdAt)}.
        {version.approvedAt === null
          ? ''
          : ` Approved by ${version.approverName ?? 'an admin'} on ${when(version.approvedAt)}${
              version.attestation === null ? '.' : ` — “${version.attestation}”.`
            }`}
      </Body>
      <NoticeText body={version.body} />

      {affordance.kind === 'waiting_for_another' ? (
        <MissingNote>{affordance.reason}</MissingNote>
      ) : null}
      {affordance.kind === 'may_approve' && outcome.kind !== 'done' ? (
        <>
          <MissingNote>{REACCEPT_NOTE}</MissingNote>
          <Label>What you checked — required to approve, and kept</Label>
          <input
            aria-label={`What you checked in ${version.versionLabel}`}
            maxLength={500}
            value={attestation}
            onChange={(e) => {
              setAttestation(e.target.value);
            }}
          />
          <div>
            <button
              className={btn('primary')}
              disabled={problem !== null || busy}
              type="button"
              onClick={approve}
            >
              {busy ? 'Approving…' : `Approve ${version.versionLabel}`}
            </button>
          </div>
        </>
      ) : null}
      <OutcomeNote outcome={outcome} />
    </Card>
  );
};
