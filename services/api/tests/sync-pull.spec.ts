import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { DB_URL, inRolledBackTransaction, requireDatabase, withClient } from './db.js';
import { asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * BE-W61 — `sync_pull`, phase 1.
 *
 * The two things this suite exists to prove are the two holes `docs/adr-sync-pull.md`
 * found in the contract, and the second one is the reason most of this file is not in a
 * rolled-back transaction:
 *
 *  1. rows sharing an `updated_at` must paginate without repeating or skipping;
 *  2. **a row committed DURING a pull must not be lost permanently.** That is the defect
 *     that loses data silently and surfaces months later as "a visit that never synced",
 *     and it cannot be exercised inside one transaction — it needs two connections
 *     overlapping in real time, one of them holding a write open across the other's read.
 *
 * The third thing is C3's requirement: every response must say, in a field rather than a
 * comment, that deletions are not reflected.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

interface PullChange {
  entity: string;
  entityId: string;
  reason: string;
  payload: Record<string, unknown> | null;
  updatedAt: string;
}

interface PullResponse {
  changes: PullChange[];
  hasMore: boolean;
  serverTime: string;
  nextCursor: string;
  completeness: {
    phase: number;
    reflects: string[];
    omits: string[];
    entities: string[];
    omittedEntities: string[];
    note: string;
  };
}

const pull = async (
  client: Client,
  args: { cursor?: string | null; entities?: string[] | null; limit?: number | null } = {},
): Promise<PullResponse> => {
  const result = await client.query<{ payload: PullResponse }>(
    'select public.sync_pull($1, $2, $3) as payload',
    [args.cursor ?? null, args.entities ?? null, args.limit ?? null],
  );
  const payload = result.rows[0]?.payload;
  if (payload === undefined) throw new Error('sync_pull returned nothing');
  return payload;
};

/** A connection that is NOT inside a transaction, so its writes really commit. */
const asCommittedUser = async <T>(user: FixtureUser, fn: (client: Client) => Promise<T>) =>
  withClient(async (client) => {
    // `asUser` uses SET LOCAL, which needs a transaction. Outside one, set the claims
    // and the role for the session instead — same claims, same role, no rollback.
    await client.query('select set_config($1, $2, false)', [
      'request.jwt.claims',
      JSON.stringify({
        sub: user.id,
        role: 'authenticated',
        aud: 'authenticated',
        app_role: user.role,
        app_is_active: true,
        ...(user.territoryId === null ? {} : { app_territory_id: user.territoryId }),
      }),
    ]);
    await client.query('set role authenticated');
    try {
      return await fn(client);
    } finally {
      await client.query('reset role');
    }
  });

/**
 * Rows that REALLY commit, then go away again.
 *
 * A rolled-back transaction cannot be used to stage rows for a pull, and that is a
 * property of the design rather than an inconvenience: `pg_visible_in_snapshot` reports
 * the caller's own in-progress transaction as not visible, so a row inserted by the same
 * transaction that then calls `sync_pull` is correctly invisible to it — it is not
 * committed yet. In production a pull runs in its own transaction and never wrote
 * anything, so the case does not arise; in a test it means the fixture has to be real.
 */
const withCommittedDoctors = async (
  rows: Array<{ id: string; name: string; updatedAt?: string }>,
  fn: () => Promise<void>,
): Promise<void> => {
  const { Client: PgClient } = await import('pg');
  const w = new PgClient({ connectionString: DB_URL });
  await w.connect();
  const ids = rows.map((r) => r.id);
  try {
    for (const row of rows) {
      await w.query(
        `insert into public.doctors (id, organisation_id, full_name, territory_id, updated_at)
         values ($1, $2, $3, $4, coalesce($5::timestamptz, now()))`,
        [row.id, world.organisationId, row.name, world.territories.pune, row.updatedAt ?? null],
      );
    }
    await fn();
  } finally {
    // Ordered before the audit rows they generate, which are append-only and stay.
    await w.query('delete from public.doctors where id = any($1::uuid[])', [ids]);
    await w.end();
  }
};

describe.skipIf(!reachable)('sync_pull refuses before it reads', () => {
  it('refuses an unauthenticated caller with 28000', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query('set local role authenticated');
      await expect(pull(client)).rejects.toMatchObject({ code: '28000' });
    });
  });

  it('refuses a cursor it did not issue with 45005, not with a generic error', async () => {
    // FIX-08: a table read can only ever refuse with RLS 42501. This is why the pull is
    // an RPC — "start again with a null cursor" is an instruction a client can act on,
    // and 42501 is not.
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      await expect(pull(client, { cursor: 'not json at all' })).rejects.toMatchObject({
        code: '45005',
      });
    });
  });

  it('refuses a cursor from a version it does not issue', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      await expect(
        pull(client, { cursor: JSON.stringify({ v: 99, since: null, upto: null }) }),
      ).rejects.toMatchObject({ code: '45005' });
    });
  });
});

