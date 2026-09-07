import { describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';

/**
 * FIX-14 B — ONE guard for one root cause.
 *
 * Supabase's default privileges have now produced the same defect **seven** times:
 *
 *   FIX-05  65 functions in `public` executable by `anon`
 *   FIX-06  the `ALTER DEFAULT PRIVILEGES` meant to fix it, proved inert
 *   FIX-13  `anon` grants on a new TABLE, caught by `rls.spec.ts`
 *   FIX-13  TRUNCATE on the same table, caught by `foundations.spec.ts`
 *   FIX-14  UPDATE on three SEQUENCES, caught by neither
 *
 * The cause is one fact: the default ACL for new objects in `public` belongs to
 * `supabase_admin`, it grants `anon` explicitly rather than through `PUBLIC`, and
 * migrations run as `postgres`, which is refused when it tries to change it. **Every new
 * object is born reachable by `anon` and no migration can alter that.**
 *
 * Three guards grew up around that fact, each reading a different catalogue:
 * `information_schema.role_table_grants` (tables and views), `pg_proc` (functions), and
 * the TRUNCATE-specific query. **Sequences are in none of them**, which is why
 * `audit_log_id_seq` carried `UPDATE` to `anon` — the privilege that permits `setval()` —
 * from the migration that created it until FIX-14.
 *
 * Three mechanisms for one root cause means the next new object relies on whichever one
 * happens to cover it. This one enumerates every object in `public` from the catalogue and
 * asks `has_*_privilege('anon', …)` for each privilege that object class can carry.
 *
 * **It was written against the ACL columns first — `relacl`, `proacl`, `typacl`, `nspacl`
 * — and that was wrong, in the same direction as the defect it exists to catch.** A
 * freshly created function has `proacl = null`, meaning "the defaults apply", and
 * `aclexplode(null)` yields nothing: the guard reported a clean posture for exactly the
 * object FIX-05 found 65 of. The positive control below caught it, which is what a
 * positive control is for.
 *
 * `has_*_privilege` evaluates the effective privilege — explicit grants, grants inherited
 * through `PUBLIC`, and the defaults that materialise into no ACL row at all — so the
 * question it answers is the one that matters: **can `anon` do this**, not who wrote the
 * grant down.
 *
 * The older guards are left in place. They are cheap, they assert narrower properties in
 * their own contexts, and deleting a working control to celebrate a broader one is how the
 * broader one ends up being the only thing standing when it has a gap of its own.
 */

const reachable = await requireDatabase();

interface Grant {
  kind: string;
  object: string;
  privilege: string;
}

/**
 * Deliberately public, with a reason each.
 *
 * **An entry without a reason is a review failure, not a build failure** — the build
 * cannot tell a thought-through exception from a silenced one, and a test that demands
 * prose would only teach people to write prose. What the build CAN check is that the
 * allowlist is not carrying entries that no longer apply, which it does below.
 */
const DELIBERATELY_PUBLIC: ReadonlyArray<{
  kind: string;
  object: string;
  privilege: string;
  reason: string;
}> = [
  {
    kind: 'schema',
    object: 'public',
    privilege: 'USAGE',
    reason:
      'PostgREST resolves every request through the anon role before the JWT is applied, ' +
      'so USAGE on the schema is what makes an unauthenticated request reach a policy ' +
      'that can refuse it. Revoking it does not harden anything: it replaces every ' +
      'refusal with a 404 and breaks sign-in.',
  },
];

const key = (g: { kind: string; object: string; privilege: string }): string =>
  `${g.kind}|${g.object}|${g.privilege}`;

/**
 * Everything `anon` can actually do to anything in `public`.
 *
 * Enumerated from the catalogue and evaluated with `has_*_privilege`, so a grant that
 * exists only as a default — no ACL row anywhere — is reported like any other. Grants
 * reaching `anon` through `PUBLIC` are included, because `anon` is a member of `PUBLIC`
 * and the question is what it can do rather than how it came to be able to.
 */
const publicGrants = async (client: Client): Promise<Grant[]> => {
  const result = await client.query<Grant>(`
    with objects as (
      select case c.relkind
               when 'r' then 'table' when 'v' then 'view' when 'm' then 'matview'
               when 'S' then 'sequence' when 'f' then 'foreign table'
               when 'p' then 'partitioned table' else c.relkind::text end as kind,
             c.relname::text as object, c.oid, c.relkind
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r','v','m','S','f','p')
    ),
    rel as (
      select o.kind, o.object, p.privilege
        from objects o
        cross join lateral (
          select unnest(case when o.relkind = 'S'
                             then array['USAGE','SELECT','UPDATE']
                             else array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE',
                                        'REFERENCES','TRIGGER'] end) as privilege
        ) p
       where case when o.relkind = 'S'
                  then has_sequence_privilege('anon', o.oid, p.privilege)
                  else has_table_privilege('anon', o.oid, p.privilege) end
    ),
    fn as (
      select case p.prokind when 'p' then 'procedure' else 'function' end as kind,
             p.oid::regprocedure::text as object, 'EXECUTE'::text as privilege
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')
    ),
    ty as (
      select 'type'::text, t.typname::text, 'USAGE'::text
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
       where n.nspname = 'public'
         and t.typtype in ('b','c','d','e','r')
         and t.typacl is not null
         and has_type_privilege('anon', t.oid, 'USAGE')
    ),
    sch as (
      select 'schema'::text, n.nspname::text, p.privilege
        from pg_namespace n
        cross join lateral (select unnest(array['USAGE','CREATE']) as privilege) p
       where n.nspname = 'public' and has_schema_privilege('anon', n.oid, p.privilege)
    )
    select * from rel
    union all select * from fn
    union all select * from ty
    union all select * from sch
    order by 1, 2, 3
  `);
  return result.rows;
};

describe.skipIf(!reachable)('nothing in public is reachable by anon unless declared', () => {
  it('B3 positive control: a table created with the defaults IS anon-reachable', async () => {
    // Without this, a green result could mean the posture holds or could mean the query
    // returns nothing because it is broken. The same control FIX-06 put on the function
    // guard, applied to the query that now covers everything.
    await inRolledBackTransaction(async (client) => {
      await client.query('create table public.fix14_default_probe (i int)');
      const grants = await publicGrants(client);
      const probe = grants.filter((g) => g.object === 'fix14_default_probe');
      expect(probe.length).toBeGreaterThan(0);
      expect(probe.map((g) => g.privilege)).toContain('TRUNCATE');
    });
  });

  it('B3 positive control: a FUNCTION, whose ACL column is null and whose grant is real', async () => {
    // The case that rewrote this file. A newly created function has `proacl = null` --
    // "the defaults apply" -- so an ACL-column query sees nothing and reports a clean
    // posture for precisely the object class FIX-05 found 65 of.
    await inRolledBackTransaction(async (client) => {
      await client.query(
        'create function public.fix14_fn_probe() returns int language sql as $$ select 1 $$',
      );
      const acl = await client.query<{ proacl: string | null }>(
        `select proacl::text from pg_proc where proname = 'fix14_fn_probe'`,
      );
      expect(acl.rows[0]?.proacl).toBeNull();

      const grants = await publicGrants(client);
      expect(grants.map((g) => g.object)).toContain('fix14_fn_probe()');
    });
  });

  it('B3 positive control: a sequence too — the object class both old guards missed', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query('create sequence public.fix14_probe_seq');
      const grants = await publicGrants(client);
      const probe = grants.filter((g) => g.object === 'fix14_probe_seq');
      // UPDATE on a sequence is the privilege that carries setval(). Neither
      // `information_schema.role_table_grants` nor `pg_proc` reports this row.
      expect(probe.map((g) => g.privilege)).toContain('UPDATE');
    });
  });

  it('B1: every grant to anon or PUBLIC is on the allowlist', async () => {
    await inRolledBackTransaction(async (client) => {
      const grants = await publicGrants(client);
      const allowed = new Set(DELIBERATELY_PUBLIC.map(key));
      const undeclared = grants.filter((g) => !allowed.has(key(g)));
      // If this fails: the migration that created the named object needs its own
      // `revoke ... from anon, public`. Nothing in `public` is born safe -- the default
      // ACL belongs to supabase_admin and no migration can change it (FIX-06 D2).
      expect(undeclared.map(key)).toEqual([]);
    });
  });

  it('B2: every allowlist entry is still real, and carries a reason', async () => {
    // The allowlist is the part that rots. An entry for an object that no longer carries
    // the grant is a licence nobody is using, and the next reader treats the whole list
    // as approximate.
    await inRolledBackTransaction(async (client) => {
      const present = new Set((await publicGrants(client)).map(key));
      const stale = DELIBERATELY_PUBLIC.filter((entry) => !present.has(key(entry)));
      expect(stale.map(key)).toEqual([]);

      for (const entry of DELIBERATELY_PUBLIC) {
        expect(entry.reason.length, `${key(entry)} reason`).toBeGreaterThan(40);
      }
    });
  });

  it('covers every object class the catalogue can hold, not a chosen few', async () => {
    // A derivation control. If a future Postgres adds an ACL column this query does not
    // read, or a refactor drops one of the four unions, the guard silently narrows and
    // every assertion above keeps passing. This asserts the query still sees all four.
    await inRolledBackTransaction(async (client) => {
      await client.query('create table public.fix14_cover_probe (i int)');
      await client.query('create sequence public.fix14_cover_seq');
      await client.query(
        'create function public.fix14_cover_fn() returns int language sql as $$ select 1 $$',
      );
      const kinds = new Set((await publicGrants(client)).map((g) => g.kind));
      expect(kinds).toContain('table');
      expect(kinds).toContain('sequence');
      expect(kinds).toContain('function');
      expect(kinds).toContain('schema');
    });
  });
});
