import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { databaseIsReachable, inRolledBackTransaction } from './db.js';

/**
 * BE-W1 foundations.
 *
 * These prove the schema and the two helper functions behave as specified. They
 * are NOT the Gate 0 suite — the adversarial RLS tests (permission denied, not an
 * empty result, from five different attack paths) are BE-W2 and live in rls.spec.ts.
 */

let reachable = false;

beforeAll(async () => {
  reachable = await databaseIsReachable();
  if (!reachable) {
    console.warn('No database at SUPABASE_DB_URL — skipping. Run `pnpm db:start` first.');
  }
});

const TERRITORY_NATIONAL = '10000000-0000-4000-8000-000000000001';
const TERRITORY_WEST = '10000000-0000-4000-8000-000000000002';
const TERRITORY_PUNE = '10000000-0000-4000-8000-000000000003';
const TERRITORY_NAGPUR = '10000000-0000-4000-8000-000000000004';
const TERRITORY_SOUTH = '10000000-0000-4000-8000-000000000005';

const USER_ADMIN = '20000000-0000-4000-8000-000000000001';
const USER_WEST_MANAGER = '20000000-0000-4000-8000-000000000002';
const USER_PUNE_MR = '20000000-0000-4000-8000-000000000003';
const USER_SOUTH_MR = '20000000-0000-4000-8000-000000000004';
const USER_INACTIVE_MR = '20000000-0000-4000-8000-000000000005';

const seed = async (client: Client): Promise<void> => {
  await client.query(
    `insert into public.territories (id, name, code, parent_id) values
       ($1, 'National',    'IN',           null),
       ($2, 'West',        'IN-WEST',      $1),
       ($3, 'Pune',        'IN-WEST-PUNE', $2),
       ($4, 'Nagpur',      'IN-WEST-NAG',  $2),
       ($5, 'South',       'IN-SOUTH',     $1)`,
    [TERRITORY_NATIONAL, TERRITORY_WEST, TERRITORY_PUNE, TERRITORY_NAGPUR, TERRITORY_SOUTH],
  );

  const users = [USER_ADMIN, USER_WEST_MANAGER, USER_PUNE_MR, USER_SOUTH_MR, USER_INACTIVE_MR];
  for (const [index, id] of users.entries()) {
    await client.query(
      `insert into auth.users (id, email, aud, role)
       values ($1, $2, 'authenticated', 'authenticated')`,
      [id, `w1-fixture-${String(index)}@example.test`],
    );
  }

  await client.query(
    `insert into public.user_profiles (id, full_name, role, territory_id, is_active) values
       ($1, 'Admin User',    'admin',         null, true),
       ($2, 'West Manager',  'field_manager', $6,   true),
       ($3, 'Pune MR',       'mr',            $7,   true),
       ($4, 'South MR',      'mr',            $8,   true),
       ($5, 'Inactive MR',   'mr',            $7,   false)`,
    [
      USER_ADMIN,
      USER_WEST_MANAGER,
      USER_PUNE_MR,
      USER_SOUTH_MR,
      USER_INACTIVE_MR,
      TERRITORY_WEST,
      TERRITORY_PUNE,
      TERRITORY_SOUTH,
    ],
  );
};

const visibleTerritories = async (client: Client, userId: string): Promise<string[]> => {
  const result = await client.query<{ id: string }>(
    'select public.visible_territory_ids($1) as id',
    [userId],
  );
  return result.rows.map((row) => row.id).sort();
};

describe('schema', () => {
  it('has exactly three roles in app_role', async () => {
    if (!reachable) return;
    await inRolledBackTransaction(async (client) => {
      const result = await client.query<{ label: string }>(
        `select e.enumlabel as label
           from pg_enum e
           join pg_type t on t.oid = e.enumtypid
          where t.typname = 'app_role'
          order by e.enumsortorder`,
      );
      expect(result.rows.map((r) => r.label)).toEqual(['mr', 'field_manager', 'admin']);
    });
  });

  it('has no clinical or patient tables', async () => {
    if (!reachable) return;
    await inRolledBackTransaction(async (client) => {
      const result = await client.query<{ table_name: string }>(
        `select table_name from information_schema.tables
          where table_schema = 'public'
            and (table_name ilike '%patient%' or table_name ilike '%clinical%'
                 or table_name ilike '%diagnos%' or table_name ilike '%prescri%')`,
      );
      expect(result.rows).toEqual([]);
    });
  });

  it('has row-level security enabled on every public table', async () => {
    if (!reachable) return;
    await inRolledBackTransaction(async (client) => {
      const result = await client.query<{ relname: string }>(
        `select c.relname
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false`,
      );
      expect(result.rows.map((r) => r.relname)).toEqual([]);
    });
  });

  it('grants no write privilege on either table to authenticated', async () => {
    if (!reachable) return;
    await inRolledBackTransaction(async (client) => {
      const result = await client.query<{ table_name: string; privilege_type: string }>(
        `select table_name, privilege_type
           from information_schema.role_table_grants
          where grantee = 'authenticated'
            and table_schema = 'public'
            and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')`,
      );
      expect(result.rows).toEqual([]);
    });
  });

  it('rejects an mr or field_manager with no territory', async () => {
    if (!reachable) return;
    await inRolledBackTransaction(async (client) => {
      await client.query(
        `insert into auth.users (id, email, aud, role)
         values ('30000000-0000-4000-8000-000000000001', 'no-territory@example.test',
                 'authenticated', 'authenticated')`,
      );
      await expect(
        client.query(
          `insert into public.user_profiles (id, full_name, role, territory_id)
           values ('30000000-0000-4000-8000-000000000001', 'Scopeless MR', 'mr', null)`,
        ),
      ).rejects.toThrow(/user_profiles_field_roles_require_territory/);
    });
  });
});

