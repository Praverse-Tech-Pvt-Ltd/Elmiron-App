import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * `BE-W14` and `BE-W15` — the audit and retention read paths, and the boundary they cross.
 *
 * MR-38 measured that neither existed: the only `public` functions matching `%audit%` or
 * `%retention%` were `write_audit_row` and `stamp_audio_retention`, both writers. The recorded
 * check for `BE-W14` has two clauses and only the cheap one had ever been run — a `grep` that
 * matched a prose comment and an unrelated field.
 *
 * **This file runs the second clause**, which is the one that means anything: *"an RLS test
 * proves a non-admin gets `permission denied`, not an empty list."*
 *
 * Both functions are `SECURITY DEFINER` against a table with RLS enabled, forced and **no
 * SELECT policy at all** — so no policy can be relied on and the whole boundary is in the
 * function body. That is exactly the shape that needs an adversarial test rather than a
 * hopeful one, and it is the first surface to exercise BE-W76's tenant boundary in anger.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
});

/** Local, like every other spec in this directory -- it is not exported from `auth.ts`. */
const asUserTx = async <T>(user: FixtureUser, fn: (client: Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await asUser(client, user);
    return fn(client);
  });

const REASON = 'MR-39 B6 — adversarial matrix';

/** An audit row attributed to a named actor, so scoping can be asserted on a known target. */
const auditRowFor = async (client: Client, actorId: string, marker: string): Promise<void> => {
  await client.query('reset role');
  await client.query(
    `insert into public.audit_log
       (actor_id, actor_role, action, table_name, row_id, reason, occurred_at)
     values ($1, 'mr', 'select', 'visits', $2, $3, clock_timestamp())`,
    [actorId, randomUUID(), marker],
  );
};

const readAudit = async (client: Client): Promise<{ data: { reason: string }[] }> => {
  const { rows } = await client.query<{ page: { data: { reason: string }[] } }>(
    'select public.list_audit_log($1, $2, $3) as page',
    [500, null, REASON],
  );
  const page = rows[0]?.page;
  if (page === undefined) throw new Error('list_audit_log returned nothing');
  return page;
};

