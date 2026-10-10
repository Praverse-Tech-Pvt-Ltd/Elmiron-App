import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asOwner, asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import { callReportItem } from './sync-bodies.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * `BE-W175` (`20261009000500_call_report_products`) — the products on a call report are real,
 * the rep's company's, and active when newly chosen. Every report goes through `sync_push`, the
 * phone's own path, so what is proved is what the outbox meets.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

interface Verdict {
  readonly id: string;
  readonly status: string;
  readonly sqlState: string | null;
  readonly rejectionDetail: string | null;
}

interface Catalogue {
  readonly active: string;
  readonly second: string;
  readonly retired: string;
  readonly rivals: string;
}

/** Three products of the fixture company (one retired) and one of the rival's. As the owner. */
const catalogue = async (client: Client): Promise<Catalogue> =>
  asOwner(client, async () => {
    const make = async (organisationId: string, name: string, active: boolean): Promise<string> => {
      const id = randomUUID();
      await client.query(
        `insert into public.products (id, organisation_id, brand_name, is_active) values ($1, $2, $3, $4)`,
        [id, organisationId, `${name} ${id.slice(0, 6)}`, active],
      );
      return id;
    };
    return {
      active: await make(world.organisationId, 'Activex', true),
      second: await make(world.organisationId, 'Secondol', true),
      retired: await make(world.organisationId, 'Oldane', false),
      rivals: await make(world.rivalOrganisationId, 'Rivalin', true),
    };
  });

/** A fresh visit of the Pune rep's to report on. */
const aVisit = async (client: Client): Promise<string> => {
  const id = randomUUID();
  await client.query(
    `insert into public.visits (id, mr_id, doctor_id, origin, unplanned_reason)
     values ($1, $2, $3, 'unplanned', 'product test')`,
    [id, world.users.puneMr.id, world.doctors.pune],
  );
  return id;
};

const push = async (client: Client, items: unknown[]): Promise<Verdict[]> => {
  const result = await client.query<{ r: { results: Verdict[] } }>(
    'select public.sync_push($1, $2::jsonb) as r',
    [randomUUID(), JSON.stringify(items)],
  );
  return result.rows[0]?.r.results ?? [];
};

const report = (visitId: string, productIdsDiscussed: readonly string[], id = randomUUID()) =>
  callReportItem({
    id,
    visitId,
    summary: 'Discussed dosing schedule questions the doctor raised.',
    productIdsDiscussed,
    clientCreatedAt: new Date().toISOString(),
  });

const storedProducts = async (client: Client, reportId: string): Promise<string[] | null> => {
  const row = await client.query<{ p: string[] }>(
    'select product_ids_discussed as p from public.call_reports where id = $1',
    [reportId],
  );
  return row.rows[0]?.p ?? null;
};

const asRep = async <T>(
  fn: (client: Client, c: Catalogue, visitId: string) => Promise<T>,
): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    const c = await catalogue(client);
    await asUser(client, world.users.puneMr);
    return fn(client, c, await aVisit(client));
  });

describe.skipIf(!reachable)('BE-W175 — what a call report may name', () => {
  it('one active product of the company: accepted, and stored as sent', async () => {
    await asRep(async (client, c, visitId) => {
      const item = report(visitId, [c.active]);
      const [verdict] = await push(client, [item]);
      expect(verdict?.status).toBe('accepted');
      expect(await storedProducts(client, item.payload.id)).toEqual([c.active]);
    });
  });

  it('several products: accepted, in the order chosen', async () => {
    await asRep(async (client, c, visitId) => {
      const item = report(visitId, [c.second, c.active]);
      expect((await push(client, [item]))[0]?.status).toBe('accepted');
      expect(await storedProducts(client, item.payload.id)).toEqual([c.second, c.active]);
    });
  });

  it('no product at all is still a call report — no rule requires one', async () => {
    await asRep(async (client, _c, visitId) => {
      expect((await push(client, [report(visitId, [])]))[0]?.status).toBe('accepted');
    });
  });

  it.each([
    ['an id that is no product', 'nonexistent'],
    ['another company’s product — the SAME answer, so no existence is revealed', 'rivals'],
  ])('%s: refused 23503', async (_label, which) => {
    await asRep(async (client, c, visitId) => {
      const id = which === 'rivals' ? c.rivals : randomUUID();
      const item = report(visitId, [c.active, id]);
      const [verdict] = await push(client, [item]);
      expect(verdict).toMatchObject({ status: 'rejected', sqlState: '23503' });
      expect(verdict?.rejectionDetail).toContain('call_report_product_unknown');
      expect(await storedProducts(client, item.payload.id)).toBeNull();
    });
  });

  it('a retired product cannot be newly chosen: refused 22023', async () => {
    await asRep(async (client, c, visitId) => {
      const [verdict] = await push(client, [report(visitId, [c.retired])]);
      expect(verdict).toMatchObject({ status: 'rejected', sqlState: '22023' });
      expect(verdict?.rejectionDetail).toContain('call_report_product_inactive');
    });
  });

  it('the same product twice in one report: refused 22023', async () => {
    await asRep(async (client, c, visitId) => {
      const [verdict] = await push(client, [report(visitId, [c.active, c.active])]);
      expect(verdict?.rejectionDetail).toContain('call_report_product_duplicate');
    });
  });
});

describe.skipIf(!reachable)('BE-W175 — history and retries', () => {
  it('a product retired AFTER the report stays readable on it, and a revision may keep it but not add another', async () => {
    await asRep(async (client, c, visitId) => {
      const first = report(visitId, [c.active]);
      expect((await push(client, [first]))[0]?.status).toBe('accepted');

      await asOwner(client, async () => {
        await client.query('update public.products set is_active = false where id = $1', [
          c.active,
        ]);
      });
      await asUser(client, world.users.puneMr);
      expect(await storedProducts(client, first.payload.id), 'the rep still reads it').toEqual([
        c.active,
      ]);
      await asUser(client, world.users.westManager);
      expect(await storedProducts(client, first.payload.id), 'and so does the manager').toEqual([
        c.active,
      ]);

      await asUser(client, world.users.puneMr);
      const revise = (productIdsDiscussed: string[]) => {
        const id = randomUUID();
        return {
          id: randomUUID(),
          entity: 'call_report',
          operation: 'create',
          entityId: visitId,
          clientCreatedAt: new Date().toISOString(),
          payload: {
            id,
            visitId,
            summary: 'Revised after the doctor called back.',
            productIdsDiscussed,
            objectionsRaised: null,
            nextStep: null,
            supersedesCallReportId: first.payload.id,
          },
        };
      };
      const keeps = revise([c.active, c.second]);
      expect((await push(client, [keeps]))[0]?.status, 'kept from the version it revises').toBe(
        'accepted',
      );

      const adds = revise([c.retired]);
      const [refused] = await push(client, [adds]);
      expect(refused?.rejectionDetail).toContain('call_report_product_inactive');
    });
  });

  it('a report resent after a lost answer is one report, with its products', async () => {
    await asRep(async (client, c, visitId) => {
      const item = report(visitId, [c.active, c.second]);
      expect((await push(client, [item]))[0]?.status).toBe('accepted');
      expect((await push(client, [item]))[0]?.status).toBe('duplicate');
      const n = await client.query<{ n: number }>(
        'select count(*)::int as n from public.call_reports where visit_id = $1',
        [visitId],
      );
      expect(n.rows[0]?.n).toBe(1);
      expect(await storedProducts(client, item.payload.id)).toEqual([c.active, c.second]);
    });
  });
});
