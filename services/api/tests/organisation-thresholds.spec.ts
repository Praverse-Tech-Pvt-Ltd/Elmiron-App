import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asOwner, asUser } from './auth.js';
import { acquireGlobalThresholds } from './global-thresholds.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * W1-L Part C — `BE-W106` ANSWERED: a setting belongs to a company.
 *
 * The property: **a company's admin can set a threshold for their own company, that value reaches
 * their own users and NOBODY else's, and there is no way for a caller to ask for another
 * company's value or to write one.**
 *
 * `20260930000300_organisation_thresholds.sql` adds `organisation` between `global` and
 * `territory`, and changes ONLY the body of `threshold()`. `threshold_number()` delegates to it,
 * so all **52 call sites across 23 migrations** — including the AI feature flag and the daily
 * limit inside `ai_begin_request` — became per-company without a single caller being edited. C5
 * proves that claim through the real enforcement path rather than asserting it.
 *
 * ## Why this suite takes the global thresholds lock (`BE-W124`)
 *
 * It WRITES only organisation-scoped rows, inside a rolled-back transaction, so it cannot disturb
 * anybody. But it READS the global state: "the rival company sees the feature as OFF" is only true
 * while no other suite has committed a global `ai_feature_enabled:*` row, and `ai-gateway.spec.ts`
 * must commit exactly that. Reading shared state is as much a reason to hold the lock as writing
 * it — the distinction `ai-control-plane.spec.ts` drew after five failures in five runs.
 *
 * ## Why some rows are inserted directly instead of through the RPC
 *
 * `threshold()` orders by `effective_from` and `now()` is FIXED for a transaction, so two rows for
 * one key written in one test transaction tie, and which one wins is undefined. That property
 * predates this work — `ai-control-plane.spec.ts` found it — and the fix is not to add a parameter
 * to production SQL for a test's benefit. Where a test needs an ordered pair it inserts as the
 * owner with an explicit `effective_from`, exactly as that suite does. In production two admin
 * edits are two transactions and two `now()`s, so the tie does not arise.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;
let releaseGlobalThresholds: (() => Promise<void>) | null = null;

beforeAll(async () => {
  if (!reachable) return;
  // Before seedFixtures(), which takes the identity lock. One consistent order, no cycle.
  releaseGlobalThresholds = await acquireGlobalThresholds();
  world = await seedFixtures();
}, 180_000);

afterAll(async () => {
  await releaseGlobalThresholds?.();
  releaseGlobalThresholds = null;
});

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

/** An organisation row written as the owner, so its `effective_from` can be ordered explicitly. */
const setOrgThreshold = async (
  client: Client,
  organisationId: string,
  key: string,
  value: unknown,
  effectiveFrom = 'now()',
) => {
  await asOwner(client, () =>
    client.query(
      `insert into public.app_thresholds (key, value, scope, organisation_id, note, effective_from)
       values ($1, $2::jsonb, 'organisation', $3, 'organisation-thresholds.spec -- rolled back', ${effectiveFrom})`,
      [key, JSON.stringify(value), organisationId],
    ),
  );
};

const setGlobalThreshold = async (client: Client, key: string, value: unknown) => {
  await asOwner(client, () =>
    client.query(
      `insert into public.app_thresholds (key, value, scope, note)
       values ($1, $2::jsonb, 'global', 'organisation-thresholds.spec -- rolled back')`,
      [key, JSON.stringify(value)],
    ),
  );
};

const resolve = async (client: Client, key: string): Promise<unknown> => {
  const { rows } = await client.query<{ value: unknown }>('select public.threshold($1) as value', [
    key,
  ]);
  return rows[0]?.value ?? null;
};

const KEY = 'ucpmp_sample_cap_quantity';

