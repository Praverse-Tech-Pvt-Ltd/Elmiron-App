import { describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';

/**
 * BE-W1 foundations.
 *
 * These prove the schema and the two helper functions behave as specified. They
 * are NOT the Gate 0 suite — the adversarial RLS tests are BE-W2 and live in
 * rls.spec.ts. See docs/amendment-gate0-criterion.md for the corrected pass
 * criterion: the property is non-disclosure and non-mutation, not the status code.
 */

// Resolved at collection time, not in beforeAll, so `describe.skipIf` can mark the
// tests as skipped in the summary rather than running them as no-op passes.
const reachable = await requireDatabase();

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

const ORGANISATION = '10000000-0000-4000-8000-0000000000ff';

const seed = async (client: Client): Promise<void> => {
  // territories.organisation_id became NOT NULL in BE-W2.
  await client.query(
    `insert into public.organisations (id, name) values ($1, 'W1 Fixture Pharma')`,
    [ORGANISATION],
  );

  await client.query(
    `insert into public.territories (id, name, code, parent_id, organisation_id) values
       ($1, 'National',    'IN',           null, $6),
       ($2, 'West',        'IN-WEST',      $1,   $6),
       ($3, 'Pune',        'IN-WEST-PUNE', $2,   $6),
       ($4, 'Nagpur',      'IN-WEST-NAG',  $2,   $6),
       ($5, 'South',       'IN-SOUTH',     $1,   $6)`,
    [
      TERRITORY_NATIONAL,
      TERRITORY_WEST,
      TERRITORY_PUNE,
      TERRITORY_NAGPUR,
      TERRITORY_SOUTH,
      ORGANISATION,
    ],
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

describe.skipIf(!reachable)('schema', () => {
  it('has exactly three roles in app_role', async () => {
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

  it('grants TRUNCATE on nothing in public, to anyone but the owner', async () => {
    // Supabase's default privileges hand `authenticated` and `anon` TRUNCATE on new
    // public tables, and TRUNCATE ignores row-level security entirely. Every
    // migration revokes it explicitly; this fails if one forgets.
    //
    // INSERT/UPDATE/DELETE are no longer part of this assertion: BE-W2 grants them
    // to `authenticated` and constrains them with policy. Who may actually write is
    // proved behaviourally in rls.spec.ts, not by reading the grant table.
    await inRolledBackTransaction(async (client) => {
      const result = await client.query<{ table_name: string; grantee: string }>(
        `select table_name, grantee
           from information_schema.role_table_grants
          where grantee in ('authenticated', 'anon')
            and table_schema = 'public'
            and privilege_type = 'TRUNCATE'`,
      );
      expect(result.rows).toEqual([]);
    });
  });

  it('rejects an mr or field_manager with no territory', async () => {
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

describe.skipIf(!reachable)('visible_territory_ids', () => {
  it('gives an MR exactly their own territory', async () => {
    await inRolledBackTransaction(async (client) => {
      await seed(client);
      expect(await visibleTerritories(client, USER_PUNE_MR)).toEqual([TERRITORY_PUNE]);
    });
  });

  it('gives a field manager their own territory plus the whole subtree', async () => {
    await inRolledBackTransaction(async (client) => {
      await seed(client);
      expect(await visibleTerritories(client, USER_WEST_MANAGER)).toEqual(
        [TERRITORY_WEST, TERRITORY_PUNE, TERRITORY_NAGPUR].sort(),
      );
    });
  });

  it('does not give a field manager a sibling subtree', async () => {
    await inRolledBackTransaction(async (client) => {
      await seed(client);
      const visible = await visibleTerritories(client, USER_WEST_MANAGER);
      expect(visible).not.toContain(TERRITORY_SOUTH);
      expect(visible).not.toContain(TERRITORY_NATIONAL);
    });
  });

  it('gives an admin every territory', async () => {
    await inRolledBackTransaction(async (client) => {
      await seed(client);
      // Compared against the live count, not a literal. rls.spec.ts commits its own
      // fixture territories, and the two files run in parallel — a hardcoded 5 was
      // a false failure waiting for the first day someone added a second spec.
      const total = await client.query<{ count: string }>(
        'select count(*) as count from public.territories',
      );
      const visible = await visibleTerritories(client, USER_ADMIN);
      expect(visible).toHaveLength(Number(total.rows[0]?.count));
      expect(visible.length).toBeGreaterThanOrEqual(5);
    });
  });

  it('gives a deactivated user nothing', async () => {
    await inRolledBackTransaction(async (client) => {
      await seed(client);
      expect(await visibleTerritories(client, USER_INACTIVE_MR)).toEqual([]);
    });
  });

  it('gives an unknown user nothing', async () => {
    await inRolledBackTransaction(async (client) => {
      await seed(client);
      expect(await visibleTerritories(client, '40000000-0000-4000-8000-00000000ffff')).toEqual([]);
    });
  });

  it('is not executable by the authenticated role', async () => {
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

describe.skipIf(!reachable)('current_app_role', () => {
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
    expect(await withClaims(JSON.stringify({ app_role: 'field_manager' }))).toBe('field_manager');
  });

  it('returns null when there is no app_role claim', async () => {
    expect(await withClaims(JSON.stringify({ sub: USER_PUNE_MR }))).toBeNull();
  });

  it('returns null for an unauthenticated caller', async () => {
    expect(await withClaims(null)).toBeNull();
  });
});

describe.skipIf(!reachable)('custom_access_token_hook', () => {
  it('adds the role, territory and active flag to the claims', async () => {
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
