// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { KnowledgeDocumentVersion } from '@fieldforce/core';
import {
  AI_DRAFT_CAUTION,
  FOUR_EYES_AUTHOR_NOTE,
  FOUR_EYES_SUBMITTER_NOTE,
  KnowledgeReview,
  NOT_IN_REVIEW_NOTE,
  PRODUCT_CLAIM_CAUTION,
  approvalAffordance,
} from './knowledge-review';

/**
 * W1-A E3 — the operator's review screen, rendered.
 *
 * Two properties, and the second is the one that could go wrong quietly:
 *
 * 1. **The controls appear only when the server would allow the decision.** Not because this
 *    enforces anything — `approve_knowledge_version` refuses `42501` regardless — but because a
 *    button that always fails for the author is a worse screen than no button.
 * 2. **`C24` and E4 are visible on the screen, not just in a document.** A machine-written draft
 *    says so; a draft about a product carries the regulated-content caution. If those two notes
 *    ever stop rendering, `C24` silently becomes "AI text gets approved like anything else".
 */

afterEach(cleanup);

const AUTHOR = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a01';
const SUBMITTER = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b02';
const REVIEWER = '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c03';

const version = (over: Partial<KnowledgeDocumentVersion> = {}): KnowledgeDocumentVersion => ({
  id: '0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d04',
  organisationId: '0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e05',
  documentId: '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f06',
  versionNumber: 3,
  status: 'in_review',
  marketId: null,
  body: 'Store below 25 degrees.\nKeep out of direct sunlight.',
  sourceReference: 'Training deck, edition 4, page 11',
  authorship: 'human',
  authoringModel: null,
  effectiveFrom: '2026-01-01',
  reviewDueOn: null,
  createdByUserId: AUTHOR,
  submittedAt: '2026-09-28T09:00:00+05:30',
  submittedByUserId: SUBMITTER,
  decidedAt: null,
  decidedByUserId: null,
  approvalAttestation: null,
  rejectionReason: null,
  retiredAt: null,
  retiredByUserId: null,
  createdAt: '2026-09-27T09:00:00+05:30',
  updatedAt: '2026-09-28T09:00:00+05:30',
  ...over,
});

const draw = (over: Partial<KnowledgeDocumentVersion> = {}, viewer = REVIEWER) =>
  render(
    <KnowledgeReview
      version={version(over)}
      documentTitle="Probexa storage guidance"
      marketName={over.marketId === undefined ? null : 'India'}
      productBrandName={null}
      viewerUserId={viewer}
      onApprove={vi.fn(() => Promise.resolve())}
      onReject={vi.fn(() => Promise.resolve())}
    />,
  );

describe('approvalAffordance — the decision, without a renderer', () => {
  it('lets a third admin decide', () => {
    expect(approvalAffordance(version(), REVIEWER)).toEqual({ kind: 'may_decide' });
  });

  it('refuses the author, and says which rule', () => {
    const a = approvalAffordance(version(), AUTHOR);
    expect(a.kind).toBe('hidden');
    expect(a.kind === 'hidden' ? a.reason : '').toBe(FOUR_EYES_AUTHOR_NOTE);
  });

  it('refuses the submitter', () => {
    const a = approvalAffordance(version(), SUBMITTER);
    expect(a.kind === 'hidden' ? a.reason : '').toBe(FOUR_EYES_SUBMITTER_NOTE);
  });

  it('refuses a version that is not in review — any status, not just approved', () => {
    for (const status of ['draft', 'approved', 'rejected', 'retired'] as const) {
      const a = approvalAffordance(version({ status }), REVIEWER);
      expect(a.kind === 'hidden' ? a.reason : '', status).toBe(NOT_IN_REVIEW_NOTE);
    }
  });

  it('tells an author who also submitted the AUTHOR reason — the stronger of the two', () => {
    const a = approvalAffordance(version({ submittedByUserId: AUTHOR }), AUTHOR);
    expect(a.kind === 'hidden' ? a.reason : '').toBe(FOUR_EYES_AUTHOR_NOTE);
  });
});