describe.skipIf(!reachable)('C4 — a company setting reaches one company and no other', () => {
  it('the owning company sees its own value; the other company does not', async () => {
    await inRolledBackTransaction(async (client) => {
      await setGlobalThreshold(client, KEY, 5);
      await setOrgThreshold(client, world.organisationId, KEY, 42);

      await asUser(client, world.users.puneMr);
      expect(await resolve(client, KEY), 'the owning company').toBe(42);

      await asUser(client, world.users.rivalMr);
      // Not 42, and not an error either: the other company falls through to the global floor,
      // which is exactly what it got before this migration existed.
      expect(await resolve(client, KEY), 'the other company').toBe(5);
    });
  });

  it('TWO-SIDED: the same test with the companies swapped', async () => {
    await inRolledBackTransaction(async (client) => {
      await setGlobalThreshold(client, KEY, 5);
      await setOrgThreshold(client, world.rivalOrganisationId, KEY, 99);

      await asUser(client, world.users.rivalMr);
      expect(await resolve(client, KEY)).toBe(99);

      await asUser(client, world.users.puneMr);
      // Without this direction the suite would pass with a resolver that simply preferred the
      // FIRST organisation row it found, which is not a tenant boundary at all.
      expect(await resolve(client, KEY)).toBe(5);
    });
  });

  it('both companies can hold a DIFFERENT value for the same key at the same instant', async () => {
    await inRolledBackTransaction(async (client) => {
      await setOrgThreshold(client, world.organisationId, KEY, 10);
      await setOrgThreshold(client, world.rivalOrganisationId, KEY, 20);

      await asUser(client, world.users.puneMr);
      expect(await resolve(client, KEY)).toBe(10);
      await asUser(client, world.users.rivalMr);
      expect(await resolve(client, KEY)).toBe(20);
    });
  });

  it('a territory value still beats the company value — most specific wins', async () => {
    await inRolledBackTransaction(async (client) => {
      await setOrgThreshold(client, world.organisationId, KEY, 10);
      await asOwner(client, () =>
        client.query(
          `insert into public.app_thresholds (key, value, scope, territory_id, note)
           values ($1, '7'::jsonb, 'territory', $2, 'rolled back')`,
          [KEY, world.territories.pune],
        ),
      );

      await asUser(client, world.users.puneMr);
      const { rows } = await client.query<{ value: unknown }>(
        'select public.threshold($1, $2) as value',
        [KEY, world.territories.pune],
      );
      expect(rows[0]?.value, 'territory beats organisation').toBe(7);
      // And with no territory asked for, the company value is still what resolves.
      expect(await resolve(client, KEY)).toBe(10);
    });
  });

  it('a caller with NO identity falls through to global — background jobs keep working', async () => {
    await inRolledBackTransaction(async (client) => {
      await setGlobalThreshold(client, KEY, 5);
      await setOrgThreshold(client, world.organisationId, KEY, 42);
      // The purge worker and the watchdog connect with no JWT. Before this migration they read
      // the global row; they must still read it, and must never inherit some company's override.
      await asOwner(client, async () => {
        expect(await resolve(client, KEY)).toBe(5);
      });
    });
  });
});

describe.skipIf(!reachable)('C4 — writing a company setting, and who may', () => {
  it('an admin writes their OWN company, and the row proves it', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.admin);
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        `select public.set_organisation_threshold($1, '42'::jsonb, 'UCPMP cap agreed.') as result`,
        [KEY],
      );
      // There is no organisation parameter on the function, so there is nothing for a client to
      // supply. The id in the row came from `lms_caller()`, and this asserts which id that was.
      expect(rows[0]?.result['organisationId']).toBe(world.organisationId);
      expect(rows[0]?.result['scope']).toBe('organisation');

      expect(await resolve(client, KEY)).toBe(42);
      await asUser(client, world.users.rivalMr);
      expect(await resolve(client, KEY), 'and it did not leak').not.toBe(42);
    });
  });

  it('an MR may not write one', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      expect(
        await sqlstate(client, `select public.set_organisation_threshold($1, '42'::jsonb)`, [KEY]),
      ).toBe('42501');
    });
  });

  it('a field manager may not either — settings are not a manager surface', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.westManager);
      expect(
        await sqlstate(client, `select public.set_organisation_threshold($1, '42'::jsonb)`, [KEY]),
      ).toBe('42501');
    });
  });

  it('POSITIVE CONTROL: the rival admin writes their own company and it takes effect there', async () => {
    await inRolledBackTransaction(async (client) => {
      // Without this, "the rival admin cannot affect our company" is indistinguishable from
      // "the rival admin cannot write anything at all".
      await asUser(client, world.users.rivalAdmin);
      await client.query(`select public.set_organisation_threshold($1, '99'::jsonb)`, [KEY]);

      await asUser(client, world.users.rivalMr);
      expect(await resolve(client, KEY), 'reaches their own MR').toBe(99);
      await asUser(client, world.users.puneMr);
      expect(await resolve(client, KEY), 'and not ours').not.toBe(99);
    });
  });

  it('reading a company setting shows whether the company CHOSE it, not just what is in force', async () => {
    await inRolledBackTransaction(async (client) => {
      await setGlobalThreshold(client, KEY, 5);

      await asUser(client, world.users.admin);
      const before = await client.query<{ r: Record<string, unknown> }>(
        'select public.organisation_threshold($1) as r',
        [KEY],
      );
      // A console that showed `5` with no further information would be reporting a global default
      // in per-company words — the confusion BE-W106 existed to remove.
      expect(before.rows[0]?.r['hasOwnValue']).toBe(false);
      expect(before.rows[0]?.r['effectiveValue']).toBe(5);

      await client.query(`select public.set_organisation_threshold($1, '42'::jsonb)`, [KEY]);
      const after = await client.query<{ r: Record<string, unknown> }>(
        'select public.organisation_threshold($1) as r',
        [KEY],
      );
      expect(after.rows[0]?.r['hasOwnValue']).toBe(true);
      expect(after.rows[0]?.r['value']).toBe(42);
      expect(after.rows[0]?.r['effectiveValue']).toBe(42);
    });
  });

  it('an MR may not read one either', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      expect(await sqlstate(client, 'select public.organisation_threshold($1)', [KEY])).toBe(
        '42501',
      );
    });
  });
});

