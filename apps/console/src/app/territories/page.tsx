import type { ReactNode } from 'react';
import { ADMIN_RPC, TerritoryTreeSchema } from '@fieldforce/core';
import { signedIn } from '../../lib/session';
import { Body, MissingNote, Page, PageHeader, RoleNote } from '../../lib/ui';
import { TerritoriesAdmin } from '../../lib/territories-admin';
import { adminRefusal } from '../../lib/admin-text';

/**
 * `FE-W76` — Territories: the tree, and each territory's working hours.
 *
 * An admin sees the company's tree and edits it; a field manager sees their own subtree, read-only
 * (`territory_tree` decides both). The level rules are the operator sheet's — National, Region,
 * Area/Territory, codes unique across the whole system — enforced by `admin_create_territory`.
 * Nothing is deleted: a territory no longer used is renamed (the migration says why).
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Territories' };

export default async function TerritoriesPage(): Promise<ReactNode> {
  const session = await signedIn();
  if (session === null) {
    return (
      <MissingNote>
        No session reached the server. Signing in again is the first thing to try.
      </MissingNote>
    );
  }

  const tree = await session.db.rpc(ADMIN_RPC.territoryTree);
  const parsed = tree.error === null ? TerritoryTreeSchema.safeParse(tree.data) : null;

  return (
    <Page>
      <PageHeader title="Territories">
        <Body muted>
          National, then Region, then Area/Territory. Reps sit on the lowest level; a manager sees
          their territory and everything beneath it. Working hours set on a territory apply to
          everything beneath it that has none of its own.
        </Body>
      </PageHeader>
      {tree.error !== null ? (
        tree.error.code === '42501' ? (
          <RoleNote>
            Only an admin, or a field manager for their own territory, reads the territory tree.
          </RoleNote>
        ) : (
          <MissingNote tone="critical">{adminRefusal(tree.error)}</MissingNote>
        )
      ) : parsed === null || !parsed.success ? (
        <MissingNote tone="critical">
          The territory tree came back in a shape this console does not recognise, so it is not
          shown.
        </MissingNote>
      ) : (
        <>
          {parsed.data.canEdit ? null : (
            <RoleNote>
              You can see your own territory and everything beneath it. Only an admin changes them.
            </RoleNote>
          )}
          <TerritoriesAdmin canEdit={parsed.data.canEdit} nodes={parsed.data.territories} />
        </>
      )}
    </Page>
  );
}
