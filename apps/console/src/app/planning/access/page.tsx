import type { ReactNode } from 'react';
import { PlanningGrantSchema, grantState } from '@fieldforce/core';
import { tokens } from '@fieldforce/ui-tokens';
import { signedIn } from '../../../lib/session';
import { Body, MissingNote, Title } from '../../../lib/ui';
import { PlanningAccess } from '../../../lib/planning-access';
import type { GrantRow, Option } from '../../../lib/planning-access';

/**
 * `BE-W171` / `BE-C78` — an ADMIN grants a field manager planning scope over a territory beyond
 * their own subtree, for dates, with a reason; and revokes it. An admin never plans a day and never
 * writes a visit, and this page offers neither.
 *
 * Reads are RLS: an admin sees their company's grants, a manager only the grants made for them. The
 * two writes are `grant_planning_access` and `revoke_planning_access`, which each check again.
 */
export const dynamic = 'force-dynamic';

export default async function PlanningAccessPage(): Promise<ReactNode> {
  const session = await signedIn();
  if (session === null) {
    return (
      <MissingNote>
        No session reached the server. Signing in again is the first thing to try.
      </MissingNote>
    );
  }

  const [me, grants, revocations, people, territories] = await Promise.all([
    session.db.from('user_profiles').select('role').eq('id', session.userId).maybeSingle(),
    session.db
      .from('planning_territory_grants')
      .select(
        'id, organisation_id, manager_id, territory_id, valid_from, valid_until, reason, granted_by_user_id, created_at',
      )
      .order('created_at', { ascending: false }),
    session.db.from('planning_territory_grant_revocations').select('grant_id'),
    session.db.from('user_profiles').select('id, full_name, role, is_active').order('full_name'),
    session.db.from('territories').select('id, name').order('name'),
  ]);

  const isAdmin = me.data?.role === 'admin';
  const today = new Date().toISOString().slice(0, 10);
  const revoked = new Set((revocations.data ?? []).map((r) => String(r.grant_id)));
  const nameOf = new Map((people.data ?? []).map((p) => [String(p.id), String(p.full_name)]));
  const territoryOf = new Map((territories.data ?? []).map((t) => [String(t.id), String(t.name)]));

  const rows: GrantRow[] = ((grants.data ?? []) as unknown[]).map((raw) => {
    const grant = PlanningGrantSchema.parse(raw);
    return {
      id: grant.id,
      manager: nameOf.get(grant.manager_id) ?? 'A manager outside your view',
      territory: territoryOf.get(grant.territory_id) ?? 'A territory outside your view',
      from: grant.valid_from,
      until: grant.valid_until,
      reason: grant.reason,
      state: grantState(grant, revoked.has(grant.id), today),
    };
  });
  const managers: Option[] = (people.data ?? [])
    .filter((p) => p.role === 'field_manager' && p.is_active === true)
    .map((p) => ({ id: String(p.id), label: String(p.full_name) }));
  const territoryOptions: Option[] = (territories.data ?? []).map((t) => ({
    id: String(t.id),
    label: String(t.name),
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.lg, maxWidth: 1000 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.xs }}>
        <Title>Planning access</Title>
        <Body muted>
          A field manager plans the reps in their own territory. To let them plan somewhere else —
          covering a colleague, say — grant them that territory for a set of days, with a reason.
          The grant covers the territory and everything beneath it, and can be revoked at any time.
        </Body>
      </div>
      {isAdmin ? null : (
        <MissingNote>
          Only an admin grants planning access. Any grant made for you is listed below.
        </MissingNote>
      )}
      <PlanningAccess
        canGrant={isAdmin}
        grants={rows}
        managers={managers}
        territories={territoryOptions}
        today={today}
      />
    </div>
  );
}
