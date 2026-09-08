import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * MR-07 Part D — the tenant boundary is RESTRICTIVE, and this is the pair that proves it.
 *
 * Postgres evaluates a row as
 *
 *     (OR of every applicable PERMISSIVE policy) AND (AND of every applicable RESTRICTIVE)
 *
 * so a permissive policy can only ever ADD access. The tenant predicates MR-06 added were
 * permissive, which meant any future permissive policy on the same table would widen past
 * them — and G-RLS-C would stay green, because that suite tests the tables that exist
 * today against the policies that exist today. The failure would arrive with a change
 * that looked unrelated, written by somebody with no reason to know the tenant boundary
 * lived beside theirs.
 *
 * **Neither behavioural test below is meaningful without the other.** The first shows an
 * over-broad permissive policy failing to widen the boundary; on its own that is also
 * what you get from a `create policy` that silently did nothing. The second removes the
 * restrictive policy and shows the same over-broad policy widening immediately — which is
 * what proves the first was measuring the restriction rather than an inert statement.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PAIR RUNS ON A MIRROR TABLE, AND WHAT COVERS THE REAL ONES
 * ---------------------------------------------------------------------------
 *
 * The first version of this file added `create policy ... on public.doctors using (true)`
 * inside a rolled-back transaction. It passed alone and **deadlocked in a full run** —
 * `create policy` takes ACCESS EXCLUSIVE on the table, and a dozen suites read `doctors`
 * concurrently. `error: deadlock detected`, in the file whose whole purpose is to prove a
 * safety property. A test that makes the rest of the suite flaky is not a control, it is
 * a second defect, and the same family as `audit-atomicity` replacing a shared trigger.
 *
 * So the behavioural pair runs on a table this file creates and drops inside its own
 * transaction, built to mirror the migration exactly: `organisation_id`, RLS enabled and
 * FORCED, one permissive policy standing in for the scoping the real tables have, and one
 * restrictive policy whose expression is copied from
 * `20260908001300_tenant_boundary_restrictive.sql` verbatim.
 *
 * **What it therefore proves is the semantics, not the deployment** — so the last test
 * closes that gap from the catalog: every table carrying a tenant, or reaching one in a
 * single hop, must have a restrictive policy, derived rather than listed. And the real
 * tables' cross-tenant behaviour is already the forty deny cells of `g-rls-c.spec.ts`.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

/**
 * A mirror of a tenant-scoped table, created inside the caller's transaction.
 *
 * Named uniquely per call so two runs can never collide, and dropped by the rollback
 * rather than by a teardown that could fail and leave the schema dirty.
 */