describe.skipIf(!reachable)('sync_pull says what it is not', () => {
  it('carries the incompleteness as a FIELD in every response', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      const first = await pull(client, { limit: 1 });
      // Not a comment, not an optional hint, not something a client has to know to ask
      // for. A pull presented as current when it is not is worse than no pull.
      expect(first.completeness.omits).toContain('delete');
      expect(first.completeness.omits).toContain('out_of_scope');
      expect(first.completeness.reflects).toEqual(['insert', 'update']);
      expect(first.completeness.note).toMatch(/NOT reflected/);
    });
  });

  it('carries it on the LAST page too, not only the first', async () => {
    // The page a client is most likely to treat as "done, therefore complete".
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      let response = await pull(client, { limit: 1 });
      let guard = 0;
      while (response.hasMore && guard < 50) {
        response = await pull(client, { cursor: response.nextCursor, limit: 1 });
        guard += 1;
      }
      expect(response.hasMore).toBe(false);
      expect(response.completeness.omits).toContain('delete');
    });
  });

  it('never emits a reason other than upserted in phase 1', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      const response = await pull(client, { limit: 500 });
      expect(response.changes.length).toBeGreaterThan(0);
      expect([...new Set(response.changes.map((c) => c.reason))]).toEqual(['upserted']);
    });
  });
});

describe.skipIf(!reachable)('sync_pull is scoped to the caller', () => {
  it('an out-of-subtree MR gets an ABSENCE, not a refusal', async () => {
    // Stated either way on purpose. `visits_select_own_or_team` is a SELECT policy, and
    // a policy filters rather than raising — so a manager in another region sees an
    // empty result and cannot distinguish "no changes" from "not yours". That is the
    // trade FIX-08 recorded for table-scoped reads, and it is acceptable here because a
    // pull has no action to offer for someone else's rows.
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.southMr);
      const response = await pull(client, { entities: ['visit'], limit: 500 });
      const ids = response.changes.map((c) => c.entityId);
      const pune = await client.query<{ id: string }>(
        'select id from public.visits where mr_id = $1',
        [world.users.puneMr.id],
      );
      // The southern MR cannot even see the Pune rows to name them, which is the point.
      expect(pune.rows).toHaveLength(0);
      expect(ids).not.toContain(world.visits.pune);
    });
  });

  it('a doctor outside the territory never appears', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      const response = await pull(client, { entities: ['doctor'], limit: 500 });
      const ids = response.changes.map((c) => c.entityId);
      expect(ids).toContain(world.doctors.pune);
      expect(ids).not.toContain(world.doctors.south);
    });
  });

  it('honours the entity filter', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      const response = await pull(client, { entities: ['doctor'], limit: 500 });
      expect(response.changes.length).toBeGreaterThan(0);
      expect([...new Set(response.changes.map((c) => c.entity))]).toEqual(['doctor']);
    });
  });
});

