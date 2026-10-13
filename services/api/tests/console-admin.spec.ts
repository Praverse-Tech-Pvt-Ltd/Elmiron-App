import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asOwner, asUser, withIdentityLock } from './auth.js';
import type { ProfileLike } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';
import {
  AdminUserListSchema,
  AdminUserSchema,
  AuditSearchSchema,
  RetentionOverviewSchema,
  TerritoryTreeSchema,
  UserCreationStartSchema,
} from '@fieldforce/core';

/**
 * The four console admin screens' database half:
 *   `BE-W185` users and roles (`20261013000200_console_user_admin`),
 *   `BE-W187` territories and hours (`20261013000210_console_territory_admin`),
 *   `BE-W188` the audit search (`20261013000220_console_audit_search`),
 *   `BE-W189` the retention overview (`20261013000230_console_retention_overview`).
 *
 * The matrix, for each: the admin of the company succeeds (the positive control), a manager and a rep
 * are refused, the RIVAL company's admin is refused or sees nothing of ours, and each rule refuses by
 * name. For users, the five mistakes `docs/DEPLOY-RUNBOOK.md` says a hand-made account suffers
 * silently are each asserted to be a named refusal here.
 *
 * Every write is in a rolled-back transaction. Accounts the Edge Function would create are inserted
 * into `auth.users` as the owner inside that transaction (`makeAccount`), as `manager-planning` does:
 * GoTrue's half is `admin-accounts-handler.spec.ts`.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

type Person = FixtureUser | ProfileLike;

const asTx = async <T>(user: Person, fn: (client: Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await asUser(client, user);
    return fn(client);
  });

/** The SQLSTATE and message a statement fails with -- or nulls when it succeeds. */
const failure = async (client: Client, sql: string, params: unknown[] = []) => {
  await client.query('savepoint probe');
  try {
    await client.query(sql, params);
    await client.query('release savepoint probe');
    return { code: null, message: null };
  } catch (error) {
    await client.query('rollback to savepoint probe');
    const e = error as { code?: string; message?: string };
    return { code: e.code ?? 'unknown', message: e.message ?? '' };
  }
};

/** A refusal with this SQLSTATE whose message carries this token. */
const expectRefusal = (
  f: { code: string | null; message: string | null },
  code: string,
  token: RegExp,
): void => {
  expect(f.code).toBe(code);
  expect(f.message).toMatch(token);
};

const one = async <T>(client: Client, sql: string, params: unknown[] = []): Promise<T> => {
  const result = await client.query<{ v: T }>(sql, params);
  const row = result.rows[0];
  if (row === undefined) throw new Error(`no row from ${sql}`);
  return row.v;
};

/** A sign-in account with no profile -- what `admin-accounts` makes -- inside the transaction. */
const makeAccount = async (
  client: Client,
  confirmed = true,
): Promise<{ id: string; email: string }> =>
  withIdentityLock(async () => {
    const id = randomUUID();
    const email = `console-admin-${id.slice(0, 8)}@example.test`;
    await asOwner(client, async () => {
      await client.query(
        `insert into auth.users (id, email, aud, role, email_confirmed_at)
         values ($1, $2, 'authenticated', 'authenticated', $3)`,
        [id, email, confirmed ? new Date().toISOString() : null],
      );
    });
    return { id, email };
  });

const BEGIN =
  'select public.admin_begin_user_creation($1, $2, $3::public.app_role, $4, $5, $6) as v';
const FINISH = 'select public.admin_finish_user_creation($1) as v';
const UPDATE = 'select public.admin_update_user($1, $2, $3::public.app_role, $4, $5, $6, $7) as v';
const ACTIVE = 'select public.admin_set_user_active($1, $2, $3) as v';

// =============================================================================
// BE-W185 — users and roles
// =============================================================================