describe('the rendered screen', () => {
  it('shows the text being approved, with its line breaks intact', () => {
    draw();
    // The body is frozen at submit and chunked on its own line breaks, so the reviewer must see
    // the same breaks the chunker will.
    expect(screen.getByText(/Store below 25 degrees/)).toBeTruthy();
    expect(screen.getByText(/Keep out of direct sunlight/)).toBeTruthy();
  });

  it('draws Approve and Reject for a third admin', () => {
    draw();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeTruthy();
    expect(screen.getByLabelText('Your attestation')).toBeTruthy();
  });

  it('draws NEITHER control for the author, and says why', () => {
    draw({}, AUTHOR);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
    expect(screen.getByText(FOUR_EYES_AUTHOR_NOTE)).toBeTruthy();
  });

  it('cannot approve with an empty attestation — the control is disabled', () => {
    draw();
    // `22023` is what the server answers to an empty attestation. Disabling is the explanation,
    // not the enforcement.
    expect(screen.getByRole('button', { name: 'Approve' }).hasAttribute('disabled')).toBe(true);
  });

  it('says a person wrote it when a person did', () => {
    draw();
    expect(screen.getByText('A person.')).toBeTruthy();
    expect(screen.queryByText(AI_DRAFT_CAUTION)).toBeNull();
  });

  it('C24: says a MODEL wrote it, names the model, and carries the caution', () => {
    draw({ authorship: 'ai_generated', authoringModel: 'some-model-v2' });
    expect(screen.getByText(/A model: some-model-v2/)).toBeTruthy();
    expect(screen.getByText(AI_DRAFT_CAUTION)).toBeTruthy();
  });

  it('E4: shows the market and whether the draft is about a product', () => {
    draw();
    expect(screen.getByText('not about a product')).toBeTruthy();
    expect(screen.getByText('no market')).toBeTruthy();
  });

  it('E4: a draft about a product carries the regulated-content caution', () => {
    render(
      <KnowledgeReview
        version={version()}
        documentTitle="Probexa label extract"
        marketName="India"
        productBrandName="Probexa"
        viewerUserId={REVIEWER}
        onApprove={vi.fn(() => Promise.resolve())}
        onReject={vi.fn(() => Promise.resolve())}
      />,
    );
    expect(screen.getByText('product: Probexa')).toBeTruthy();
    expect(screen.getByText('market: India')).toBeTruthy();
    expect(screen.getByText(PRODUCT_CLAIM_CAUTION)).toBeTruthy();
  });

  it('shows the server’s refusal rather than swallowing it', async () => {
    const onApprove = vi.fn(() =>
      Promise.reject(new Error('permission denied for function approve_knowledge_version')),
    );
    render(
      <KnowledgeReview
        version={version()}
        documentTitle="Probexa storage guidance"
        marketName={null}
        productBrandName={null}
        viewerUserId={REVIEWER}
        onApprove={onApprove}
        onReject={vi.fn(() => Promise.resolve())}
      />,
    );
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(screen.getByLabelText('Your attestation'), {
      target: { value: 'I attest this is accurate.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/permission denied for function/)).toBeTruthy();
  });

  it('passes the attestation the reviewer actually typed', async () => {
    const onApprove = vi.fn(() => Promise.resolve());
    render(
      <KnowledgeReview
        version={version()}
        documentTitle="Probexa storage guidance"
        marketName={null}
        productBrandName={null}
        viewerUserId={REVIEWER}
        onApprove={onApprove}
        onReject={vi.fn(() => Promise.resolve())}
      />,
    );
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(screen.getByLabelText('Your attestation'), {
      target: { value: '  I have checked this against the approved label.  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onApprove).toHaveBeenCalledWith('I have checked this against the approved label.');
  });
});
