import type { ReactNode } from 'react';
import { SimPersonaSchema, SimScenarioSchema } from '@fieldforce/core';
import type { SimPersona, SimScenario } from '@fieldforce/core';
import { tokens } from '@fieldforce/ui-tokens';
import { signedIn } from '../../lib/session';
import { Body, MissingNote, Title } from '../../lib/ui';
import { simPersonaRow, simScenarioRow, type SimContentRow } from '../../lib/sim-content-row';
import { PracticeContent } from '../../lib/sim-content-list';

/**
 * W1-F B — the screen that makes a practice session possible at all.
 *
 * **Why this route is the point of the session.** `CR-5` D3 listed eight things needed to run ONE
 * practice session. Two are accounts and a feature flag. **Four were content that nothing but a
 * test could create**: a persona, an approved persona, a scenario, an approved scenario. AI Doctor
 * was built, proven end to end over real HTTP, and unreachable — `start_sim_session` refuses
 * `23514` for a scenario that is not approved, and no screen could approve one.
 *
 * **What it reads.** Table reads, not RPCs. RLS decides what comes back: `sim_personas_read` and
 * `sim_scenarios_read` admit an admin to every status in their own organisation and everybody else
 * to `approved` only. **Nothing is filtered here to hide a row** (`api-contracts.md` §1) — the one
 * filter is the persona dropdown, which offers only APPROVED personas because a scenario built on
 * an unapproved persona is a scenario that can never start.
 *
 * **What it deliberately does NOT do.** It does not draft anything with a model. `C24` permits
 * AI-generated drafts and the persona/scenario tables carry `authorship` and `authoring_model` for
 * exactly that, but producing one needs decision `#5`, which is open. Every row this screen creates
 * is `human`, and the review card still shows the model caution for rows that are not — because
 * the gateway will eventually write some.
 */

export const dynamic = 'force-dynamic';

const PERSONA_COLUMNS =
  'id, organisation_id, display_name, specialty, stance, brief, status, authorship, ' +
  'authoring_model, created_by_user_id, submitted_at, submitted_by_user_id, decided_at, ' +
  'decided_by_user_id, approval_attestation, rejection_reason, retired_at, retired_by_user_id, ' +
  'created_at, updated_at';

const SCENARIO_COLUMNS =
  'id, organisation_id, persona_id, title, objective, objection, product_id, market_id, status, ' +
  'authorship, authoring_model, created_by_user_id, submitted_at, submitted_by_user_id, ' +
  'decided_at, decided_by_user_id, approval_attestation, rejection_reason, retired_at, ' +
  'retired_by_user_id, created_at, updated_at';

/** snake_case off the wire, camelCase in the contract. Parsed, never trusted. */
const toPersona = (r: Record<string, unknown>): SimPersona | null => {
  const parsed = SimPersonaSchema.safeParse({
    id: r['id'],
    organisationId: r['organisation_id'],
    displayName: r['display_name'],
    specialty: r['specialty'],
    stance: r['stance'],
    brief: r['brief'],
    status: r['status'],
    authorship: r['authorship'],
    authoringModel: r['authoring_model'],
    createdByUserId: r['created_by_user_id'],
    submittedByUserId: r['submitted_by_user_id'],
    decidedByUserId: r['decided_by_user_id'],
    approvalAttestation: r['approval_attestation'],
    rejectionReason: r['rejection_reason'],
    createdAt: r['created_at'],
    updatedAt: r['updated_at'],
  });
  return parsed.success ? parsed.data : null;
};

const toScenario = (r: Record<string, unknown>): SimScenario | null => {
  const parsed = SimScenarioSchema.safeParse({
    id: r['id'],
    organisationId: r['organisation_id'],
    personaId: r['persona_id'],
    title: r['title'],
    objective: r['objective'],
    objection: r['objection'],
    productId: r['product_id'],
    marketId: r['market_id'],
    status: r['status'],
    authorship: r['authorship'],
    authoringModel: r['authoring_model'],
    createdByUserId: r['created_by_user_id'],
    submittedByUserId: r['submitted_by_user_id'],
    decidedByUserId: r['decided_by_user_id'],
    approvalAttestation: r['approval_attestation'],
    rejectionReason: r['rejection_reason'],
    createdAt: r['created_at'],
    updatedAt: r['updated_at'],
  });
  return parsed.success ? parsed.data : null;
};

export default async function PracticeAuthoring(): Promise<ReactNode> {
  const session = await signedIn();
  if (session === null) {
    return (
      <MissingNote>
        No session reached the server. Signing in again is the first thing to try.
      </MissingNote>
    );
  }

  const [personaRes, scenarioRes, productRes, marketRes] = await Promise.all([
    session.db.from('sim_personas').select(PERSONA_COLUMNS).order('created_at'),
    session.db.from('sim_scenarios').select(SCENARIO_COLUMNS).order('created_at'),
    session.db.from('products').select('id, brand_name').order('brand_name'),
    session.db.from('markets').select('id, name').order('name'),
  ]);

  const personas = (personaRes.data ?? []).flatMap((r) => {
    const p = toPersona(r as unknown as Record<string, unknown>);
    return p === null ? [] : [p];
  });
  const scenarios = (scenarioRes.data ?? []).flatMap((r) => {
    const s = toScenario(r as unknown as Record<string, unknown>);
    return s === null ? [] : [s];
  });

  const products = (productRes.data ?? []).map((r) => {
    const row = r as unknown as Record<string, unknown>;
    return { id: String(row['id']), brandName: String(row['brand_name']) };
  });
  const markets = (marketRes.data ?? []).map((r) => {
    const row = r as unknown as Record<string, unknown>;
    return { id: String(row['id']), name: String(row['name']) };
  });

  const personaName = new Map(personas.map((p) => [p.id, p.displayName]));
  const productName = new Map(products.map((p) => [p.id, p.brandName]));
  const marketName = new Map(markets.map((m) => [m.id, m.name]));

  const rows: readonly SimContentRow[] = [
    ...personas.map(simPersonaRow),
    ...scenarios.map((s) =>
      simScenarioRow(
        s,
        personaName.get(s.personaId) ?? 'A persona you cannot see',
        s.productId === null ? null : (productName.get(s.productId) ?? s.productId),
        s.marketId === null ? null : (marketName.get(s.marketId) ?? s.marketId),
      ),
    ),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.lg, maxWidth: 1000 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.xs }}>
        <Title>Practice doctors and scenarios</Title>
        <Body muted>
          A rep can only practise against a scenario that reads approved. You cannot approve
          something you wrote or submitted — a second admin must.
        </Body>
      </div>

      <PracticeContent
        rows={rows}
        approvedPersonas={personas
          .filter((p) => p.status === 'approved')
          .map((p) => ({ id: p.id, displayName: p.displayName }))}
        products={products}
        markets={markets}
        viewerUserId={session.userId}
      />
    </div>
  );
}
