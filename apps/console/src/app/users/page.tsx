import type { ReactNode } from 'react';
import { ADMIN_RPC, AdminUserListSchema, TerritoryTreeSchema } from '@fieldforce/core';
import { signedIn } from '../../lib/session';
import { Body, MissingNote, Page, PageHeader, RoleNote } from '../../lib/ui';
import { callerRole } from '../../lib/role';
import { UsersAdmin } from '../../lib/users-admin';
import { adminRefusal } from '../../lib/admin-text';

/**
 * `FE-W75` — Users & roles. Replaces `docs/DEPLOY-RUNBOOK.md` step 4's two hand-made steps (a
 * dashboard account, then an INSERT typed into the SQL editor) for the company's own admins.
 *
 * Reads: `admin_list_users`, which is admin-only and audited with the reason below, and the territory
 * tree for the pickers. Writes: `admin_update_user` and `admin_set_user_active` as RPCs; creating an
 * account and resetting a password go through the `admin-accounts` Edge Function, the one path to
 * GoTrue's admin API. The database refuses each of the runbook's five silent mistakes by name, and
 * the screen says which.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Users & roles' };

const ONLY_ADMINS =
  'Only an active admin manages users. Nothing here is hidden from you by mistake.';

const READ_REASON = 'console users & roles screen render';

export default async function UsersPage(): Promise<ReactNode> {
  const session = await signedIn();
  if (session === null) {
    return (
      <MissingNote>
        No session reached the server. Signing in again is the first thing to try.
      </MissingNote>
    );
  }

  const header = (
    <PageHeader title="Users & roles">
      <Body muted>
        Everyone who signs in to the app or this console. Accounts are created confirmed, with a
        temporary password shown once. Nobody is ever deleted — a person who leaves is deactivated,
        and their records stay theirs.
      </Body>
    </PageHeader>
  );

  // `FE-W164`: a manager is told once; the audited list read is not asked for.
  const role = await callerRole();
  if (role !== null && role !== 'admin') {
    return (
      <Page>
        {header}
        <RoleNote>{ONLY_ADMINS}</RoleNote>
      </Page>
    );
  }

  const [list, tree] = await Promise.all([
    session.db.rpc(ADMIN_RPC.listUsers, { p_reason: READ_REASON }),
    session.db.rpc(ADMIN_RPC.territoryTree),
  ]);

  if (list.error !== null) {
    return (
      <Page>
        {header}
        {list.error.code === '42501' ? (
          <RoleNote>{ONLY_ADMINS}</RoleNote>
        ) : (
          <MissingNote tone="critical">{adminRefusal(list.error)}</MissingNote>
        )}
      </Page>
    );
  }

  const parsed = AdminUserListSchema.safeParse(list.data);
  const territories = TerritoryTreeSchema.safeParse(tree.data);
  if (!parsed.success) {
    return (
      <Page>
        {header}
        <MissingNote tone="critical">
          The user list came back in a shape this console does not recognise, so it is not shown.
          The console and the database are probably on different versions.
        </MissingNote>
      </Page>
    );
  }

  return (
    <Page>
      {header}
      {territories.success ? null : (
        <MissingNote tone="critical">
          The territory tree could not be read, so no territory can be chosen. Users can still be
          listed, deactivated and reactivated.
        </MissingNote>
      )}
      <UsersAdmin
        selfId={session.userId}
        users={parsed.data.users}
        pending={parsed.data.pending}
        territories={territories.success ? territories.data.territories : []}
      />
    </Page>
  );
}
