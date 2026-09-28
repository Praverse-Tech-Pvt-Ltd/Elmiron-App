'use client';

import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { KnowledgeDocumentVersion } from '@fieldforce/core';
import { compactTypography, tokens } from '@fieldforce/ui-tokens';
import { Body, Card, Heading, Label, MissingNote, Pill } from './ui';

/**
 * W1-A E3 — the screen the operator actually uses to review and approve a draft.
 *
 * **Why this screen exists at all.** `C23` (28 September 2026) permits AI-generated text to be used
 * extensively in the LMS as draft knowledge, and `C25` names the operator as the approver. Those two
 * together are the most dangerous permission in this release: without a screen, the only way to
 * approve is a hand-written SQL call, and the four-eyes attestation becomes a string somebody typed
 * into a terminal. This is the screen that makes `C23` safe rather than merely permitted.
 *
 * **THE SERVER IS THE CONTROL. This component draws; it does not decide.**
 *
 * `approve_knowledge_version` refuses `42501` if the caller wrote or submitted the version, and
 * `22023` if the attestation is empty. Every one of those refusals still happens whatever this file
 * does. What `approvalAffordance` below decides is only whether to DRAW the control, and that is a
 * legibility choice the contract explicitly asks for (`docs/ai-platform/api-contracts.md`, §5):
 *
 *   "show the approve button to an admin only when they are neither `createdByUserId` nor
 *    `submittedByUserId` — the server refuses otherwise, and a button that always fails for the
 *    author is a worse screen than no button. The server is still the control."
 *
 * The distinction matters and is easy to get wrong: **hiding a control is not enforcement, and this
 * file must never be cited as the thing that enforces four eyes.** It is the thing that explains,
 * before the click, why a control is absent — which is the only part a database cannot do.
 *
 * **E4 — the product-claim caution, rendered.** `C23` permits AI-generated TRAINING text. Product
 * claims, indications and prescribing information are regulated promotional content and must come
 * from the client (`#7`). Code cannot tell those apart. So the screen shows the reviewer the two
 * facts that let a HUMAN tell them apart — **which market and which product this draft claims to be
 * about** — and says so in words when the draft is machine-written. A draft that names a product is
 * a draft that has walked toward regulated content, and the reviewer sees that before approving.
 */

/** What the reviewer is allowed to see happen, and why, when they cannot approve. */
export type ApprovalAffordance =
  { readonly kind: 'may_decide' } | { readonly kind: 'hidden'; readonly reason: string };

export const FOUR_EYES_AUTHOR_NOTE =
  'You drafted this version, so you cannot approve it. Four eyes: a second admin must review it. ' +
  'The server refuses an author’s own approval whatever this screen shows.';

export const FOUR_EYES_SUBMITTER_NOTE =
  'You submitted this version for review, so you cannot approve it. Four eyes: a second admin ' +
  'must decide. The server refuses this whatever this screen shows.';

export const NOT_IN_REVIEW_NOTE =
  'Only a version that is in review can be approved or rejected. Submit the draft first.';

export const AI_DRAFT_CAUTION =
  'A model produced this text. Approving it makes it answerable to reps as company-approved ' +
  'material. Read it as a draft, not as a summary you are confirming.';

export const PRODUCT_CLAIM_CAUTION =
  'This draft is about a product. Product claims, indications and prescribing information are ' +
  'regulated promotional content and must come from the client, not from a model. Approve the ' +
  'wording only if the underlying claim came from an approved label or prescribing information.';

/**
 * The single decision this component makes, extracted so it is testable without a renderer.
 *
 * Pure. Takes the version and who is looking; returns whether to draw the controls.
 */
export const approvalAffordance = (
  version: Pick<KnowledgeDocumentVersion, 'status' | 'createdByUserId' | 'submittedByUserId'>,
  viewerUserId: string,
): ApprovalAffordance => {
  if (version.status !== 'in_review') return { kind: 'hidden', reason: NOT_IN_REVIEW_NOTE };
  // Author first: an author who also submitted should be told the stronger of the two reasons.
  if (version.createdByUserId === viewerUserId) {
    return { kind: 'hidden', reason: FOUR_EYES_AUTHOR_NOTE };
  }
  if (version.submittedByUserId === viewerUserId) {
    return { kind: 'hidden', reason: FOUR_EYES_SUBMITTER_NOTE };
  }
  return { kind: 'may_decide' };
};

export interface KnowledgeReviewProps {
  readonly version: KnowledgeDocumentVersion;
  /** The document's title and the product it is about — read alongside the version. */
  readonly documentTitle: string;
  /** Resolved names, so the screen shows "India" rather than a uuid. Null when not set. */
  readonly marketName: string | null;
  readonly productBrandName: string | null;
  readonly viewerUserId: string;
  /** Injected so the component is testable and so the write stays in one place. */
  readonly onApprove: (attestation: string) => Promise<void>;
  readonly onReject: (reason: string) => Promise<void>;
}

type State =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'approved' }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'failed'; readonly message: string };