describe.skipIf(!reachable)('BE-W185 — who may read and change users', () => {
  it('the admin lists their own company, with emails, and the read is audited with its reason', async () => {
    await asTx(world.users.admin, async (client) => {
      const list = AdminUserListSchema.parse(
        await one(client, 'select public.admin_list_users($1) as v', ['console users screen']),
      );
      const ids = list.users.map((u) => u.id);
      expect(ids).toContain(world.users.puneMr.id);
      expect(ids).toContain(world.users.westManager.id);
      expect(ids).not.toContain(world.users.rivalMr.id);
      expect(ids).not.toContain(world.users.rivalAdmin.id);
      const pune = list.users.find((u) => u.id === world.users.puneMr.id);
      expect(pune).toMatchObject({
        email: world.users.puneMr.email,
        role: 'mr',
        territoryId: world.territories.pune,
        managerId: world.users.westManager.id,
        isActive: true,
        confirmed: true,
      });
      const audit = await asOwner(client, () =>
        client.query('select reason from public.audit_log where id = $1', [list.auditLogId]),
      );
      expect(audit.rows[0]).toEqual({ reason: 'console users screen' });
    });
  });

  it('a manager, a rep and an anonymous caller are refused', async () => {
    for (const user of [world.users.westManager, world.users.puneMr]) {
      await asTx(user, async (client) => {
        const f = await failure(client, 'select public.admin_list_users($1)', ['x']);
        expectRefusal(f, '42501', /not_an_admin/u);
      });
    }
    await inRolledBackTransaction(async (client) => {
      await client.query('set local role anon');
      expect((await failure(client, 'select public.admin_list_users($1)', ['x'])).code).toBe(
        '42501',
      );
    });
  });

  it('the rival admin can neither read nor change our users', async () => {
    await asTx(world.users.rivalAdmin, async (client) => {
      const list = AdminUserListSchema.parse(
        await one(client, 'select public.admin_list_users($1) as v', ['rival']),
      );
      expect(list.users.map((u) => u.id)).not.toContain(world.users.puneMr.id);
      const f = await failure(client, ACTIVE, [world.users.puneMr.id, false, 'not yours']);
      expectRefusal(f, '42501', /user_not_found/u);
    });
  });
});

describe.skipIf(!reachable)(
  'BE-W185 — the runbook’s five silent mistakes are refused by name',
  () => {
    it('1. the admin role without the email typed again', async () => {
      await asTx(world.users.admin, async (client) => {
        const email = `second-${randomUUID().slice(0, 6)}@example.test`;
        const f = await failure(client, BEGIN, [
          email,
          'Second',
          'admin',
          null,
          null,
          'other@example.test',
        ]);
        expectRefusal(f, '22023', /admin_confirmation_mismatch/u);
        // And the same check on promotion.
        const g = await failure(client, UPDATE, [
          world.users.puneMr.id,
          'Pune',
          'admin',
          null,
          null,
          'wrong@example.test',
          'promote',
        ]);
        expect(g.message).toMatch(/admin_confirmation_mismatch/u);
      });
    });

    it('2. a rep on a Region or National territory, rather than an Area/Territory', async () => {
      await asTx(world.users.admin, async (client) => {
        for (const territory of [world.territories.west, world.territories.national]) {
          const f = await failure(client, BEGIN, [
            'x@example.test',
            'X',
            'mr',
            territory,
            world.users.westManager.id,
            null,
          ]);
          expectRefusal(f, '22023', /territory_level_for_rep/u);
        }
      });
    });

    it('3. a territory that is not the company’s — the "mistyped code" is an id that does not fit', async () => {
      await asTx(world.users.admin, async (client) => {
        for (const territory of [world.territories.rival, randomUUID()]) {
          const f = await failure(client, BEGIN, [
            'x@example.test',
            'X',
            'field_manager',
            territory,
            null,
            null,
          ]);
          expectRefusal(f, '42501', /territory_not_in_organisation/u);
        }
      });
    });

    it('4. a rep with no reporting manager, or one who does not cover the territory', async () => {
      await asTx(world.users.admin, async (client) => {
        const none = await failure(client, BEGIN, [
          'x@example.test',
          'X',
          'mr',
          world.territories.pune,
          null,
          null,
        ]);
        expect(none.message).toMatch(/rep_needs_manager/u);
        const wrong = await failure(client, BEGIN, [
          'x@example.test',
          'X',
          'mr',
          world.territories.pune,
          world.users.southManager.id,
          null,
        ]);
        expect(wrong.message).toMatch(/manager_does_not_cover_territory/u);
        const rival = await failure(client, BEGIN, [
          'x@example.test',
          'X',
          'mr',
          world.territories.pune,
          world.users.rivalAdmin.id,
          null,
        ]);
        expect(rival.message).toMatch(/manager_invalid/u);
      });
    });

    it('5. an unconfirmed account is refused at finish, and stays listed as not finished', async () => {
      await asTx(world.users.admin, async (client) => {
        const account = await makeAccount(client, false);
        const started = UserCreationStartSchema.parse(
          await one(client, BEGIN, [
            account.email,
            'Unconfirmed',
            'field_manager',
            world.territories.south,
            null,
            null,
          ]),
        );
        expect(started.existingAccount).toBe(true);
        const f = await failure(client, FINISH, [started.provisioningId]);
        expectRefusal(f, '22023', /account_unconfirmed/u);
        const list = AdminUserListSchema.parse(
          await one(client, 'select public.admin_list_users($1) as v', ['check pending']),
        );
        expect(list.pending).toEqual([
          expect.objectContaining({
            id: started.provisioningId,
            email: account.email,
            accountExists: true,
            accountConfirmed: false,
            accountHasProfile: false,
          }),
        ]);
      });
    });
  },
);