describe.skipIf(!reachable)('C5 — the AI flag is per-company, through the real path', () => {
  const FLAG = 'ai_feature_enabled:product_qa';
  const LIMIT = 'ai_daily_requests_per_user';

  it('ON for one company, OFF for the other, with nothing global switching it on', async () => {
    await inRolledBackTransaction(async (client) => {
      // The limit is global so that it is NOT the difference between the two companies.
      await setGlobalThreshold(client, LIMIT, 10);
      await setOrgThreshold(client, world.organisationId, FLAG, true);

      await asUser(client, world.users.puneMr);
      const ours = await sqlstate(client, 'select public.ai_begin_request($1)', ['product_qa']);
      await asUser(client, world.users.rivalMr);
      const theirs = await sqlstate(client, 'select public.ai_begin_request($1)', ['product_qa']);

      // Ours gets PAST the flag. It still refuses — no prompt is approved for this company in this
      // transaction — and that is asserted below rather than glossed, because both refusals are
      // `45011` and a test that only compared codes would prove nothing.
      expect(theirs, 'the other company is refused').toBe('45011');
      expect(ours, 'and so is ours, but not for the same reason').toBe('45011');

      const message = async (user: (typeof world.users)['puneMr']) => {
        await asUser(client, user);
        await client.query('savepoint m');
        try {
          await client.query('select public.ai_begin_request($1)', ['product_qa']);
          return 'no refusal';
        } catch (error) {
          await client.query('rollback to savepoint m');
          return (error as { message?: string }).message ?? '';
        }
      };
      expect(await message(world.users.rivalMr)).toContain('switched off');
      expect(await message(world.users.puneMr)).toContain('no approved prompt');
    });
  });

  it('the FLAG is what differs: same company, same everything, flag turned off', async () => {
    await inRolledBackTransaction(async (client) => {
      await setGlobalThreshold(client, LIMIT, 10);
      // Two rows for one key, so the order must be explicit — see the header.
      await setOrgThreshold(client, world.organisationId, FLAG, true, `now() - interval '1 hour'`);

      await asUser(client, world.users.puneMr);
      const on = await sqlstate(client, 'select public.ai_begin_request($1)', ['product_qa']);
      expect(on).toBe('45011');

      await setOrgThreshold(client, world.organisationId, FLAG, false);
      await asUser(client, world.users.puneMr);
      await client.query('savepoint m');
      let refusal = '';
      try {
        await client.query('select public.ai_begin_request($1)', ['product_qa']);
      } catch (error) {
        await client.query('rollback to savepoint m');
        refusal = (error as { message?: string }).message ?? '';
      }
      // Nothing changed but the company's own flag row, and the refusal moved from the prompt
      // check back to the flag check. That isolates the flag from every other cause.
      expect(refusal).toContain('switched off');
    });
  });

  it('a company override beats the global flag in BOTH directions', async () => {
    await inRolledBackTransaction(async (client) => {
      await setGlobalThreshold(client, LIMIT, 10);
      await setGlobalThreshold(client, FLAG, true);
      await setOrgThreshold(client, world.organisationId, FLAG, false);

      await asUser(client, world.users.puneMr);
      expect(await resolve(client, FLAG), 'off for us despite global on').toBe(false);
      await asUser(client, world.users.rivalMr);
      expect(await resolve(client, FLAG), 'on for them, from global').toBe(true);
    });
  });
});

describe.skipIf(!reachable)('C1 — the scope vocabulary cannot be half-filled', () => {
  it('an organisation row without an organisation is rejected', async () => {
    await inRolledBackTransaction(async (client) => {
      const state = await sqlstate(
        client,
        `insert into public.app_thresholds (key, value, scope) values ($1, '1'::jsonb, 'organisation')`,
        [KEY],
      );
      // Such a row would carry `organisation_id is null` and therefore resolve for EVERY company —
      // the widest possible failure from the narrowest possible typo.
      expect(state).toBe('23514');
    });
  });

  it('a global row carrying an organisation is rejected', async () => {
    await inRolledBackTransaction(async (client) => {
      const state = await sqlstate(
        client,
        `insert into public.app_thresholds (key, value, scope, organisation_id)
         values ($1, '1'::jsonb, 'global', $2)`,
        [KEY, world.organisationId],
      );
      expect(state).toBe('23514');
    });
  });

  it('a territory row carrying an organisation is rejected — a territory already has one', async () => {
    await inRolledBackTransaction(async (client) => {
      const state = await sqlstate(
        client,
        `insert into public.app_thresholds (key, value, scope, territory_id, organisation_id)
         values ($1, '1'::jsonb, 'territory', $2, $3)`,
        [KEY, world.territories.pune, world.rivalOrganisationId],
      );
      expect(state).toBe('23514');
    });
  });

  it('a company setting is append-only like every other — an update is refused', async () => {
    await inRolledBackTransaction(async (client) => {
      await setOrgThreshold(client, world.organisationId, KEY, 10);
      const state = await asOwner(client, () =>
        sqlstate(client, `update public.app_thresholds set value = '11'::jsonb where key = $1`, [
          KEY,
        ]),
      );
      expect(state).toBe('23001');
    });
  });
});
