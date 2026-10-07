'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { AI_RPC, promptDraftRow } from '@fieldforce/core';
import type { AiPromptVersion, GatewayFeature } from '@fieldforce/core';
import { tokens } from '@fieldforce/ui-tokens';
import { browserClient } from './supabase';
import { Body, Title } from './ui';
import { PromptDraftForm, PromptReview } from './prompt-review';

/**
 * W1-G E1 — the client boundary for the prompt screen.
 *
 * The same shape as `sim-content-list.tsx` and `knowledge-review-list.tsx`: the page is a Server
 * Component and cannot hand a function to a client component, so the writes are built here.
 *
 * **The draft is a table insert; the three decisions are RPCs.** `ai_prompt_versions_before_insert()`
 * forces `status` to `draft`, computes `version_number` as max+1 and nulls every lifecycle column,
 * so an insert cannot smuggle in an approved prompt. `submit/approve/reject_ai_prompt_version` hold
 * four eyes and the attestation requirement in their own bodies. **Nothing here can grant what they
 * would refuse.**
 */

export interface PromptListProps {
  readonly versions: readonly AiPromptVersion[];
  readonly features: readonly GatewayFeature[];
  readonly viewerUserId: string;
}

const callRpc = async (fn: string, args: Record<string, unknown>): Promise<void> => {
  const { error } = await browserClient().rpc(fn, args);
  if (error !== null) throw new Error(error.message);
};

export const PromptList = ({ versions, features, viewerUserId }: PromptListProps): ReactNode => {
  const router = useRouter();
  const refresh = (): void => {
    router.refresh();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.lg }}>
      <PromptDraftForm
        features={features}
        onCreate={async (input) => {
          const supabase = browserClient();
          const { data: user } = await supabase.auth.getUser();
          const id = user.user?.id;
          if (id === undefined) throw new Error('No session. Sign in again.');
          // `version_number` is not sent: the insert trigger computes it and overwrites anything
          // supplied. `organisation_id` and `status` are left to the column default and the
          // trigger, which is what makes "born a draft" true regardless of this file.
          //
          // W2-E A (`BE-W164`): the columns come from `promptDraftRow`, which derives
          // `output_schema_name` from the feature. This insert used to send feature and text only,
          // and every flow refuses a prompt without its schema name — so nothing approved here ran.
          const { error } = await supabase
            .from('ai_prompt_versions')
            .insert({ ...promptDraftRow(input), created_by_user_id: id });
          if (error !== null) throw new Error(error.message);
          refresh();
        }}
      />

      <Title>Prompts</Title>
      {versions.length === 0 ? (
        <Body muted>
          None yet. A feature with no approved prompt refuses every request with
          `ai_feature_disabled`, whatever its flag says.
        </Body>
      ) : (
        versions.map((version) => (
          <PromptReview
            key={version.id}
            version={version}
            viewerUserId={viewerUserId}
            onSubmit={async () => {
              await callRpc(AI_RPC.submitAiPromptVersion, { p_version_id: version.id });
              refresh();
            }}
            onApprove={async (attestation) => {
              await callRpc(AI_RPC.approveAiPromptVersion, {
                p_version_id: version.id,
                p_attestation: attestation,
              });
              refresh();
            }}
            onReject={async (reason) => {
              await callRpc(AI_RPC.rejectAiPromptVersion, {
                p_version_id: version.id,
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
