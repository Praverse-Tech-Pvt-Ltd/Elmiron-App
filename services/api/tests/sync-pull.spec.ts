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

describe.skipIf(!reachable)('the cursor is bounded, and says so rather than guessing', () => {
  it('refuses a cursor older than the freeze horizon with 45006, not 45005', async () => {
    // A frozen xid is visible in EVERY snapshot, so a frozen row reads as "already seen"
    // and is silently dropped from the pull. The bound is a proof, not a margin: a row
    // still owed to the client changed after the cursor was issued, so its xmin is newer
    // than the cursor's, and a tuple cannot be frozen until age(xmin) reaches
    // vacuum_freeze_min_age. Below that age, nothing owed can have been frozen.
    //
    // `vacuum_freeze_min_age` is USERSET, so the boundary can be walked here through the
    // real code path rather than by waiting for 25,000,000 transactions. (A client cannot
    // do the same to escape the bound: PostgREST does not pass arbitrary GUCs, and
    // raising it would only hurt the client that raised it.)
    //
    // On a committed connection, because a cursor cannot age inside the transaction that
    // issued it -- the xid counter does not move until transactions commit.
    await asCommittedUser(world.users.puneMr, async (client) => {
      const first = await pull(client, { entities: ['doctor'], limit: 1 });
      // Each of these consumes a transaction id, which is what `age()` counts.
      for (let i = 0; i < 5; i += 1) await client.query('select pg_current_xact_id()');
      // Limit becomes 2 transactions; the cursor above is now older than that.
      await client.query('set vacuum_freeze_min_age = 4');
      try {
        await expect(pull(client, { cursor: first.nextCursor })).rejects.toMatchObject({
          code: '45006',
        });
      } finally {
        await client.query('reset vacuum_freeze_min_age');
      }
    });
  }, 30_000);

  it('accepts the same cursor when it is inside the horizon', async () => {
    // Without this, the test above would pass against a function that refuses every
    // cursor, which is a bound that has become an outage.
    await asCommittedUser(world.users.puneMr, async (client) => {
      const first = await pull(client, { entities: ['doctor'], limit: 1 });
      for (let i = 0; i < 5; i += 1) await client.query('select pg_current_xact_id()');
      const second = await pull(client, { cursor: first.nextCursor, entities: ['doctor'] });
      expect(second.completeness.phase).toBe(2);
    });
  }, 30_000);

  it('reports the maximum cursor age, so the limit is visible before it bites', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      const response = await pull(client, { limit: 1 });
      expect(
        (response.completeness as unknown as { maxCursorAgeTransactions: number })
          .maxCursorAgeTransactions,
      ).toBeGreaterThan(0);
    });
  });

  it('REFUSES an oversized cursor rather than truncating it', async () => {
    // Truncation is the dangerous option, not the safe one: `xmin:xmax:` with a shortened
    // xip_list is still a syntactically valid snapshot, describing a different set of
    // in-flight transactions. It would parse, and answer a different question.
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      const oversized = `{"v":1,"since":null,"upto":null,"pad":"${'x'.repeat(9000)}"}`;
      expect(Buffer.byteLength(oversized, 'utf8')).toBeGreaterThan(8192);
      await expect(pull(client, { cursor: oversized })).rejects.toMatchObject({ code: '45005' });
    });
  });

  it('accepts a cursor just under the cap, so the cap is a cap and not a wall', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      const first = await pull(client, { entities: ['doctor'], limit: 1 });
      expect(Buffer.byteLength(first.nextCursor, 'utf8')).toBeLessThan(8192);
      const second = await pull(client, { cursor: first.nextCursor, entities: ['doctor'] });
      expect(second.completeness.phase).toBe(2);
    });
  });
});

