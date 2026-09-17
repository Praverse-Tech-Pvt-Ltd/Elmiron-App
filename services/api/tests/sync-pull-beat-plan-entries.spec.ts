import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * `BE-W89` — MR-44 B3. `beat_plan_entry` travels in the pull.
 *
 * The entity was missing, so `BeatPlanRecordSchema` omits `entries` while
 * `public.beat_plan_entries` genuinely holds rows and `buildDayRoute` maps `plan.entries` to
 * stops. The screen would have rendered an empty route, which is why MR-14 left it on the mock.
 *
 * **What the register missed, and it is the whole re-size: the table had no `updated_at`.**
 * `sync_pull` orders and pages on `(updated_at, id)`, so this was never "add a union-all arm".
 *
 * ### What this suite asserts, and what it deliberately leaves to the existing one
 *
 * It asserts the parts MR-44 wrote: the arm reaches the right caller and nobody else, the
 * transport ordering is deterministic, the tombstone branch records the right scope, and the
 * mapping refuses an unmapped table. The snapshot semantics — no row lost when committed
 * mid-pull, tombstones only on an incremental sweep — are properties of the shared
 * `candidates` CTE that `sync-pull.spec.ts` already covers for five entities; the new arm
 * inherits them by construction because it is one more `union all` over the same machinery,
 * and duplicating those assertions here would test the CTE twice and this arm not at all.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
});

const asUserTx = async <T>(user: FixtureUser, fn: (client: Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await asUser(client, user);
    return fn(client);
  });

interface Change {
  readonly entity: string;
  /** The pull emits camelCase keys; the column is `entity_id`. */
  readonly entityId: string;
  readonly payload: Record<string, unknown> | null;
}

const pullEntries = async (client: Client): Promise<readonly Change[]> => {
  const { rows } = await client.query<{ payload: { changes: readonly Change[] } }>(
    'select public.sync_pull($1, $2, $3) as payload',
    [null, null, 500],
  );
  return (rows[0]?.payload.changes ?? []).filter((c) => c.entity === 'beat_plan_entry');
};

describe.skipIf(!reachable)('BE-W89 — the entity reaches the MR whose plan it is', () => {
  it('declares itself in completeness.entities, so a client can tell it became available', async () => {
    // The pull cannot retroactively deliver entries to a client holding a cursor — existing
    // rows keep their original xmin. This list is the only signal that a re-sync is worth
    // doing, which is why it is asserted rather than assumed.
    await asUserTx(world.users.puneMr, async (client) => {
      const { rows } = await client.query<{ payload: { completeness: { entities: string[] } } }>(
        'select public.sync_pull($1, $2, $3) as payload',
        [null, null, 500],
      );
      expect(rows[0]?.payload.completeness.entities).toContain('beat_plan_entry');
    });
  });

  it('carries both entries, with their fields, to the plan’s own MR', async () => {
    const entries = await asUserTx(world.users.puneMr, pullEntries);
    const ids = entries.map((c) => c.entityId);

    expect(ids).toContain(world.beatPlanEntries.first);
    expect(ids).toContain(world.beatPlanEntries.second);

    // The CONTENT, not the count: an arm that emitted the right number of rows with an empty
    // payload would satisfy a length check and render nothing.
    const first = entries.find((c) => c.entityId === world.beatPlanEntries.first);
    expect(first?.payload?.['beat_plan_id']).toBe(world.beatPlans.pune);
    expect(first?.payload?.['planned_sequence']).toBe(1);
    expect(first?.payload?.['clinic_address_id']).toBe(world.clinicAddresses.pune);
  });

  it('carries NONE of them to another tenant’s MR — the arm has no predicate of its own', async () => {
    // `sync_pull` is SECURITY INVOKER and the arm is unqualified on purpose:
    // `beat_plan_entries_select_via_plan` scopes through the plan's mr_id and
    // visible_user_ids(). If anyone ever adds a hand-written predicate to the arm, or the
    // policy is dropped, this is what fails.
    const entries = await asUserTx(world.users.rivalMr, pullEntries);

    expect(entries).toEqual([]);
  });

  it('orders deterministically by (updated_at, id), which is the transport order', async () => {
    // Not `planned_sequence` — that is the DOMAIN order the screen renders in, and conflating
    // the two is how a pager starts skipping rows. The two fixture entries share an
    // `updated_at`, so this is the id tiebreak doing the work, which is the case that
    // actually decides whether paging is stable.
    const entries = await asUserTx(world.users.puneMr, pullEntries);
    const ids = entries.map((c) => c.entityId);

    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });
});

describe.skipIf(!reachable)('BE-W89 — the tombstone records the PLAN’s scope', () => {
  it('records a delete against the parent plan’s mr_id, payload-free', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query('reset role');
      await client.query('delete from public.beat_plan_entries where id = $1', [
        world.beatPlanEntries.second,
      ]);

      const { rows } = await client.query<{
        entity: string;
        reason: string;
        former_mr_id: string | null;
        former_territory_id: string | null;
      }>(
        `select entity, reason, former_mr_id, former_territory_id
           from public.sync_events where entity_id = $1`,
        [world.beatPlanEntries.second],
      );

      expect(rows[0]?.entity).toBe('beat_plan_entry');
      expect(rows[0]?.reason).toBe('deleted');
      // An entry has no mr_id of its own; the scope is looked up from the plan. A null here
      // would make the tombstone invisible to everyone — safe, but wrong for a live plan.
      expect(rows[0]?.former_mr_id).toBe(world.users.puneMr.id);
      expect(rows[0]?.former_territory_id).toBeNull();
    });
  });

  it('cannot carry a payload at all — the table has no column for one', async () => {
    // Structural, so it survives a future author adding a payload to the trigger: there is
    // nowhere to put it. A tombstone is an existence claim and nothing more.
    await inRolledBackTransaction(async (client) => {
      const { rows } = await client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'sync_events'`,
      );
      const columns = rows.map((r) => r.column_name);

      expect(columns).not.toContain('payload');
      // The precondition: if this query ever stopped finding the table, the assertion above
      // would pass against an empty list.
      expect(columns).toContain('entity_id');
    });
  });
});

describe.skipIf(!reachable)('BE-W89 — the mapping still refuses an unmapped table', () => {
  it('maps beat_plan_entries, and raises for a table nobody declared', async () => {
    // `sync_entity_for_table` exists so that putting `emit_sync_event` on a table without
    // declaring it raises on the first write instead of filing its rows under another
    // entity. Adding a mapping must not weaken that, so both halves are asserted.
    await inRolledBackTransaction(async (client) => {
      const { rows } = await client.query<{ entity: string }>(
        `select public.sync_entity_for_table('beat_plan_entries') as entity`,
      );
      expect(rows[0]?.entity).toBe('beat_plan_entry');

      await expect(
        client.query(`select public.sync_entity_for_table('not_a_table')`),
      ).rejects.toThrow(/no sync entity for table/u);
    });
  });
});