describe.skipIf(!reachable)('BE-W185 — creating a user end to end', () => {
  it('begin -> account -> finish makes the profile in the admin’s company, audited twice', async () => {
    await asTx(world.users.admin, async (client) => {
      const email = `New.Rep.${randomUUID().slice(0, 6)}@Example.test`;
      const started = UserCreationStartSchema.parse(
        await one(client, BEGIN, [
          ` ${email} `,
          'New Rep',
          'mr',
          world.territories.nagpur,
          world.users.westManager.id,
          null,
        ]),
      );
      expect(started.email).toBe(email.toLowerCase());
      expect(started.existingAccount).toBe(false);

      // Not finishable before the account exists: the Edge Function's GoTrue half has not run.
      expect((await failure(client, FINISH, [started.provisioningId])).message).toMatch(
        /account_missing/u,
      );

      const id = await withIdentityLock(async () => {
        const accountId = randomUUID();
        await asOwner(client, () =>
          client.query(
            `insert into auth.users (id, email, aud, role, email_confirmed_at)
             values ($1, $2, 'authenticated', 'authenticated', now())`,
            [accountId, started.email],
          ),
        );
        return accountId;
      });
      const user = AdminUserSchema.parse(await one(client, FINISH, [started.provisioningId]));
      expect(user).toMatchObject({
        id,
        email: started.email,
        role: 'mr',
        territoryId: world.territories.nagpur,
        managerId: world.users.westManager.id,
        isActive: true,
        confirmed: true,
      });

      const rows = await asOwner(client, () =>
        client.query<{ organisation_id: string; state: string; actor: number; reasoned: number }>(
          `select p.organisation_id,
                  (select v.state from public.user_provisioning v where v.id = $2) as state,
                  (select count(*)::int from public.audit_log l
                    where l.table_name = 'user_profiles' and l.row_id = $1::text
                      and l.action = 'insert' and l.actor_id = $3 and l.reason is null) as actor,
                  (select count(*)::int from public.audit_log l
                    where l.table_name = 'user_profiles' and l.row_id = $1::text
                      and l.reason like 'created %') as reasoned
             from public.user_profiles p where p.id = $1`,
          [id, started.provisioningId, world.users.admin.id],
        ),
      );
      expect(rows.rows[0]).toEqual({
        organisation_id: world.organisationId,
        state: 'completed',
        actor: 1,
        reasoned: 1,
      });
      // Finishing twice is refused, not repeated.
      expect((await failure(client, FINISH, [started.provisioningId])).message).toMatch(
        /provisioning_closed/u,
      );
    });
  });

  it('the SECOND admin (four-eyes) is made from the screen, with no territory', async () => {
    await asTx(world.users.admin, async (client) => {
      const account = await makeAccount(client);
      const started = UserCreationStartSchema.parse(
        await one(client, BEGIN, [
          account.email,
          'Second Admin',
          'admin',
          null,
          null,
          account.email.toUpperCase(),
        ]),
      );
      const user = AdminUserSchema.parse(await one(client, FINISH, [started.provisioningId]));
      expect(user).toMatchObject({
        role: 'admin',
        territoryId: null,
        managerId: null,
        isActive: true,
      });
      const admins = await asOwner(client, () =>
        client.query<{ n: number }>(
          `select count(*)::int as n from public.user_profiles
            where organisation_id = $1 and role = 'admin' and is_active`,
          [world.organisationId],
        ),
      );
      expect(admins.rows[0]?.n).toBe(2);
    });
  });

  it('an address that already has a profile, or a creation already open, is refused 23505', async () => {
    await asTx(world.users.admin, async (client) => {
      const taken = await failure(client, BEGIN, [
        world.users.puneMr.email,
        'Again',
        'field_manager',
        world.territories.south,
        null,
        null,
      ]);
      expectRefusal(taken, '23505', /account_exists/u);

      const email = `twice-${randomUUID().slice(0, 6)}@example.test`;
      await one(client, BEGIN, [
        email,
        'Twice',
        'field_manager',
        world.territories.south,
        null,
        null,
      ]);
      const twice = await failure(client, BEGIN, [
        email,
        'Twice',
        'field_manager',
        world.territories.south,
        null,
        null,
      ]);
      expectRefusal(twice, '23505', /provisioning_open/u);
    });
  });

  it('a started creation can be cancelled, with a reason, and leaves the pending list', async () => {
    await asTx(world.users.admin, async (client) => {
      const started = UserCreationStartSchema.parse(
        await one(client, BEGIN, [
          `cancel-${randomUUID().slice(0, 6)}@example.test`,
          'C',
          'field_manager',
          world.territories.south,
          null,
          null,
        ]),
      );
      expect(
        (
          await failure(client, 'select public.admin_cancel_user_creation($1, $2)', [
            started.provisioningId,
            '',
          ])
        ).message,
      ).toMatch(/reason_required/u);
      await client.query('select public.admin_cancel_user_creation($1, $2)', [
        started.provisioningId,
        'typo in the address',
      ]);
      const list = AdminUserListSchema.parse(
        await one(client, 'select public.admin_list_users($1) as v', ['x']),
      );
      expect(list.pending.map((p) => p.id)).not.toContain(started.provisioningId);
    });
  });

  it('the rival admin cannot finish or cancel our creation', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.admin);
      const started = UserCreationStartSchema.parse(
        await one(client, BEGIN, [
          `ours-${randomUUID().slice(0, 6)}@example.test`,
          'Ours',
          'field_manager',
          world.territories.south,
          null,
          null,
        ]),
      );
      await asUser(client, world.users.rivalAdmin);
      expect((await failure(client, FINISH, [started.provisioningId])).code).toBe('42501');
      expect(
        (
          await failure(client, 'select public.admin_cancel_user_creation($1, $2)', [
            started.provisioningId,
            'not mine',
          ])
        ).code,
      ).toBe('42501');
    });
  });
});