describe.skipIf(!reachable)('sync_pull says what it is not', () => {
  it('carries the completeness as a FIELD in every response', async () => {
    // **Rewritten by phase 2, deliberately, and this is the change C3 asked to be
    // asserted.** Until 20260908000300 this read `omits` contains 'delete' and
    // 'out_of_scope', which was true and is now false: deletes arrive as tombstones and
    // leave-scope as its own reason. A completeness field that does not move as the
    // capability grows becomes a lie in the other direction -- a client still warning
    // about missing deletes after they arrive is as wrong as one that never warned.
    //
    // What did NOT change is the requirement: the field is present, required, and
    // machine-readable in every response. That is what is asserted here.
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      const first = await pull(client, { limit: 1 });
      expect(first.completeness.phase).toBe(2);
      expect(first.completeness.omittedEntities).toContain('consent_record');
      expect(first.completeness.omittedEntities).toContain('analysis');
      // `reflects` and `omits` must partition, never overlap: a client reading one and
      // not the other must not be able to reach a different conclusion.
      const overlap = first.completeness.reflects.filter((r) =>
        first.completeness.omits.includes(r),
      );
      expect(overlap).toEqual([]);
    });
  });

  it('C3: an INCREMENTAL pull no longer claims to omit deletes', async () => {
    await asCommittedUser(world.users.puneMr, async (client) => {
      const first = await pull(client, { entities: ['doctor'], limit: 500 });
      const second = await pull(client, { cursor: first.nextCursor, entities: ['doctor'] });
      expect(second.completeness.reflects).toEqual(['insert', 'update', 'delete', 'out_of_scope']);
      expect(second.completeness.omits).toEqual([]);
    });
  });

  it('C3: a FULL RE-SYNC still says it carries no deletions, because it does not', async () => {
    // A null cursor emits no tombstones at all -- deliberately, see the migration's
    // section 1. So the honest statement is different, not absent: everything you are
    // entitled to see is in the stream, so anything missing from it is gone. A client
    // must replace rather than merge.
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      const full = await pull(client, { limit: 1 });
      expect(full.completeness.omits).toContain('delete');
      expect(full.completeness.note).toMatch(/full re-sync/i);
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
      // The page a client is most likely to read as "done, therefore complete" still
      // carries the field. Its CONTENT is phase-dependent and asserted above; its
      // presence is not negotiable.
      expect(response.completeness.phase).toBe(2);
      expect(response.completeness.entities.length).toBeGreaterThan(0);
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
      // ...and it still carries the field, now saying it omits nothing.
      expect(second.completeness.omits).toEqual([]);
    });
  });
});

// =============================================================================
// BE-W61 phase 2 — tombstones and leave-scope
// =============================================================================

/**
 * Everything here runs on committed connections. A tombstone is written by an AFTER
 * trigger in the same transaction as the delete, so its `xmin` is that transaction's — and
 * phase 1's snapshot rule reports the caller's own in-progress transaction as not visible.
 * A rolled-back fixture would therefore stage an event the pull correctly cannot see.
 */

/** Runs `fn` with a committed doctor in the Pune territory, then removes it. */
const withDoctor = async (
  name: string,
  fn: (id: string, admin: Client) => Promise<void>,
): Promise<void> => {
  const { Client: PgClient } = await import('pg');
  const w = new PgClient({ connectionString: DB_URL });
  await w.connect();
  const id = randomUUID();
  try {
    await w.query(
      `insert into public.doctors (id, organisation_id, full_name, territory_id)
       values ($1, $2, $3, $4)`,
      [id, world.organisationId, name, world.territories.pune],
    );
    await fn(id, w);
  } finally {
    await w.query('delete from public.doctors where id = $1', [id]).catch(() => undefined);
    await w
      .query('delete from public.sync_events where entity_id = $1', [id])
      .catch(() => undefined);
    await w.end();
  }
};

describe.skipIf(!reachable)('phase 2: deletes arrive as payload-free tombstones', () => {
  it('a delete arrives, after the update that preceded it, with no payload', async () => {
    await withDoctor('Dr Tombstone Fixture', async (id, admin) => {
      const cursor = await asCommittedUser(world.users.puneMr, async (client) => {
        const first = await pull(client, { entities: ['doctor'], limit: 500 });
        expect(first.changes.map((c) => c.entityId)).toContain(id);
        return first.nextCursor;
      });

      // An update, then the delete, in that order and in separate transactions.
      await admin.query(
        `update public.doctors set full_name = 'Dr Tombstone Fixture II' where id = $1`,
        [id],
      );
      await admin.query('delete from public.doctors where id = $1', [id]);

      await asCommittedUser(world.users.puneMr, async (client) => {
        const next = await pull(client, { cursor, entities: ['doctor'], limit: 500 });
        const mine = next.changes.filter((c) => c.entityId === id);
        // The update cannot appear: the row is gone, so there is nothing to serialise.
        // What must appear is the delete, and it must be last for this id.
        expect(mine.length).toBeGreaterThan(0);
        expect(mine[mine.length - 1]?.reason).toBe('deleted');
        // Payload-free, in the wire format and not only in the table.
        expect(mine[mine.length - 1]?.payload).toBeNull();
      });
    });
  }, 30_000);

  it('the tombstone sorts after an earlier update of a different record', async () => {
    // C1's ordering requirement, exercised where it is observable: a delete must not
    // arrive before an update that happened earlier, or a client ends up in a state no
    // sequence of events explains.
    await withDoctor('Dr Order A Fixture', async (idA, admin) => {
      await withDoctor('Dr Order B Fixture', async (idB) => {
        const cursor = await asCommittedUser(world.users.puneMr, (client) =>
          pull(client, { entities: ['doctor'], limit: 500 }).then((r) => r.nextCursor),
        );
        await admin.query(`update public.doctors set specialty = 'Cardiology' where id = $1`, [
          idB,
        ]);
        await admin.query('delete from public.doctors where id = $1', [idA]);

        await asCommittedUser(world.users.puneMr, async (client) => {
          const next = await pull(client, { cursor, entities: ['doctor'], limit: 500 });
          const ids = next.changes.map((c) => c.entityId);
          expect(ids).toContain(idB);
          expect(ids).toContain(idA);
          expect(ids.indexOf(idB)).toBeLessThan(ids.indexOf(idA));
        });
      });
    });
  }, 30_000);

  it('carries NO tombstones on a full re-sync', async () => {
    // The second protection from the migration's section 1. A client rebuilding from
    // nothing has no stale rows to correct, so a tombstone could only tell it about
    // records it never held.
    await withDoctor('Dr Resync Fixture', async (id, admin) => {
      await admin.query('delete from public.doctors where id = $1', [id]);
      await asCommittedUser(world.users.puneMr, async (client) => {
        const full = await pull(client, { entities: ['doctor'], limit: 500 });
        expect(full.changes.every((c) => c.reason === 'upserted')).toBe(true);
        expect(full.changes.map((c) => c.entityId)).not.toContain(id);
      });
    });
  }, 30_000);
});

