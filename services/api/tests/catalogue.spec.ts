import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asOwner, asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * AI-B1 — the catalogue (`20260924000400_catalogue.sql`).
 *
 * Every refusal here is paired with a positive control through the same path in the same
 * transaction: an admin CAN write, so an MR's 42501 is a policy refusing and not a table nobody
 * can write; the owning tenant CAN read, so another tenant's zero is the boundary and not an
 * empty table.
 *
 * Cross-tenant READS over real HTTP are in `tenant-probe-direct-tables.spec.ts` with the other
 * directly readable tables; the restrictive boundary's presence is in
 * `tenant-boundary-restrictive.spec.ts`. This file is the write path and the cross-row rules.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

/** Runs `sql`; returns the SQLSTATE it failed with, or null. Leaves the transaction usable. */
const sqlstate = async (client: Client, sql: string, params: unknown[] = []) => {
  await client.query('savepoint probe');
  try {
    await client.query(sql, params);
    await client.query('release savepoint probe');
    return null;
  } catch (error) {
    await client.query('rollback to savepoint probe');
    return (error as { code?: string }).code ?? 'unknown';
  }
};

interface Catalogue {
  marketId: string;
  therapyAreaId: string;
  productId: string;
  linkId: string;
}

/** Creates one of each, AS the given admin, through the policies. */
const createCatalogue = async (client: Client, admin: FixtureUser): Promise<Catalogue> => {
  const c = {
    marketId: randomUUID(),
    therapyAreaId: randomUUID(),
    productId: randomUUID(),
    linkId: randomUUID(),
  };
  await asUser(client, admin);
  // organisation_id is omitted on purpose: it defaults to the caller's organisation.
  await client.query(
    `insert into public.markets (id, country_code, name) values ($1, 'IN', 'India')`,
    [c.marketId],
  );
  await client.query(`insert into public.therapy_areas (id, name) values ($1, 'Urology')`, [
    c.therapyAreaId,
  ]);
  await client.query(
    `insert into public.products (id, therapy_area_id, brand_name, generic_name)
     values ($1, $2, 'Probe Brand', 'probe-generic')`,
    [c.productId, c.therapyAreaId],
  );
  await client.query(
    `insert into public.product_markets (id, product_id, market_id) values ($1, $2, $3)`,
    [c.linkId, c.productId, c.marketId],
  );
  return c;
};

const count = async (client: Client, table: string, id: string): Promise<number> => {
  const r = await client.query(`select 1 from public.${table} where id = $1`, [id]);
  return r.rowCount ?? 0;
};

describe.skipIf(!reachable)('AI-B1 — who may write the catalogue', () => {
  it('an admin writes all four, in their own organisation, and the tenant is derived', async () => {
    await inRolledBackTransaction(async (client) => {
      const c = await createCatalogue(client, world.users.admin);
      const orgs = await client.query<{ t: string; organisation_id: string }>(
        `select 'markets' t, organisation_id from public.markets where id = $1
         union all select 'therapy_areas', organisation_id from public.therapy_areas where id = $2
         union all select 'products', organisation_id from public.products where id = $3
         union all select 'product_markets', organisation_id from public.product_markets where id = $4`,
        [c.marketId, c.therapyAreaId, c.productId, c.linkId],
      );
      expect(orgs.rows).toHaveLength(4);
      for (const row of orgs.rows) expect(row.organisation_id, row.t).toBe(world.organisationId);
    });
  });

  it('an MR and a field manager read it, and write none of it', async () => {
    await inRolledBackTransaction(async (client) => {
      const c = await createCatalogue(client, world.users.admin);
      for (const user of [world.users.puneMr, world.users.westManager]) {
        await asUser(client, user);
        // Positive control: the same caller can see the rows it is refused permission to write.
        expect(await count(client, 'products', c.productId), `${user.role} reads`).toBe(1);
        expect(await count(client, 'product_markets', c.linkId), `${user.role} reads`).toBe(1);

        expect(
          await sqlstate(client, `insert into public.products (brand_name) values ('Not Mine')`),
          `${user.role} insert`,
        ).toBe('42501');
        // An UPDATE the policy does not admit touches zero rows rather than raising; the
        // evidence is that the value did not change.
        await client.query(`update public.products set brand_name = 'Renamed' where id = $1`, [
          c.productId,
        ]);
        const name = await client.query<{ brand_name: string }>(
          `select brand_name from public.products where id = $1`,
          [c.productId],
        );
        expect(name.rows[0]?.brand_name, `${user.role} update`).toBe('Probe Brand');
      }
    });
  });

  it('an admin cannot write into another organisation', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.admin);
      expect(
        await sqlstate(
          client,
          `insert into public.products (organisation_id, brand_name) values ($1, 'Rival Brand')`,
          [world.rivalOrganisationId],
        ),
      ).toBe('42501');
      // Positive control: the same insert into the caller's own organisation succeeds.
      expect(
        await sqlstate(
          client,
          `insert into public.products (organisation_id, brand_name) values ($1, 'Own Brand')`,
          [world.organisationId],
        ),
      ).toBeNull();
    });
  });

  it('another organisation reads none of it — MR or admin', async () => {
    await inRolledBackTransaction(async (client) => {
      const c = await createCatalogue(client, world.users.admin);
      for (const user of [world.users.rivalMr, world.users.rivalAdmin]) {
        await asUser(client, user);
        for (const [table, id] of [
          ['markets', c.marketId],
          ['therapy_areas', c.therapyAreaId],
          ['products', c.productId],
          ['product_markets', c.linkId],
        ] as const) {
          expect(await count(client, table, id), `${user.role} of the rival, ${table}`).toBe(0);
        }
      }
    });
  });

  it('a product is retired, never deleted; a product-market link can be removed', async () => {
    await inRolledBackTransaction(async (client) => {
      const c = await createCatalogue(client, world.users.admin);
      expect(
        await sqlstate(client, `delete from public.products where id = $1`, [c.productId]),
      ).toBe('42501');
      await client.query(`update public.products set is_active = false where id = $1`, [
        c.productId,
      ]);
      expect(await count(client, 'products', c.productId)).toBe(1);

      await client.query(`delete from public.product_markets where id = $1`, [c.linkId]);
      expect(await count(client, 'product_markets', c.linkId)).toBe(0);
    });
  });

  it('every catalogue write reaches the audit trail', async () => {
    await inRolledBackTransaction(async (client) => {
      const c = await createCatalogue(client, world.users.admin);
      const rows = await asOwner(client, () =>
        client.query<{ table_name: string; actor_id: string }>(
          `select table_name, actor_id from public.audit_log
            where action = 'insert' and row_id = any($1::text[])`,
          [[c.marketId, c.therapyAreaId, c.productId, c.linkId]],
        ),
      );
      expect(rows.rows.map((r) => r.table_name).sort()).toEqual(
        ['markets', 'product_markets', 'products', 'therapy_areas'].sort(),
      );
      for (const row of rows.rows) expect(row.actor_id).toBe(world.users.admin.id);
    });
  });
});

