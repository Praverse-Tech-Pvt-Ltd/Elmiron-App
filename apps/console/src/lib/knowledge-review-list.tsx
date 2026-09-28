'use client';

import type { ReactNode } from 'react';
import { KNOWLEDGE_RPC } from '@fieldforce/core';
import type { KnowledgeDocumentVersion } from '@fieldforce/core';
import { tokens } from '@fieldforce/ui-tokens';
import { browserClient } from './supabase';
import { KnowledgeReview } from './knowledge-review';

/**
 * W1-A E3 — the client boundary between the server-rendered queue and the review card.
 *
 * The page is a Server Component and cannot hand a function to a client component, so the two
 * writes are built here, where the signed-in token is reachable from the cookie the same way
 * `override-form.tsx` reaches it.
 *
 * **Both writes go to the RPC, as the signed-in admin.** `approve_knowledge_version` and
 * `reject_knowledge_version` apply four eyes, the state check and the attestation requirement in
 * their own bodies. Nothing here can grant what they would refuse.
 */

export interface KnowledgeReviewListRow {
  readonly version: KnowledgeDocumentVersion;
  readonly documentTitle: string;
  readonly marketName: string | null;
  readonly productBrandName: string | null;
}

const restUrl = (): string => {
  const base = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  if (base === undefined || base === '') throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  return `${base.replace(/\/+$/, '')}/rest/v1`;
};

/**
 * `createApiClient` has no method for these two RPCs yet, so the call is a direct `rpc` through the
 * browser client. Recorded plainly rather than hidden: when `packages/core`'s client gains
 * `approveKnowledgeVersion`, this should move to it, and `API_PATHS` already declares the path
 * (W1-A B1). The RPC NAME comes from `KNOWLEDGE_RPC` so it cannot drift from the contract.
 */
const callRpc = async (fn: string, args: Record<string, unknown>): Promise<void> => {
  // Asserts the URL is configured before any click can reach the network, so a misconfigured
  // deployment fails here rather than as a silent no-op on the reviewer's click.
  restUrl();
  const supabase = browserClient();
  const { error } = await supabase.rpc(fn, args);
  if (error !== null) {
    // The SQLSTATE and message are surfaced as the server sent them. `KnowledgeReview` shows the
    // message; nothing here translates a refusal into reassurance.
    throw new Error(error.message);
  }
};

export const KnowledgeReviewList = ({
  rows,
  viewerUserId,
}: {
  readonly rows: readonly KnowledgeReviewListRow[];
  readonly viewerUserId: string;
}): ReactNode => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.lg }}>
    {rows.map((row) => (
      <KnowledgeReview
        key={row.version.id}
        version={row.version}
        documentTitle={row.documentTitle}
        marketName={row.marketName}
        productBrandName={row.productBrandName}
        viewerUserId={viewerUserId}
        onApprove={async (attestation) => {
          await callRpc(KNOWLEDGE_RPC.approveKnowledgeVersion, {
            p_version_id: row.version.id,
            p_attestation: attestation,
          });
        }}
        onReject={async (reason) => {
          await callRpc(KNOWLEDGE_RPC.rejectKnowledgeVersion, {
            p_version_id: row.version.id,
            p_reason: reason,
          });
        }}
      />
    ))}
  </div>
);