describe.skipIf(!reachable)('phase 2: leaving scope is not deletion', () => {
  it('a reassigned record arrives as out_of_scope, never as deleted', async () => {
    await withDoctor('Dr Reassigned Fixture', async (id, admin) => {
      const cursor = await asCommittedUser(world.users.puneMr, (client) =>
        pull(client, { entities: ['doctor'], limit: 500 }).then((r) => r.nextCursor),
      );
      // Moved to the southern territory: still exists, no longer this MR's.
      await admin.query('update public.doctors set territory_id = $2 where id = $1', [
        id,
        world.territories.south,
      ]);

      await asCommittedUser(world.users.puneMr, async (client) => {
        const next = await pull(client, { cursor, entities: ['doctor'], limit: 500 });
        const mine = next.changes.filter((c) => c.entityId === id);
        expect(mine).toHaveLength(1);
        // The whole point. "Deleted" is false, and for a consent record it would be
        // dangerously false; the client must be able to render "no longer yours" without
        // inferring it from an absence.
        expect(mine[0]?.reason).toBe('out_of_scope');
        expect(mine[0]?.reason).not.toBe('deleted');
        expect(mine[0]?.payload).toBeNull();
      });

      // And the row is genuinely still there, so this is not a delete wearing a name.
      const still = await admin.query('select 1 from public.doctors where id = $1', [id]);
      expect(still.rowCount).toBe(1);
    });
  }, 30_000);

  it('the NEW owner sees the same record as an ordinary upsert', async () => {
    // The other half: a record that left one scope entered another, and nothing about
    // the leave-scope event should stop the new owner receiving it normally.
    await withDoctor('Dr Handover Fixture', async (id, admin) => {
      const cursor = await asCommittedUser(world.users.southMr, (client) =>
        pull(client, { entities: ['doctor'], limit: 500 }).then((r) => r.nextCursor),
      );
      await admin.query('update public.doctors set territory_id = $2 where id = $1', [
        id,
        world.territories.south,
      ]);
      await asCommittedUser(world.users.southMr, async (client) => {
        const next = await pull(client, { cursor, entities: ['doctor'], limit: 500 });
        const mine = next.changes.filter((c) => c.entityId === id);
        expect(mine).toHaveLength(1);
        expect(mine[0]?.reason).toBe('upserted');
        expect(mine[0]?.payload).not.toBeNull();
      });
    });
  }, 30_000);
});