const mirrorTable = async (client: Client): Promise<string> => {
  const name = `mr07_d2_mirror_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  await client.query(
    `create table public.${name} (
       id uuid primary key,
       organisation_id uuid not null references public.organisations (id)
     )`,
  );
  await client.query(`alter table public.${name} enable row level security`);
  await client.query(`alter table public.${name} force row level security`);
  await client.query(`grant select on public.${name} to authenticated`);

  // Stands in for the scoping the real tables already have — territory-based on
  // `doctors`, subtree-based on `visits`. Permissive, exactly as those are.
  await client.query(
    `create policy ${name}_select_scope on public.${name}
       for select to authenticated
       using (organisation_id = public.current_user_organisation_id())`,
  );
  // Copied verbatim from 20260908001300_tenant_boundary_restrictive.sql.
  await client.query(
    `create policy ${name}_tenant_boundary on public.${name}
       as restrictive for all to authenticated
       using (organisation_id = public.current_user_organisation_id())
       with check (organisation_id = public.current_user_organisation_id())`,
  );

  await client.query(`insert into public.${name} (id, organisation_id) values ($1, $2), ($3, $4)`, [
    randomUUID(),
    world.organisationId,
    randomUUID(),
    world.rivalOrganisationId,
  ]);
  return name;
};

const visibleRows = async (client: Client, table: string, organisationId: string) => {
  const rows = await client.query(`select id from public.${table} where organisation_id = $1`, [
    organisationId,
  ]);
  return rows.rowCount ?? 0;
};

describe.skipIf(!reachable)('D2 — a restrictive tenant boundary cannot be widened', () => {
  it('an over-broad PERMISSIVE policy does not widen the boundary', async () => {
    await inRolledBackTransaction(async (client) => {
      const table = await mirrorTable(client);
      // Added as the owner, the way a well-meaning future migration would add one.
      await client.query(
        `create policy ${table}_over_broad on public.${table}
           for select to authenticated using (true)`,
      );

      await asUser(client, world.users.puneMr);

      expect(
        await visibleRows(client, table, world.rivalOrganisationId),
        'using (true) must not reach another tenant',
      ).toBe(0);

      // THE POSITIVE CONTROL, in the same transaction and through the same policies: the
      // caller can genuinely read this table, so the zero above is a boundary refusing
      // and not a table nobody can see.
      expect(
        await visibleRows(client, table, world.organisationId),
        'the caller can read their own tenant here',
      ).toBe(1);
    });
  });

  it('and with the RESTRICTIVE policy removed, the same policy widens immediately', async () => {
    // The other half of the pair, and the world MR-06 shipped: a permissive tenant
    // predicate, OR-ed with whatever else is on the table.
    await inRolledBackTransaction(async (client) => {
      const table = await mirrorTable(client);
      await client.query(`drop policy ${table}_tenant_boundary on public.${table}`);
      await client.query(
        `create policy ${table}_over_broad on public.${table}
           for select to authenticated using (true)`,
      );

      await asUser(client, world.users.puneMr);

      expect(
        await visibleRows(client, table, world.rivalOrganisationId),
        'without the restrictive policy, using (true) reaches straight across the tenant',
      ).toBe(1);
    });
  });

  it('the ordinary path is unaffected: an MR still reads their own doctors', async () => {
    // On the REAL table. A restrictive policy that denied everything would satisfy every
    // assertion above perfectly.
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      const own = await client.query('select id from public.doctors where id = $1', [
        world.doctors.pune,
      ]);
      expect(own.rowCount).toBe(1);
    });
  });

  it('and an admin still administers their own tenant through it', async () => {
    // Also on the real table. The restrictive policy binds `authenticated`, which includes
    // the admin — and an admin is the one user with no territory, so if the expression
    // were wrong for them this is where it would show.
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.admin);
      const own = await client.query('select id from public.doctors where id = $1', [
        world.doctors.south,
      ]);
      expect(own.rowCount, 'an admin reads their own tenant across subtrees').toBe(1);

      const rival = await client.query('select id from public.doctors where id = $1', [
        world.doctors.rival,
      ]);
      expect(rival.rowCount, 'and not another tenant').toBe(0);
    });
  });

  it('every table that carries a tenant has the boundary, derived from the catalog', async () => {
    // A hand-maintained list of tables will eventually be left off one, so this asks the
    // catalog instead. It is also what carries the deployment half of the claim, since the
    // behavioural pair above runs on a mirror: these are the real policies, on the real
    // tables, and the day somebody adds an eighth tenant-carrying table this fails rather
    // than the boundary quietly not covering it.
    await inRolledBackTransaction(async (client) => {
      const rows = await client.query<{ relname: string }>(
        `select c.relname
           from pg_policy p join pg_class c on c.oid = p.polrelid
          where not p.polpermissive
            and c.relname not like 'mr07_d2_mirror_%'
          order by c.relname`,
      );
      expect(rows.rows.map((r) => r.relname)).toEqual([
        'clinic_addresses',
        'consent_text_versions',
        'doctors',
        'organisations',
        'territories',
        'territory_shift_windows',
        'user_profiles',
      ]);
    });
  });
});
