'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { LIVE_TRACKING_RPC } from '@fieldforce/core';
import type { CompanyNoticeVersion } from '@fieldforce/core';
import { browserClient } from './supabase';
import { Body, Card, Heading, Label, MissingNote, Pill } from './ui';
import {
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
import { blankPieces, noticeBlocks } from './notice-blocks';

/**
 * `FE-W91` — the client half of `/tracking/notice`: loading the company's own live location notice,
 * and a SECOND admin approving it. Every rule is the database's: `propose_live_tracking_notice` and
 * `approve_live_tracking_notice` refuse anybody who is not an admin, and the approvals trigger
 * refuses the author whatever this file draws. What is drawn is only the server's answer, in words.
 *
 * `FE-W167`: the notice is laid out as its author wrote it (`notice-blocks.ts`) — headings,
 * paragraphs and lists, with every `[[ … ]]` blank marked — instead of raw Markdown in a pre-wrapped
 * box. A version's text is shown in full only while it waits for approval, where an approver must
 * read it; the version in force and the ones it replaced keep theirs behind "Read the text", so the
 * page does not print the same notice twice. `FE-W165`: no repository path or link in the copy.
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

/** One block's words, with each `[[ … ]]` blank marked so it cannot be read past. */
const Words = ({ text }: { readonly text: string }): ReactNode =>
  blankPieces(text).map((piece, i) =>
    piece.blank ? (
      <mark className="ff-blank" key={i}>
        {piece.text}
      </mark>
    ) : (
      piece.text
    ),
  );

/**
 * The full text, laid out. An approver approving a truncated text did not read it, so nothing is
 * cut: the box scrolls instead.
 */
export const NoticeText = ({ body }: { readonly body: string }): ReactNode => (
  <div className="ff-well ff-notice-text">
    <div className="ff-notice">
      {noticeBlocks(body).map((block, i) =>
        block.kind === 'heading' ? (
          <h3 key={i}>
            <Words text={block.text} />
          </h3>
        ) : block.kind === 'bullets' ? (
          <ul key={i}>
            {block.items.map((item, j) => (
              <li key={j}>
                <Words text={item} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="ff-text" key={i}>
            <Words text={block.text} />
          </p>
        ),
      )}
    </div>
  </div>
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
        Paste your company’s full text, as approved by your legal team. Nobody sees it until a
        second admin approves it. If you start from the built-in draft, fill in every [[ BLANK ]]
        first: each one is a decision for your company to make, not wording to keep.
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
      {version.status === 'waiting' ? (
        <NoticeText body={version.body} />
      ) : (
        <details>
          <summary>Read the text</summary>
          <NoticeText body={version.body} />
        </details>
      )}

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