describe.skipIf(!reachable)('BE-W185 — changing and deactivating users', () => {
  it('an admin cannot change their own role or deactivate themselves', async () => {
    await asTx(world.users.admin, async (client) => {
      const role = await failure(client, UPDATE, [
        world.users.admin.id,
        'Me',
        'field_manager',
        world.territories.west,
        null,
        null,
        'demote me',
      ]);
      expectRefusal(role, '42501', /self_role_change/u);
      const off = await failure(client, ACTIVE, [world.users.admin.id, false, 'leaving']);
      expectRefusal(off, '42501', /self_deactivate/u);
    });
  });

  it('a manager with active reps can be neither made a rep, deactivated, nor moved away from them', async () => {
    await asTx(world.users.admin, async (client) => {
      const m = world.users.westManager;
      expect(
        (
          await failure(client, UPDATE, [
            m.id,
            'W',
            'mr',
            world.territories.pune,
            world.users.admin.id,
            null,
            'demote',
          ])
        ).message,
      ).toMatch(/has_reports: 2/u);
      expect((await failure(client, ACTIVE, [m.id, false, 'left'])).message).toMatch(
        /has_reports: 2/u,
      );
      expect(
        (
          await failure(client, UPDATE, [
            m.id,
            'W',
            'field_manager',
            world.territories.south,
            null,
            null,
            'move',
          ])
        ).message,
      ).toMatch(/reports_outside_territory/u);
    });
  });

  it('a change needs a reason, is checked as a whole, and is audited with the reason', async () => {
    await asTx(world.users.admin, async (client) => {
      const mr = world.users.nagpurMr;
      expect(
        (
          await failure(client, UPDATE, [
            mr.id,
            'N',
            'mr',
            world.territories.nagpur,
            world.users.westManager.id,
            null,
            '',
          ])
        ).message,
      ).toMatch(/reason_required/u);
      // Moving a rep to a territory their manager does not cover is refused as a combination.
      expect(
        (
          await failure(client, UPDATE, [
            mr.id,
            'N',
            'mr',
            world.territories.south,
            world.users.westManager.id,
            null,
            'move',
          ])
        ).message,
      ).toMatch(/manager_does_not_cover_territory/u);
      const moved = AdminUserSchema.parse(
        await one(client, UPDATE, [
          mr.id,
          'Nagpur Rep',
          'mr',
          world.territories.south,
          world.users.southManager.id,
          null,
          'covering South',
        ]),
      );
      expect(moved).toMatchObject({
        territoryId: world.territories.south,
        managerId: world.users.southManager.id,
        fullName: 'Nagpur Rep',
      });
      const audit = await asOwner(client, () =>
        client.query<{ n: number }>(
          `select count(*)::int as n from public.audit_log
            where table_name = 'user_profiles' and row_id = $1::text and reason like '%covering South%'`,
          [mr.id],
        ),
      );
      expect(audit.rows[0]?.n).toBe(1);
    });
  });

  it('deactivation removes all access at once (effective_role is null); reactivation restores it', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.admin);
      const off = AdminUserSchema.parse(
        await one(client, ACTIVE, [world.users.southMr.id, false, 'left the company']),
      );
      expect(off.isActive).toBe(false);
      await asUser(client, world.users.southMr);
      expect(await one(client, 'select public.effective_role() as v')).toBeNull();
      await asUser(client, world.users.admin);
      const on = AdminUserSchema.parse(
        await one(client, ACTIVE, [world.users.southMr.id, true, 'came back']),
      );
      expect(on.isActive).toBe(true);
      await asUser(client, world.users.southMr);
      expect(await one(client, 'select public.effective_role() as v')).toBe('mr');
    });
  });

  it('a password reset is authorised for the company’s users only, never one’s own, and audited', async () => {
    await asTx(world.users.admin, async (client) => {
      const ok = await one<{ userId: string; email: string }>(
        client,
        'select public.admin_authorize_password_reset($1, $2) as v',
        [world.users.puneMr.id, 'deactivated: left'],
      );
      expect(ok).toEqual({ userId: world.users.puneMr.id, email: world.users.puneMr.email });
      expect(
        (
          await failure(client, 'select public.admin_authorize_password_reset($1, $2)', [
            world.users.admin.id,
            'mine please',
          ])
        ).message,
      ).toMatch(/self_password_reset/u);
      expect(
        (
          await failure(client, 'select public.admin_authorize_password_reset($1, $2)', [
            world.users.rivalMr.id,
            'curious',
          ])
        ).code,
      ).toBe('42501');
    });
  });

  it('deleting a profile stays impossible: nothing here offers it', async () => {
    await inRolledBackTransaction(async (client) => {
      const fns = await client.query<{ proname: string }>(
        `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and proname like 'admin\\_%' and proname ~ '(delete|remove)'`,
      );
      expect(fns.rows).toEqual([]);
    });
  });
});