describe('visible_territory_ids', () => {
  it('gives an MR exactly their own territory', async () => {
    if (!reachable) return;
    await inRolledBackTransaction(async (client) => {
      await seed(client);
      expect(await visibleTerritories(client, USER_PUNE_MR)).toEqual([TERRITORY_PUNE]);
    });
  });

  it('gives a field manager their own territory plus the whole subtree', async () => {
    if (!reachable) return;
    await inRolledBackTransaction(async (client) => {
      await seed(client);
      expect(await visibleTerritories(client, USER_WEST_MANAGER)).toEqual(
        [TERRITORY_WEST, TERRITORY_PUNE, TERRITORY_NAGPUR].sort(),
      );
    });
  });

  it('does not give a field manager a sibling subtree', async () => {
    if (!reachable) return;
    await inRolledBackTransaction(async (client) => {
      await seed(client);
      const visible = await visibleTerritories(client, USER_WEST_MANAGER);
      expect(visible).not.toContain(TERRITORY_SOUTH);
      expect(visible).not.toContain(TERRITORY_NATIONAL);
    });
  });

  it('gives an admin every territory', async () => {
    if (!reachable) return;
    await inRolledBackTransaction(async (client) => {
      await seed(client);
      expect(await visibleTerritories(client, USER_ADMIN)).toHaveLength(5);
    });
  });

  it('gives a deactivated user nothing', async () => {
    if (!reachable) return;
    await inRolledBackTransaction(async (client) => {
      await seed(client);
      expect(await visibleTerritories(client, USER_INACTIVE_MR)).toEqual([]);
    });
  });

  it('gives an unknown user nothing', async () => {
    if (!reachable) return;
    await inRolledBackTransaction(async (client) => {
      await seed(client);
      expect(await visibleTerritories(client, '40000000-0000-4000-8000-00000000ffff')).toEqual([]);
    });
  });

  it('is not executable by the authenticated role', async () => {
    if (!reachable) return;
    await inRolledBackTransaction(async (client) => {
      const result = await client.query<{ has: boolean }>(
        `select has_function_privilege(
                  'authenticated',
                  'public.visible_territory_ids(uuid)',
                  'execute') as has`,
      );
      expect(result.rows[0]?.has).toBe(false);
    });
  });
});

describe('current_app_role', () => {
  const withClaims = async (claims: string | null): Promise<string | null> => {
    let role: string | null = null;
    await inRolledBackTransaction(async (client) => {
      await client.query('select set_config($1, $2, true)', ['request.jwt.claims', claims ?? '']);
      const result = await client.query<{ role: string | null }>(
        'select public.current_app_role()::text as role',
      );
      role = result.rows[0]?.role ?? null;
    });
    return role;
  };

  it('returns the role carried in the app_role claim', async () => {
    if (!reachable) return;
    expect(await withClaims(JSON.stringify({ app_role: 'field_manager' }))).toBe('field_manager');
  });

  it('returns null when there is no app_role claim', async () => {
    if (!reachable) return;
    expect(await withClaims(JSON.stringify({ sub: USER_PUNE_MR }))).toBeNull();
  });

  it('returns null for an unauthenticated caller', async () => {
    if (!reachable) return;
    expect(await withClaims(null)).toBeNull();
  });
});

describe('custom_access_token_hook', () => {
  it('adds the role, territory and active flag to the claims', async () => {
    if (!reachable) return;
    await inRolledBackTransaction(async (client) => {
      await seed(client);
      const result = await client.query<{ claims: Record<string, unknown> }>(
        `select public.custom_access_token_hook(
                  jsonb_build_object('user_id', $1::text, 'claims', '{}'::jsonb)
                ) -> 'claims' as claims`,
        [USER_PUNE_MR],
      );
      expect(result.rows[0]?.claims).toMatchObject({
        app_role: 'mr',
        app_is_active: true,
        app_territory_id: TERRITORY_PUNE,
      });
    });
  });

  it('adds no role claim for a user with no profile', async () => {
    if (!reachable) return;
    await inRolledBackTransaction(async (client) => {
      const result = await client.query<{ claims: Record<string, unknown> }>(
        `select public.custom_access_token_hook(
                  jsonb_build_object('user_id', '40000000-0000-4000-8000-00000000ffff',
                                     'claims', '{}'::jsonb)
                ) -> 'claims' as claims`,
      );
      expect(result.rows[0]?.claims).toEqual({});
    });
  });

  it('is not executable by anon or authenticated', async () => {
    if (!reachable) return;
    await inRolledBackTransaction(async (client) => {
      const result = await client.query<{ grantee: string; has: boolean }>(
        `select g.grantee,
                has_function_privilege(
                  g.grantee,
                  'public.custom_access_token_hook(jsonb)',
                  'execute') as has
           from (values ('anon'), ('authenticated')) as g(grantee)`,
      );
      expect(result.rows.every((row) => !row.has)).toBe(true);
    });
  });
});
