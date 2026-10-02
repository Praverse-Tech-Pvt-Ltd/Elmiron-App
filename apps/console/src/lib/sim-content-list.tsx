'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { SIMULATION_RPC } from '@fieldforce/core';
import { tokens } from '@fieldforce/ui-tokens';
import { browserClient } from './supabase';
import { Body, Title } from './ui';
import { PersonaDraftForm, ScenarioDraftForm, SimContentReview } from './sim-content';
import type { SimContentRow } from './sim-content-row';

/**
 * W1-F B4 — the client boundary between the server-rendered practice page and the cards.
 *
 * The same shape as `knowledge-review-list.tsx`, for the same reason: the page is a Server
 * Component and cannot hand a function to a client component, so every write is built here where
 * the signed-in token is reachable from the cookie.
 *
 * **Every write goes as the signed-in admin.** The two drafts are ordinary table inserts — RLS
 * (`sim_personas_author`, `sim_scenarios_author`) admits only an admin of the caller's own
 * organisation, and `sim_content_before_insert()` refuses any row that tries to be born approved.
 * The three decisions go to `submit_sim_content`, `approve_sim_content` and `reject_sim_content`,
 * which hold four eyes and the attestation requirement in their own bodies.
 *
 * `router.refresh()` after each write re-runs the server read, so a row moves between the lists
 * without a reload and without this file keeping a second copy of the truth.
 */

export interface PracticeContentProps {
  readonly rows: readonly SimContentRow[];
  readonly approvedPersonas: readonly { readonly id: string; readonly displayName: string }[];
  readonly products: readonly { readonly id: string; readonly brandName: string }[];
  readonly markets: readonly { readonly id: string; readonly name: string }[];
  readonly viewerUserId: string;
}

const callRpc = async (fn: string, args: Record<string, unknown>): Promise<void> => {
  const { error } = await browserClient().rpc(fn, args);
  // The SQLSTATE and the message are surfaced as the server sent them.
  if (error !== null) throw new Error(error.message);
};

const insertRow = async (table: string, values: Record<string, unknown>): Promise<void> => {
  const supabase = browserClient();
  const { data: user } = await supabase.auth.getUser();
  const id = user.user?.id;
  if (id === undefined) throw new Error('No session. Sign in again.');
  // `created_by_user_id` is supplied rather than defaulted so the four-eyes CHECK has an author to
  // compare against from the first row. `organisation_id` and `status` are left to their defaults:
  // the column default and the insert trigger, not this file, decide those.
  const { error } = await supabase.from(table).insert({ ...values, created_by_user_id: id });
  if (error !== null) throw new Error(error.message);
};

export const PracticeContent = ({
  rows,
  approvedPersonas,
  products,
  markets,
  viewerUserId,
}: PracticeContentProps): ReactNode => {
  const router = useRouter();
  const refresh = (): void => {
    router.refresh();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.lg }}>
      <PersonaDraftForm
        onCreate={async (input) => {
          await insertRow('sim_personas', {
            display_name: input.displayName,
            specialty: input.specialty,
            stance: input.stance,
            brief: input.brief,
          });
          refresh();
        }}
      />

      <ScenarioDraftForm
        personas={approvedPersonas}
        products={products}
        markets={markets}
        onCreate={async (input) => {
          await insertRow('sim_scenarios', {
            persona_id: input.personaId,
            title: input.title,
            objective: input.objective,
            objection: input.objection,
            product_id: input.productId,
            market_id: input.marketId,
          });
          refresh();
        }}
      />

      <Title>Everything drafted so far</Title>
      {rows.length === 0 ? (
        <Body muted>
          Nothing yet. A rep cannot start a practice session until at least one scenario here reads
          approved.
        </Body>
      ) : (
        rows.map((row) => (
          <SimContentReview
            key={`${row.kind}:${row.id}`}
            row={row}
            viewerUserId={viewerUserId}
            onSubmit={async () => {
              await callRpc(SIMULATION_RPC.submitSimContent, { p_kind: row.kind, p_id: row.id });
              refresh();
            }}
            onApprove={async (attestation) => {
              await callRpc(SIMULATION_RPC.approveSimContent, {
                p_kind: row.kind,
                p_id: row.id,
                p_attestation: attestation,
              });
              refresh();
            }}
            onReject={async (reason) => {
              await callRpc(SIMULATION_RPC.rejectSimContent, {
                p_kind: row.kind,
                p_id: row.id,
                p_reason: reason,
              });
              refresh();
            }}
          />
        ))
      )}
    </div>
  );
};