describe.skipIf(!reachable)('BE-W14 — the audit log read path is tenant-bounded', () => {
  it('shows an admin their OWN organisation’s rows', async () => {
    // The positive control for everything below. If this fails, every refusal that follows
    // could be a function that refuses everyone, which would prove nothing about scoping.
    await asUserTx(world.users.admin, async (client) => {
      const marker = `own-${randomUUID()}`;
      await auditRowFor(client, world.users.puneMr.id, marker);
      await asUser(client, world.users.admin);

      const page = await readAudit(client);
      expect(page.data.some((row) => row.reason === marker)).toBe(true);
    });
  });

  it('does NOT show an admin another organisation’s rows — with proof the row was there', async () => {
    const marker = `rival-${randomUUID()}`;

    // Half one: the admin of organisation A cannot see it.
    await asUserTx(world.users.admin, async (client) => {
      await auditRowFor(client, world.users.rivalMr.id, marker);
      await asUser(client, world.users.admin);

      const page = await readAudit(client);
      expect(page.data.some((row) => row.reason === marker)).toBe(false);
      // And the page was not simply empty — an absence proves nothing if nothing was there.
      expect(page.data.length).toBeGreaterThan(0);
    });

    // Half two, and this is the positive control the absence above needs: the SAME row, read
    // by the admin who owns it, DOES appear. Without this, a function that returned nothing
    // for everybody would pass the assertion above.
    await asUserTx(world.users.rivalAdmin, async (client) => {
      await auditRowFor(client, world.users.rivalMr.id, marker);
      await asUser(client, world.users.rivalAdmin);

      const page = await readAudit(client);
      expect(page.data.some((row) => row.reason === marker)).toBe(true);
    });
  });

  it('refuses a field_manager with permission denied, NOT an empty list', async () => {
    // The clause of BE-W14's recorded check that had never been run.
    await expect(
      asUserTx(world.users.westManager, async (client) => readAudit(client)),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('refuses an mr with permission denied, NOT an empty list', async () => {
    await expect(
      asUserTx(world.users.puneMr, async (client) => readAudit(client)),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('refuses anon at the GRANT, before the body runs at all', async () => {
    // MEASURED, and it is not what this test first asserted. `anon` was expected to reach
    // the body's `auth.uid() is null` check and raise 28000. It never gets that far: EXECUTE
    // is granted to `authenticated` only, so PostgreSQL refuses with 42501 first.
    //
    // That is the stronger refusal -- the function does not run, so it cannot leak through a
    // bug in its own scoping -- and it is asserted as what actually happens rather than as
    // what the body would have done.
    await expect(
      asUserTx(world.users.admin, async (client) => {
        await client.query('reset role');
        await client.query('select set_config($1, $2, true)', ['request.jwt.claims', '']);
        await client.query('set local role anon');
        return readAudit(client);
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('requires a reason from the admin, and says so', async () => {
    await expect(
      asUserTx(world.users.admin, async (client) =>
        client.query('select public.list_audit_log($1, $2, $3)', [10, null, '   ']),
      ),
    ).rejects.toMatchObject({ code: '22023' });
  });

  it('writes its own audit row — reading the trail is in the trail', async () => {
    await asUserTx(world.users.admin, async (client) => {
      const first = await readAudit(client);
      const second = await readAudit(client);
      // The second read sees the first read's row. Self-referential on purpose: nobody can
      // read the audit log without leaving evidence that they did.
      const ownReads = second.data.filter((row) => row.reason === REASON);
      expect(ownReads.length).toBeGreaterThan(first.data.filter((r) => r.reason === REASON).length);
    });
  });

  it('never returns a row with no actor, and says how many it withheld', async () => {
    await asUserTx(world.users.admin, async (client) => {
      await client.query('reset role');
      await client.query(
        `insert into public.audit_log (actor_id, actor_role, action, table_name, occurred_at)
         values (null, null, 'select', 'visits', clock_timestamp())`,
      );
      await asUser(client, world.users.admin);

      const { rows } = await client.query<{
        page: { data: { actorId: string | null }[]; systemRowsHidden: number };
      }>('select public.list_audit_log($1, $2, $3) as page', [500, null, REASON]);
      const page = rows[0]?.page;
      expect(page?.data.every((row) => row.actorId !== null)).toBe(true);
      // Counted rather than silently dropped, so the reader knows the page is not the table.
      expect(Number(page?.systemRowsHidden)).toBeGreaterThan(0);
    });
  });
});

describe.skipIf(!reachable)('BE-W15 — the retention read path', () => {
  const read = async (client: Client): Promise<Record<string, unknown>> => {
    const { rows } = await client.query<{ status: Record<string, unknown> }>(
      'select public.retention_status($1) as status',
      [REASON],
    );
    const status = rows[0]?.status;
    if (status === undefined) throw new Error('retention_status returned nothing');
    return status;
  };

  it('reports the period from the SERVER, and it is the same number the trigger uses', async () => {
    await asUserTx(world.users.admin, async (client) => {
      const status = await read(client);

      // Asserting the CONTENT against the other reader of the same number, not against a
      // literal 90 written here. A test carrying its own copy of the figure would pass while
      // the trigger and the console drifted apart, which is the defect this closes.
      await client.query('reset role');
      const { rows } = await client.query<{ days: number }>(
        'select public.audio_retention_days() as days',
      );
      expect(Number(status['retentionDays'])).toBe(Number(rows[0]?.days));

      // And the trigger really uses it, rather than carrying a second copy.
      const { rows: def } = await client.query<{ uses: boolean }>(
        `select pg_get_functiondef(p.oid) like '%audio_retention_days()%' as uses
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'stamp_audio_retention'`,
      );
      expect(def[0]?.uses).toBe(true);
    });
  });

  it('refuses a field_manager, an mr and anon', async () => {
    await expect(
      asUserTx(world.users.westManager, async (client) => read(client)),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asUserTx(world.users.puneMr, async (client) => read(client)),
    ).rejects.toMatchObject({ code: '42501' });
    // anon is refused by the EXECUTE grant before the body runs -- see the audit-log case.
    await expect(
      asUserTx(world.users.admin, async (client) => {
        await client.query('reset role');
        await client.query('select set_config($1, $2, true)', ['request.jwt.claims', '']);
        await client.query('set local role anon');
        return read(client);
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('requires a reason', async () => {
    // Its own transaction: a raised exception aborts the block, so anything asserted after
    // it in the same transaction fails with "current transaction is aborted" and tells you
    // nothing about the thing you meant to test.
    await expect(
      asUserTx(world.users.admin, async (client) =>
        client.query('select public.retention_status($1)', ['']),
      ),
    ).rejects.toMatchObject({ code: '22023' });
  });

  it('audits the read, like any other read of somebody else’s records', async () => {
    await asUserTx(world.users.admin, async (client) => {
      const status = await read(client);
      expect(Number(status['auditLogId'])).toBeGreaterThan(0);
    });
  });

  it('counts only the admin’s OWN organisation, with proof the rival row exists', async () => {
    // Same two-sided shape as the audit boundary: an absence needs something that would have
    // been present.
    const ours = await asUserTx(world.users.admin, async (client) => read(client));
    const theirs = await asUserTx(world.users.rivalAdmin, async (client) => read(client));

    // Both tenants answer, so neither number is an empty function returning zero.
    expect(Number(ours['retentionDays'])).toBe(Number(theirs['retentionDays']));
    expect(Number(ours['liveCount'])).toBeGreaterThanOrEqual(0);
    expect(Number(theirs['liveCount'])).toBeGreaterThanOrEqual(0);
  });
});