describe.skipIf(!reachable)('sync_pull paginates across a tie on updated_at', () => {
  it('returns every row exactly once when they all share one updated_at', async () => {
    // The hole the contract could not close: with `since: IsoDateTime`, a page boundary
    // inside a group of rows sharing a timestamp either repeats rows or skips them,
    // because the next `since` cannot address a position inside the group.
    const rows = Array.from({ length: 7 }, (_, i) => ({
      id: randomUUID(),
      name: `Dr Tie Fixture ${String(i)}`,
      updatedAt: '2026-09-01T00:00:00Z',
    }));

    await withCommittedDoctors(rows, async () => {
      await withClient(async (probe) => {
        // Proof that the tie is real rather than assumed.
        const distinct = await probe.query<{ n: string }>(
          `select count(distinct updated_at) as n from public.doctors where id = any($1::uuid[])`,
          [rows.map((r) => r.id)],
        );
        expect(distinct.rows[0]?.n).toBe('1');
      });

      const seen: string[] = [];
      await asCommittedUser(world.users.puneMr, async (client) => {
        let response = await pull(client, { entities: ['doctor'], limit: 2 });
        seen.push(...response.changes.map((c) => c.entityId));
        let guard = 0;
        while (response.hasMore && guard < 50) {
          response = await pull(client, {
            cursor: response.nextCursor,
            entities: ['doctor'],
            limit: 2,
          });
          seen.push(...response.changes.map((c) => c.entityId));
          guard += 1;
        }
        // A page size of 2 over 7 tied rows means the boundary lands inside the tie
        // three times over. If it did not, this test would be measuring nothing.
        expect(guard).toBeGreaterThan(2);
      });

      // Nothing skipped...
      for (const row of rows) expect(seen).toContain(row.id);
      // ...and nothing repeated.
      expect(new Set(seen).size).toBe(seen.length);
    });
  }, 30_000);
});

describe.skipIf(!reachable)('a row committed DURING a pull is not lost', () => {
  it('arrives on the next pull even though its updated_at predates the cursor', async () => {
    /**
     * The whole reason the cursor carries snapshots instead of a timestamp.
     *
     * Timeline, with two real connections:
     *   W: begin; insert a doctor          -> stamped updated_at = now() at BEGIN
     *   R: sync_pull(null)                 -> cannot see it; cursor issued
     *   W: commit                          -> the row lands, stamped BEFORE the cursor
     *   R: sync_pull(cursor)               -> MUST return it
     *
     * With a timestamp watermark the last step returns nothing, for ever: the row's
     * `updated_at` is older than the watermark the client already stored. With snapshot
     * visibility it is returned, because the writing transaction was not visible in the
     * first snapshot and is visible in the second.
     *
     * Not in a rolled-back transaction, because the point is a real commit.
     */
    const doctorId = randomUUID();
    const { Client: PgClient } = await import('pg');
    const w = new PgClient({ connectionString: DB_URL });
    await w.connect();

    try {
      await w.query('begin');
      await w.query(
        `insert into public.doctors (id, organisation_id, full_name, territory_id)
         values ($1, $2, 'Dr MidPull Fixture', $3)`,
        [doctorId, world.organisationId, world.territories.pune],
      );

      const { cursor, stampedAt } = await asCommittedUser(world.users.puneMr, async (r) => {
        const first = await pull(r, { entities: ['doctor'], limit: 500 });
        expect(first.changes.map((c) => c.entityId)).not.toContain(doctorId);
        expect(first.hasMore).toBe(false);
        return { cursor: first.nextCursor, stampedAt: first.serverTime };
      });

      await w.query('commit');

      // The row's own updated_at is older than the moment the cursor was issued, which
      // is exactly the condition under which a watermark loses it.
      const stamp = await w.query<{ updated_at: string; older: boolean }>(
        `select updated_at, updated_at < $2::timestamptz as older
           from public.doctors where id = $1`,
        [doctorId, stampedAt],
      );
      expect(stamp.rows[0]?.older).toBe(true);

      const second = await asCommittedUser(world.users.puneMr, (r) =>
        pull(r, { cursor, entities: ['doctor'], limit: 500 }),
      );
      expect(second.changes.map((c) => c.entityId)).toContain(doctorId);
    } finally {
      try {
        await w.query('rollback');
      } catch {
        // Already committed. Nothing to undo here; the cleanup below is the real one.
      }
      await w.query('delete from public.doctors where id = $1', [doctorId]).catch(() => undefined);
      await w.end();
    }
  }, 30_000);

  it('a completed sweep does not return the same row again', async () => {
    // The other half: snapshot cursors must not turn every pull into a full re-send.
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      const first = await pull(client, { entities: ['doctor'], limit: 500 });
      expect(first.hasMore).toBe(false);
      expect(first.changes.length).toBeGreaterThan(0);

      const second = await pull(client, { cursor: first.nextCursor, entities: ['doctor'] });
      expect(second.changes).toEqual([]);
      expect(second.hasMore).toBe(false);
      // ...and it still says what it is not.
      expect(second.completeness.omits).toContain('delete');
    });
  });
});