describe.skipIf(!reachable)('AI-B1 — a reference never crosses an organisation', () => {
  it('a product cannot point at another organisation’s therapy area', async () => {
    await inRolledBackTransaction(async (client) => {
      const rival = await createCatalogue(client, world.users.rivalAdmin);
      await asUser(client, world.users.admin);
      expect(
        await sqlstate(
          client,
          `insert into public.products (therapy_area_id, brand_name) values ($1, 'Crosser')`,
          [rival.therapyAreaId],
        ),
      ).toBe('23514');
      // Positive control: its own therapy area is accepted.
      const own = await createCatalogue(client, world.users.admin);
      expect(
        await sqlstate(
          client,
          `insert into public.products (therapy_area_id, brand_name) values ($1, 'Stayer')`,
          [own.therapyAreaId],
        ),
      ).toBeNull();
    });
  });

  it('a product cannot be linked to another organisation’s market', async () => {
    await inRolledBackTransaction(async (client) => {
      const rival = await createCatalogue(client, world.users.rivalAdmin);
      const own = await createCatalogue(client, world.users.admin);
      await client.query(`delete from public.product_markets where id = $1`, [own.linkId]);
      expect(
        await sqlstate(
          client,
          `insert into public.product_markets (product_id, market_id) values ($1, $2)`,
          [own.productId, rival.marketId],
        ),
      ).toBe('23514');
      expect(
        await sqlstate(
          client,
          `insert into public.product_markets (product_id, market_id) values ($1, $2)`,
          [own.productId, own.marketId],
        ),
      ).toBeNull();
    });
  });

  it('a catalogue row cannot be moved to another organisation, even by the owner', async () => {
    // As the owner, so RLS is out of the way and the trigger is the only thing standing.
    await inRolledBackTransaction(async (client) => {
      const c = await createCatalogue(client, world.users.admin);
      const code = await asOwner(client, () =>
        sqlstate(client, `update public.therapy_areas set organisation_id = $1 where id = $2`, [
          world.rivalOrganisationId,
          c.therapyAreaId,
        ]),
      );
      expect(code).toBe('23514');
    });
  });

  it('holds nothing that could be a claim: no indication, dose, or label column', async () => {
    // The migration's header says why. This keeps it true after the header is forgotten.
    await inRolledBackTransaction(async (client) => {
      const r = await client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'products' order by column_name`,
      );
      expect(r.rows.map((x) => x.column_name)).toEqual([
        'brand_name',
        'created_at',
        'generic_name',
        'id',
        'is_active',
        'organisation_id',
        'therapy_area_id',
        'updated_at',
      ]);
    });
  });
});