const button = (): CSSProperties => ({
  flex: 1,
  minHeight: 52,
  background: tokens.color.surface,
  border: `2px solid ${tokens.color.textPrimary}`,
  borderRadius: tokens.radius.control,
  color: tokens.color.textPrimary,
  fontSize: compactTypography.control.size,
  fontWeight: Number(compactTypography.control.weight),
  cursor: 'pointer',
});

const box = (): CSSProperties => ({
  width: '100%',
  minHeight: 96,
  padding: tokens.space.sm,
  border: `1px solid ${tokens.color.textPrimary}`,
  borderRadius: tokens.radius.control,
  fontSize: compactTypography.body.size,
  fontFamily: 'inherit',
});

export const KnowledgeReview = ({
  version,
  documentTitle,
  marketName,
  productBrandName,
  viewerUserId,
  onApprove,
  onReject,
}: KnowledgeReviewProps): ReactNode => {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [attestation, setAttestation] = useState('');
  const [reason, setReason] = useState('');

  const affordance = approvalAffordance(version, viewerUserId);
  const busy = state.kind === 'busy';

  const run = (action: () => Promise<void>, done: State): void => {
    if (busy) return;
    setState({ kind: 'busy' });
    action()
      .then(() => {
        setState(done);
      })
      .catch((error: unknown) => {
        // The server's refusal is shown as it is. Nothing here interprets a SQLSTATE into a
        // reassurance — if the database refused, the reviewer needs to know it refused.
        setState({
          kind: 'failed',
          message: error instanceof Error ? error.message : 'The server refused this.',
        });
      });
  };

  return (
    <Card>
      <Heading>{documentTitle}</Heading>

      <div style={{ display: 'flex', gap: tokens.space.xs, flexWrap: 'wrap' }}>
        <Pill tone="neutral">{`version ${String(version.versionNumber)}`}</Pill>
        <Pill tone="neutral">{version.status}</Pill>
        {/* E4. Market and product are shown for EVERY draft, not only AI ones: a human author can
            walk into regulated content just as easily, and a caution that only appears sometimes
            teaches the reviewer to stop reading it. */}
        <Pill tone={marketName === null ? 'attention' : 'neutral'}>
          {marketName === null ? 'no market' : `market: ${marketName}`}
        </Pill>
        {/* `attention` when a product IS named: that is the case E4 wants the reviewer to notice,
            because it is the case where a draft may have crossed into regulated content. */}
        <Pill tone={productBrandName === null ? 'neutral' : 'attention'}>
          {productBrandName === null ? 'not about a product' : `product: ${productBrandName}`}
        </Pill>
      </div>

      <Label>Who produced this text</Label>
      <Body>
        {version.authorship === 'ai_generated'
          ? `A model: ${version.authoringModel ?? 'unnamed'}. Drafted under the account of the admin who requested it.`
          : 'A person.'}
      </Body>
      {version.authorship === 'ai_generated' ? <MissingNote>{AI_DRAFT_CAUTION}</MissingNote> : null}
      {productBrandName === null ? null : <MissingNote>{PRODUCT_CLAIM_CAUTION}</MissingNote>}

      <Label>Where it came from</Label>
      <Body>{version.sourceReference}</Body>

      <Label>The text being approved</Label>
      {/* `whiteSpace: pre-wrap` on purpose: the body is frozen at submit and chunked on its own
          line breaks, so the reviewer must see the same line breaks the chunker did. */}
      <Body>
        <span style={{ whiteSpace: 'pre-wrap' }}>{version.body}</span>
      </Body>

      {state.kind === 'approved' ? (
        <Body>Approved. Reps can be answered from this text.</Body>
      ) : null}
      {state.kind === 'rejected' ? (
        <Body>Rejected. This version is final and cannot be reopened.</Body>
      ) : null}
      {state.kind === 'failed' ? <MissingNote>{state.message}</MissingNote> : null}

      {affordance.kind === 'hidden' ? (
        <MissingNote>{affordance.reason}</MissingNote>
      ) : state.kind === 'approved' || state.kind === 'rejected' ? null : (
        <>
          <Label>Your attestation — required to approve</Label>
          <textarea
            aria-label="Your attestation"
            style={box()}
            value={attestation}
            onChange={(e) => {
              setAttestation(e.target.value);
            }}
          />
          <Label>Or a reason — required to reject</Label>
          <textarea
            aria-label="Reason for rejecting"
            style={box()}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
          />
          {/* Approve and Reject are the same control, side by side, one click each, no confirm on
              either — the same choice `override-form.tsx` made and for the same reason: making one
              path harder quietly turns a review into a rubber stamp in the easy direction. */}
          <div style={{ display: 'flex', gap: tokens.space.sm }}>
            <button
              type="button"
              style={button()}
              disabled={busy || attestation.trim() === ''}
              onClick={() => {
                run(() => onApprove(attestation.trim()), { kind: 'approved' });
              }}
            >
              Approve
            </button>
            <button
              type="button"
              style={button()}
              disabled={busy || reason.trim() === ''}
              onClick={() => {
                run(() => onReject(reason.trim()), { kind: 'rejected' });
              }}
            >
              Reject
            </button>
          </div>
        </>
      )}
    </Card>
  );
};