// =============================================================================
// BE-W187 — territories and hours
// =============================================================================

const tree = async (client: Client) =>
  TerritoryTreeSchema.parse(await one(client, 'select public.territory_tree() as v'));

describe.skipIf(!reachable)('BE-W187 — who sees the tree', () => {
  it('an admin sees the company’s tree and may edit; a manager sees their subtree read-only', async () => {
    await asTx(world.users.admin, async (client) => {
      const t = await tree(client);
      expect(t.canEdit).toBe(true);
      expect(new Set(t.territories.map((n) => n.id))).toEqual(
        new Set([
          world.territories.national,
          world.territories.west,
          world.territories.pune,
          world.territories.nagpur,
          world.territories.south,
        ]),
      );
      const pune = t.territories.find((n) => n.id === world.territories.pune);
      expect(pune).toMatchObject({ depth: 3, reps: 1, children: 0 });
    });
    await asTx(world.users.westManager, async (client) => {
      const t = await tree(client);
      expect(t.canEdit).toBe(false);
      expect(new Set(t.territories.map((n) => n.id))).toEqual(
        new Set([world.territories.west, world.territories.pune, world.territories.nagpur]),
      );
      expect(
        (
          await failure(client, 'select public.admin_rename_territory($1, $2)', [
            world.territories.west,
            'Mine',
          ])
        ).code,
      ).toBe('42501');
    });
  });

  it('a rep is refused; the rival admin sees only their own tree', async () => {
    await asTx(world.users.puneMr, async (client) => {
      expect((await failure(client, 'select public.territory_tree()')).code).toBe('42501');
    });
    await asTx(world.users.rivalAdmin, async (client) => {
      expect((await tree(client)).territories.map((n) => n.id)).toEqual([world.territories.rival]);
      expect(
        (
          await failure(client, 'select public.admin_rename_territory($1, $2)', [
            world.territories.pune,
            'Ours now',
          ])
        ).code,
      ).toBe('42501');
    });
  });
});

