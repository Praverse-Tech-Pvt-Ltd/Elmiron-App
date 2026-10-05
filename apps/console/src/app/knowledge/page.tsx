import type { ReactNode } from 'react';
import { KnowledgeDocumentVersionSchema } from '@fieldforce/core';
import type { KnowledgeDocumentVersion } from '@fieldforce/core';
import { tokens } from '@fieldforce/ui-tokens';
import { signedIn } from '../../lib/session';
import { Body, MissingNote, Title } from '../../lib/ui';
import { KnowledgeReviewList } from '../../lib/knowledge-review-list';

/**
 * W1-A E3 — the knowledge review queue. The screen `C26` needs to exist.
 *
 * **Why this route exists and is not just a component.** The central finding of
 * `docs/ai-platform/INVENTORY.md` is that **zero of PR #2's eight pieces has ever been called by an
 * app** — 8,174 lines with no consumer. A `KnowledgeReview` component with no route would have been
 * the ninth. This page is the consumer, and it is the first app code anywhere in either app that
 * calls the knowledge layer.
 *
 * **What it reads.** A table read, not an RPC: `knowledge_document_versions` where the status is
 * `in_review`. RLS decides what comes back — an admin sees their own organisation's versions at
 * every status, and this page asks for one status. **Nothing is filtered here to hide a row.** If a
 * row arrives that should not have, that is a backend defect to report, not something the client
 * corrects (`api-contracts.md` §1).
 *
 * **What it deliberately does NOT do.**
 *
 * * It does not seed, generate or draft anything. `C24` permits AI-generated drafts; producing them
 *   needs the gateway (`#4`) and a model (`#5`), neither of which exists. This screen reviews
 *   whatever is there, including nothing.
 * * It shows no score and no count per author. `C27` keeps scores off every manager surface, and a
 *   "drafts rejected per person" figure is a score with a different name.
 */

export const dynamic = 'force-dynamic';

/** Joined alongside the version so the screen can say "India" and "Probexa", not two uuids. */
interface Row {
  readonly version: KnowledgeDocumentVersion;
  readonly documentTitle: string;
  readonly marketName: string | null;
  readonly productBrandName: string | null;
}

export default async function KnowledgeReviewQueue(): Promise<ReactNode> {
  // Handled rather than asserted, for the same reason the coaching queue handles it: a page that
  // throws on a signed-out render is worse than one that says nothing loaded.
  const session = await signedIn();

  let rows: readonly Row[] | null = null;
  if (session !== null) {
    // `authoring_model` and `authorship` are the two columns W1-A E1 added. They are selected by
    // name rather than with `*` so a schema parse failure names the missing column.
    const { data, error } = await session.db
      .from('knowledge_document_versions')
      .select(
        'id, organisation_id, document_id, version_number, status, market_id, body, ' +
          'source_reference, authorship, authoring_model, effective_from, review_due_on, ' +
          'created_by_user_id, submitted_at, submitted_by_user_id, decided_at, ' +
          'decided_by_user_id, approval_attestation, rejection_reason, retired_at, ' +
          'retired_by_user_id, created_at, updated_at, ' +
          'knowledge_documents(title, products(brand_name)), markets(name)',
      )
      .eq('status', 'in_review')
      .order('submitted_at', { ascending: true });

    if (error === null) {
      rows = data.flatMap((raw): Row[] => {
        const r = raw as unknown as Record<string, unknown>;
        const doc = r['knowledge_documents'] as {
          title?: string;
          products?: { brand_name?: string } | null;
        } | null;
        const market = r['markets'] as { name?: string } | null;
        // Parsed with the contract schema, not trusted. `reviewDueOn` is computed at read on the
        // server, so a version with none is normal rather than malformed.
        const parsed = KnowledgeDocumentVersionSchema.safeParse({
          id: r['id'],
          organisationId: r['organisation_id'],
          documentId: r['document_id'],
          versionNumber: r['version_number'],
          status: r['status'],
          marketId: r['market_id'],
          body: r['body'],
          sourceReference: r['source_reference'],
          authorship: r['authorship'],
          authoringModel: r['authoring_model'],
          effectiveFrom: r['effective_from'],
          reviewDueOn: r['review_due_on'],
          createdByUserId: r['created_by_user_id'],
          submittedAt: r['submitted_at'],
          submittedByUserId: r['submitted_by_user_id'],
          decidedAt: r['decided_at'],
          decidedByUserId: r['decided_by_user_id'],
          approvalAttestation: r['approval_attestation'],
          rejectionReason: r['rejection_reason'],
          retiredAt: r['retired_at'],
          retiredByUserId: r['retired_by_user_id'],
          createdAt: r['created_at'],
          updatedAt: r['updated_at'],
        });
        if (!parsed.success) return [];
        return [
          {
            version: parsed.data,
            documentTitle: doc?.title ?? 'Untitled document',
            marketName: market?.name ?? null,
            productBrandName: doc?.products?.brand_name ?? null,
          },
        ];
      });
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.lg, maxWidth: 1000 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.xs }}>
        <Title>Knowledge awaiting your approval</Title>
        <Body muted>
          Nothing here is answerable to a rep until you approve it. You cannot approve a version you
          wrote or submitted — a second admin must.
        </Body>
      </div>

      {rows === null ? (
        <MissingNote>
          Nothing loaded. Either no session reached the server, or the read was refused. Signing in
          again is the first thing to try.
        </MissingNote>
      ) : rows.length === 0 ? (
        <MissingNote>
          No versions are in review. This is the expected state today: no approved product content
          exists yet (decision #7, the product catalogue), and no AI drafting exists yet (decisions
          #4 and #5). An empty queue here is not a fault.
        </MissingNote>
      ) : (
        <KnowledgeReviewList rows={rows} viewerUserId={session?.userId ?? ''} />
      )}
    </div>
  );
}
