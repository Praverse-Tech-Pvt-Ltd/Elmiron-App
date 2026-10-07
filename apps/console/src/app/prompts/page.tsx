import type { ReactNode } from 'react';
import { AiPromptVersionSchema, GATEWAY_FEATURES } from '@fieldforce/core';
import type { AiPromptVersion, GatewayFeature } from '@fieldforce/core';
import { tokens } from '@fieldforce/ui-tokens';
import { signedIn } from '../../lib/session';
import { Body, MissingNote, Title } from '../../lib/ui';
import { PromptList } from '../../lib/prompt-review-list';

/**
 * W1-G E1 / `BE-W122` — the route that removes the last "an engineer runs SQL" step.
 *
 * **Which features this screen offers, and why it is not every one of them.** `AI_FEATURES` lists
 * thirteen. Most are blocked by things a prompt cannot unblock — `transcript_analysis`,
 * `pv_screening` and `complaint_screening` need transcripts, which need the PV/DPDP signatory
 * (`C3`). **Offering a prompt box for a feature that cannot run would invite somebody to write one
 * and conclude the feature was ready.** So the list is the features that have a gateway behind them
 * (`GATEWAY_FEATURES`, five since W2-E), and a new one joins when its flow does.
 */

export const dynamic = 'force-dynamic';

/**
 * The features a prompt can currently do anything for: exactly the ones with a gateway path.
 *
 * W2-E A (`BE-W164`): this was a hand-written list of three, and `mr_chat` and `lms_tutor` had
 * gateway paths without being on it — so two features could not be authored at all. It is now
 * `GATEWAY_FEATURES`, the same list the schema-name map is keyed on, so a feature cannot be offered
 * without the column the gateway demands, nor have a gateway path without being offered.
 */
const OFFERED_FEATURES: readonly GatewayFeature[] = GATEWAY_FEATURES;

const COLUMNS =
  'id, organisation_id, feature, version_number, status, system_prompt, output_schema_name, ' +
  'model_config, created_by_user_id, submitted_at, submitted_by_user_id, decided_at, ' +
  'decided_by_user_id, approval_attestation, rejection_reason, retired_at, retired_by_user_id, ' +
  'created_at, updated_at';

const toVersion = (r: Record<string, unknown>): AiPromptVersion | null => {
  const parsed = AiPromptVersionSchema.safeParse({
    id: r['id'],
    organisationId: r['organisation_id'],
    feature: r['feature'],
    versionNumber: r['version_number'],
    status: r['status'],
    systemPrompt: r['system_prompt'],
    outputSchemaName: r['output_schema_name'],
    modelConfig: r['model_config'],
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
  return parsed.success ? parsed.data : null;
};

export default async function Prompts(): Promise<ReactNode> {
  const session = await signedIn();
  if (session === null) {
    return (
      <MissingNote>
        No session reached the server. Signing in again is the first thing to try.
      </MissingNote>
    );
  }

  // RLS decides what comes back: `ai_prompt_versions_admin_select` admits an admin to their own
  // organisation's rows and nobody else to any. Nothing is filtered here to hide a row.
  const { data } = await session.db
    .from('ai_prompt_versions')
    .select(COLUMNS)
    .order('feature')
    .order('version_number', { ascending: false });

  const versions = (data ?? []).flatMap((r) => {
    const v = toVersion(r as unknown as Record<string, unknown>);
    return v === null ? [] : [v];
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.lg, maxWidth: 1000 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.xs }}>
        <Title>What the AI is told to do</Title>
        <Body muted>
          These are the instructions a model is given before it answers anything. You cannot approve
          a prompt you wrote or submitted — a second admin must.
        </Body>
      </div>

      <PromptList versions={versions} features={OFFERED_FEATURES} viewerUserId={session.userId} />
    </div>
  );
}