describe.skipIf(!reachable)('BE-W187 — the level rules, the codes, and no deletes', () => {
  const CREATE = 'select public.admin_create_territory($1, $2, $3) as v';

  it('National -> Region -> Area/Territory, and nothing beneath that', async () => {
    await asTx(world.users.admin, async (client) => {
      const run = randomUUID().slice(0, 6).toUpperCase();
      const nat = await one<{ id: string; depth: number }>(client, CREATE, [
        'India 2',
        `N-${run}`,
        null,
      ]);
      const reg = await one<{ id: string; depth: number }>(client, CREATE, [
        'East',
        `n-${run}-e`,
        nat.id,
      ]);
      const area = await one<{ id: string; depth: number; code: string }>(client, CREATE, [
        'Kolkata',
        `N-${run}-E-KOL`,
        reg.id,
      ]);
      expect([nat.depth, reg.depth, area.depth]).toEqual([1, 2, 3]);
      expect(area.code).toBe(`N-${run}-E-KOL`);
      const deeper = await failure(client, CREATE, ['Ward', `N-${run}-W1`, area.id]);
      expectRefusal(deeper, '22023', /territory_too_deep/u);
    });
  });

  it('nothing goes beneath a territory a rep sits on', async () => {
    await asTx(world.users.admin, async (client) => {
      const run = randomUUID().slice(0, 6).toUpperCase();
      // A two-level branch: a rep on its lower level, which is that branch's bottom.
      const leaf = await one<{ id: string }>(client, CREATE, [
        'Goa',
        `G-${run}`,
        world.territories.national,
      ]);
      await asOwner(client, () =>
        client.query('update public.user_profiles set territory_id = $1 where id = $2', [
          leaf.id,
          world.users.southMr.id,
        ]),
      );
      const f = await failure(client, CREATE, ['North Goa', `G-${run}-N`, leaf.id]);
      expectRefusal(f, '22023', /parent_has_reps/u);
    });
  });

  it('a code is unique across EVERY company, case-insensitively; EXAMPLE- codes are refused', async () => {
    await asTx(world.users.admin, async (client) => {
      const rivalCode = await asOwner(client, () =>
        client.query<{ code: string }>('select code from public.territories where id = $1', [
          world.territories.rival,
        ]),
      );
      const f = await failure(client, CREATE, [
        'Copy',
        rivalCode.rows[0]?.code.toLowerCase(),
        null,
      ]);
      expectRefusal(f, '23505', /territory_code_taken/u);
      expect((await failure(client, CREATE, ['Ex', 'EXAMPLE-1', null])).message).toMatch(
        /territory_code_invalid/u,
      );
      expect((await failure(client, CREATE, ['Bad', 'has space', null])).message).toMatch(
        /territory_code_invalid/u,
      );
    });
  });

  it('a parent from the rival company is refused', async () => {
    await asTx(world.users.admin, async (client) => {
      const f = await failure(client, CREATE, [
        'Sneak',
        `S-${randomUUID().slice(0, 6)}`,
        world.territories.rival,
      ]);
      expect(f.code).toBe('42501');
    });
  });

  it('no territory is deletable: even an empty one is refused by the append-only settings cascade', async () => {
    // The reason the migration offers no delete. A positive control for the comment that says so.
    await inRolledBackTransaction(async (client) => {
      const id = randomUUID();
      await client.query(
        `insert into public.territories (id, name, code, parent_id, organisation_id) values ($1, 'Empty', $2, null, $3)`,
        [id, `EMPTY-${id.slice(0, 8)}`, world.organisationId],
      );
      const f = await failure(client, 'delete from public.territories where id = $1', [id]);
      expect(f.code).toBe('23001');
    });
  });
});