describe.skipIf(!reachable)('phase 2: a tombstone cannot disclose a record you never had', () => {
  it('C6: an MR in another territory is never told the record existed', async () => {
    // The sharp case. A tombstone is an existence claim -- "doctor 7f3a… was deleted"
    // tells a reader that doctor 7f3a… existed. It cannot be filtered at read time,
    // because the row is gone and there is nothing left to evaluate a policy against.
    //
    // So the scope is captured at the moment of the event and RLS admits the tombstone
    // only to a caller for whom that FORMER scope was visible.
    await withDoctor('Dr Never Yours Fixture', async (id, admin) => {
      const cursor = await asCommittedUser(world.users.southMr, (client) =>
        pull(client, { entities: ['doctor'], limit: 500 }).then((r) => r.nextCursor),
      );
      await admin.query('delete from public.doctors where id = $1', [id]);

      await asCommittedUser(world.users.southMr, async (client) => {
        const next = await pull(client, { cursor, entities: ['doctor'], limit: 500 });
        expect(next.changes.map((c) => c.entityId)).not.toContain(id);
      });

      // Not merely absent from the pull: invisible in the table it lives in, so a future
      // reader of sync_events cannot reach it either.
      await asCommittedUser(world.users.southMr, async (client) => {
        const rows = await client.query('select 1 from public.sync_events where entity_id = $1', [
          id,
        ]);
        expect(rows.rowCount).toBe(0);
      });

      // Positive control: the event does exist, and the MR who owned the record can see
      // it. Without this the assertions above would pass against a trigger that emits
      // nothing at all.
      const asOwner = await admin.query('select 1 from public.sync_events where entity_id = $1', [
        id,
      ]);
      expect(asOwner.rowCount).toBe(1);
      await asCommittedUser(world.users.puneMr, async (client) => {
        const rows = await client.query('select 1 from public.sync_events where entity_id = $1', [
          id,
        ]);
        expect(rows.rowCount).toBe(1);
      });
    });
  }, 30_000);

  it('no client can write or suppress an event', async () => {
    // There is no INSERT, UPDATE or DELETE policy on sync_events. Rows arrive through a
    // SECURITY DEFINER trigger and leave through a SECURITY DEFINER purge, so a client
    // can neither forge a tombstone for somebody else's record nor delete its own.
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      await client.query('savepoint p2');
      await expect(
        client.query(
          `insert into public.sync_events (entity, entity_id, reason, former_mr_id)
           values ('visit', $1, 'deleted', $2)`,
          [randomUUID(), world.users.puneMr.id],
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await client.query('rollback to savepoint p2');
      await expect(client.query('delete from public.sync_events')).rejects.toMatchObject({
        code: '42501',
      });
    });
  });
});

describe.skipIf(!reachable)('phase 2: tombstones expire on the cursor bound, not a guess', () => {
  it('an event older than the maximum cursor age is not served', async () => {
    // C4. The lifetime is the FIX-12 bound expressed the same way -- in transactions,
    // not days -- so the two cannot drift apart. Walked here by lowering
    // `vacuum_freeze_min_age`, exactly as the cursor bound is.
    await withDoctor('Dr Expiring Fixture', async (id, admin) => {
      const cursor = await asCommittedUser(world.users.puneMr, (client) =>
        pull(client, { entities: ['doctor'], limit: 500 }).then((r) => r.nextCursor),
      );
      await admin.query('delete from public.doctors where id = $1', [id]);

      await asCommittedUser(world.users.puneMr, async (client) => {
        // First, with the real setting: the tombstone is served.
        const fresh = await pull(client, { cursor, entities: ['doctor'], limit: 500 });
        expect(fresh.changes.map((c) => c.entityId)).toContain(id);
      });

      // Age the transaction counter past a tiny limit, then pull again.
      await asCommittedUser(world.users.puneMr, async (client) => {
        for (let i = 0; i < 6; i += 1) await client.query('select pg_current_xact_id()');
        await client.query('set vacuum_freeze_min_age = 4');
        try {
          // The cursor is now expired too, so a fresh sweep is what a real client would
          // do -- and a full re-sync carries no tombstones at all, which is the point:
          // by the time an event expires, nobody entitled to it can still ask.
          const full = await pull(client, { entities: ['doctor'], limit: 500 });
          expect(full.changes.map((c) => c.entityId)).not.toContain(id);
          await expect(pull(client, { cursor })).rejects.toMatchObject({ code: '45006' });
        } finally {
          await client.query('reset vacuum_freeze_min_age');
        }
      });
    });
  }, 30_000);

  it('the purge deletes exactly the expired ones', async () => {
    await withDoctor('Dr Purge Fixture', async (id, admin) => {
      await admin.query('delete from public.doctors where id = $1', [id]);
      const before = await admin.query('select 1 from public.sync_events where entity_id = $1', [
        id,
      ]);
      expect(before.rowCount).toBe(1);

      // Nothing is expired at the real setting.
      const none = await admin.query<{ n: number }>(
        'select public.purge_expired_sync_events() as n',
      );
      expect(Number(none.rows[0]?.n)).toBe(0);

      // With the limit lowered, it goes.
      for (let i = 0; i < 6; i += 1) await admin.query('select pg_current_xact_id()');
      await admin.query('set vacuum_freeze_min_age = 4');
      try {
        const purged = await admin.query<{ n: number }>(
          'select public.purge_expired_sync_events() as n',
        );
        expect(Number(purged.rows[0]?.n)).toBeGreaterThan(0);
        const after = await admin.query('select 1 from public.sync_events where entity_id = $1', [
          id,
        ]);
        expect(after.rowCount).toBe(0);
      } finally {
        await admin.query('reset vacuum_freeze_min_age');
      }
    });
  }, 30_000);
});