describe.skipIf(!reachable)('BE-W187 — working hours', () => {
  const SET =
    'select public.admin_set_territory_hours($1, $2::time, $3::time, $4, $5, $6::smallint[]) as v';

  it('set on a Region, inherited by its Areas; cleared, the Areas fall back', async () => {
    await asTx(world.users.admin, async (client) => {
      const own = await one<{ ownHours: unknown }>(client, SET, [
        world.territories.west,
        '08:30',
        '17:30',
        'Asia/Kolkata',
        10,
        '{1,2,3,4,5,5}',
      ]);
      expect(own.ownHours).toEqual({
        shiftStart: '08:30:00',
        shiftEnd: '17:30:00',
        timezone: 'Asia/Kolkata',
        graceMinutes: 10,
        activeWeekdays: [1, 2, 3, 4, 5],
      });
      const pune = (await tree(client)).territories.find((n) => n.id === world.territories.pune);
      expect(pune?.ownHours).toBeNull();
      expect(pune?.hours).toMatchObject({
        source: 'territory',
        resolvedFromTerritoryId: world.territories.west,
        shiftStart: '08:30:00',
      });
      // The function the check-in path uses agrees -- one rule, read twice.
      const resolved = await one<string>(
        client,
        'select (select resolved_from_territory_id::text from public.resolve_shift_window($1)) as v',
        [world.territories.pune],
      );
      expect(resolved).toBe(world.territories.west);

      const cleared = await one<{
        ownHours: unknown;
        hours: { resolvedFromTerritoryId: string | null } | null;
      }>(client, 'select public.admin_clear_territory_hours($1) as v', [world.territories.west]);
      expect(cleared.ownHours).toBeNull();
      expect(cleared.hours?.resolvedFromTerritoryId ?? null).not.toBe(world.territories.west);
    });
  });

  it('impossible hours, an unknown zone and no working day are refused by name', async () => {
    await asTx(world.users.admin, async (client) => {
      const t = world.territories.south;
      expect(
        (await failure(client, SET, [t, '18:00', '09:00', 'Asia/Kolkata', 15, '{1}'])).message,
      ).toMatch(/hours_invalid/u);
      expect(
        (await failure(client, SET, [t, '09:00', '18:00', 'Mars/Olympus', 15, '{1}'])).message,
      ).toMatch(/timezone_unknown/u);
      expect(
        (await failure(client, SET, [t, '09:00', '18:00', 'Asia/Kolkata', 15, '{}'])).message,
      ).toMatch(/weekdays_invalid/u);
      expect(
        (await failure(client, SET, [t, '09:00', '18:00', 'Asia/Kolkata', 999, '{1}'])).message,
      ).toMatch(/grace_invalid/u);
    });
  });
});

// =============================================================================
// BE-W188 — the audit search
// =============================================================================

const SEARCH =
  'select public.search_audit_log($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz) as v';

describe.skipIf(!reachable)('BE-W188 — the audit log, searched', () => {
  it('filters by actor, table and action; pages; never shows the rival company; audits itself', async () => {
    await asTx(world.users.admin, async (client) => {
      // Two changes of our own to find, and one of the rival admin's that must never appear.
      await client.query(ACTIVE, [world.users.southMr.id, false, 'audit search probe one']);
      await client.query(ACTIVE, [world.users.southMr.id, true, 'audit search probe two']);
      await asUser(client, world.users.rivalAdmin);
      await client.query('select public.admin_list_users($1)', ['rival read for the probe']);
      await asUser(client, world.users.admin);

      const mine = AuditSearchSchema.parse(
        await one(client, SEARCH, [
          'audit screen',
          50,
          null,
          world.users.admin.id,
          'user_profiles',
          'update',
          null,
          null,
        ]),
      );
      expect(mine.data.length).toBeGreaterThanOrEqual(4);
      expect(
        mine.data.every(
          (r) =>
            r.actorId === world.users.admin.id &&
            r.tableName === 'user_profiles' &&
            r.action === 'update',
        ),
      ).toBe(true);
      expect(mine.data.map((r) => r.reason)).toEqual(
        expect.arrayContaining([expect.stringMatching(/audit search probe two/u)]),
      );
      expect(mine.data[0]?.actorName).toBe(world.users.admin.fullName);

      const all = AuditSearchSchema.parse(
        await one(client, SEARCH, ['audit screen', 200, null, null, null, null, null, null]),
      );
      expect(all.data.some((r) => r.actorId === world.users.rivalAdmin.id)).toBe(false);
      expect(all.tables).toContain('user_profiles');
      const self = await asOwner(client, () =>
        client.query('select reason, table_name from public.audit_log where id = $1', [
          all.auditLogId,
        ]),
      );
      expect(self.rows[0]).toEqual({ reason: 'audit screen', table_name: 'audit_log' });

      // Pages: a page of 2, then the next from its cursor, with no overlap.
      const first = AuditSearchSchema.parse(
        await one(client, SEARCH, ['page', 2, null, world.users.admin.id, null, null, null, null]),
      );
      expect(first.data).toHaveLength(2);
      expect(first.nextBeforeId).not.toBeNull();
      const second = AuditSearchSchema.parse(
        await one(client, SEARCH, [
          'page',
          2,
          first.nextBeforeId,
          world.users.admin.id,
          null,
          null,
          null,
          null,
        ]),
      );
      expect(Math.max(...second.data.map((r) => r.id))).toBeLessThan(
        Math.min(...first.data.map((r) => r.id)),
      );

      // A date range in the future finds nothing; one ending before it starts is refused.
      const future = AuditSearchSchema.parse(
        await one(client, SEARCH, ['range', 50, null, null, null, null, '2099-01-01', null]),
      );
      expect(future.data).toEqual([]);
      expect(
        (
          await failure(client, SEARCH, [
            'range',
            50,
            null,
            null,
            null,
            null,
            '2030-01-02',
            '2030-01-01',
          ])
        ).message,
      ).toMatch(/range_invalid/u);
      expect(
        (await failure(client, SEARCH, ['x', 50, null, null, null, 'drop', null, null])).message,
      ).toMatch(/action_unknown/u);
      expect(
        (await failure(client, SEARCH, ['', 50, null, null, null, null, null, null])).code,
      ).toBe('22023');
    });
  });

  it('a manager and a rep are refused 42501', async () => {
    for (const user of [world.users.westManager, world.users.puneMr]) {
      await asTx(user, async (client) => {
        expect(
          (await failure(client, SEARCH, ['x', 50, null, null, null, null, null, null])).code,
        ).toBe('42501');
      });
    }
  });
});

// =============================================================================
// BE-W189 — the retention overview
// =============================================================================

describe.skipIf(!reachable)('BE-W189 — the retention worker, as an admin sees it', () => {
  it('shows each run, and per run only THIS company’s destroyed objects', async () => {
    await inRolledBackTransaction(async (client) => {
      const run = randomUUID();
      // One run that destroyed one object of ours and one of the rival's (owner-written fixtures).
      await client.query(
        `insert into public.audio_purge_runs (id, started_at, finished_at, claimed_count, destroyed_count)
         values ($1, now() + interval '1 hour', now() + interval '1 hour 1 minute', 2, 2)`,
        [run],
      );
      await client.query(
        `insert into public.audio_destruction_log (run_id, object_kind, object_id, visit_id, reason)
         values ($1, 'recording', $2, $3, 'retention'), ($1, 'recording', $4, $5, 'retention')`,
        [run, randomUUID(), world.visits.pune, randomUUID(), world.visits.rival],
      );
      for (const admin of [world.users.admin, world.users.rivalAdmin]) {
        await asUser(client, admin);
        const overview = RetentionOverviewSchema.parse(
          await one(client, 'select public.retention_overview($1, 5) as v', ['retention screen']),
        );
        const row = overview.runs.find((r) => r.id === run);
        expect(row).toMatchObject({ outcome: 'succeeded', destroyedForYou: 1 });
        expect(overview.retentionDays).toBeGreaterThan(0);
        expect(overview.appendOnlyTables).toEqual(
          expect.arrayContaining(['audit_log', 'audio_destruction_log']),
        );
        // No whole-system counts: MR-46 B3 withdrew exactly those.
        expect(JSON.stringify(overview.runs)).not.toMatch(/claimed|destroyedCount/u);
        await client.query('reset role');
      }
    });
  });

  it('a manager is refused, and so is a missing reason', async () => {
    await asTx(world.users.westManager, async (client) => {
      expect((await failure(client, 'select public.retention_overview($1)', ['x'])).code).toBe(
        '42501',
      );
    });
    await asTx(world.users.admin, async (client) => {
      expect((await failure(client, 'select public.retention_overview($1)', [''])).code).toBe(
        '22023',
      );
    });
  });
});
