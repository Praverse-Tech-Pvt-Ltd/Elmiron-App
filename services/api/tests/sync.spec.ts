import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * BE-W4 — offline sync.
 *
 * An MR works a full day underground and syncs at 6pm. Every assertion here is
 * about what happens when part of that day is refused: the successes must survive,
 * the failures must be visible and explainable, and nothing may be silently lost.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

const WED_1000_IST = '2026-08-12T10:00:00+05:30';
const WED_0300_IST = '2026-08-12T03:00:00+05:30';
const CLINIC_LAT = 18.5204;
const CLINIC_LON = 73.8567;

interface SyncResult {
  id: string;
  status: 'accepted' | 'duplicate' | 'rejected' | 'dead_lettered';
  rejectionCode: string | null;
  rejectionDetail: string | null;
  warnings: string[];
}

interface SyncResponse {
  batchId: string;
  results: SyncResult[];
  serverTime: string;
}

type Item = Record<string, unknown>;

const push = async (
  client: Client,
  items: Item[],
  batchId = randomUUID(),
): Promise<SyncResponse> => {
  const result = await client.query<{ response: SyncResponse }>(
    'select public.sync_push($1, $2::jsonb) as response',
    [batchId, JSON.stringify(items)],
  );
  const response = result.rows[0]?.response;
  if (response === undefined) throw new Error('sync_push returned nothing');
  return response;
};

const asUserTx = async <T>(user: FixtureUser, fn: (client: Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await asUser(client, user);
    return fn(client);
  });

const visitItem = (overrides: Item = {}): Item => ({
  id: randomUUID(),
  entity: 'visit',
  operation: 'create',
  entityId: randomUUID(),
  clientCreatedAt: WED_1000_IST,
  payload: { doctorId: world.doctors.pune, status: 'completed' },
  ...overrides,
});

const checkInItem = (visitId: string, at = WED_1000_IST, overrides: Item = {}): Item => ({
  id: randomUUID(),
  entity: 'check_in',
  operation: 'create',
  entityId: randomUUID(),
  clientCreatedAt: at,
  payload: { visitId, latitude: CLINIC_LAT, longitude: CLINIC_LON, occurredAt: at },
  ...overrides,
});

// =============================================================================
// Partial success
// =============================================================================

describe.skipIf(!reachable)('partial success is normal', () => {
  it('accepts the good items in a batch that also contains a bad one', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const good = visitItem();
      const alsoGood = visitItem();
      const bad = checkInItem(world.visits.south); // another MR's visit

      const response = await push(client, [good, bad, alsoGood]);

      expect(response.results.map((r) => r.status)).toEqual(['accepted', 'rejected', 'accepted']);

      // The failure did not roll back the successes. This is the whole point.
      const visits = await client.query<{ count: string }>(
        'select count(*) as count from public.visits where id = any($1::uuid[])',
        [[good['entityId'], alsoGood['entityId']]],
      );
      expect(Number(visits.rows[0]?.count)).toBe(2);
    });
  });

  it('returns one result per item, not a single batch verdict', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const items = [visitItem(), visitItem(), checkInItem(world.visits.south)];
      const response = await push(client, items);
      expect(response.results).toHaveLength(3);
      expect(response.results.map((r) => r.id)).toEqual(items.map((i) => i['id']));
    });
  });

  it('does not let a poison item block the items behind it', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const poison = checkInItem(world.visits.pune, WED_0300_IST); // outside shift window
      const behind = visitItem();

      const response = await push(client, [poison, behind]);
      expect(response.results[0]?.status).toBe('rejected');
      expect(response.results[1]?.status).toBe('accepted');
    });
  });
});

// =============================================================================
// Idempotency
// =============================================================================

describe.skipIf(!reachable)('idempotency', () => {
  it('reports duplicate and applies nothing twice on resubmission', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const item = visitItem();
      const batchId = randomUUID();

      const first = await push(client, [item], batchId);
      const second = await push(client, [item], batchId);

      expect(first.results[0]?.status).toBe('accepted');
      expect(second.results[0]?.status).toBe('duplicate');

      const visits = await client.query<{ count: string }>(
        'select count(*) as count from public.visits where id = $1',
        [item['entityId']],
      );
      expect(Number(visits.rows[0]?.count)).toBe(1);
    });
  });

  it('is safe to resend a whole batch after a lost response', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const items = [visitItem(), visitItem(), visitItem()];
      const batchId = randomUUID();
      await push(client, items, batchId);
      const replay = await push(client, items, batchId);
      expect(replay.results.every((r) => r.status === 'duplicate')).toBe(true);
    });
  });
});

// =============================================================================
// Dead-lettering
// =============================================================================

describe.skipIf(!reachable)('dead-lettering', () => {
  it('gives up after five attempts and stops retrying', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const poison = checkInItem(world.visits.pune, WED_0300_IST);

      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const response = await push(client, [poison]);
        expect(response.results[0]?.status).toBe('rejected');
      }

      const sixth = await push(client, [poison]);
      expect(sixth.results[0]?.status).toBe('dead_lettered');

      // And it stays dead — a seventh attempt does not reopen it.
      const seventh = await push(client, [poison]);
      expect(seventh.results[0]?.status).toBe('dead_lettered');

      const row = await client.query<{ attempt_count: number; status: string }>(
        'select attempt_count, status from public.sync_items where id = $1',
        [poison['id']],
      );
      expect(row.rows[0]?.status).toBe('dead_lettered');
      expect(row.rows[0]?.attempt_count).toBe(6);
    });
  });

  it('keeps the original rejection reason on the dead letter', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const poison = checkInItem(world.visits.pune, WED_0300_IST);
      for (let attempt = 1; attempt <= 6; attempt += 1) await push(client, [poison]);
      const row = await client.query<{ rejection_code: string; rejection_detail: string }>(
        'select rejection_code, rejection_detail from public.sync_items where id = $1',
        [poison['id']],
      );
      expect(row.rows[0]?.rejection_code).toBe('outside_shift_window');
      expect(row.rows[0]?.rejection_detail).toMatch(/gave up after 5 attempts/);
    });
  });
});

// =============================================================================
// Rejections are durable, visible and explainable
// =============================================================================

describe.skipIf(!reachable)('rejected items are never silently lost', () => {
  it('persists a rejection with a machine-readable code', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const item = checkInItem(world.visits.pune, WED_0300_IST);
      await push(client, [item]);

      const row = await client.query<{ status: string; rejection_code: string; payload: unknown }>(
        'select status, rejection_code, payload from public.sync_items where id = $1',
        [item['id']],
      );
      expect(row.rows[0]?.status).toBe('rejected');
      expect(row.rows[0]?.rejection_code).toBe('outside_shift_window');
      // The payload survives, so the work can be resubmitted once the cause is fixed.
      expect(row.rows[0]?.payload).not.toBeNull();
    });
  });

  it('distinguishes "your shift window is wrong" from "that is not your record"', async () => {
    // An MR told the wrong reason stops trusting the app. These two are somebody
    // else's mistake and their own, respectively.
    await asUserTx(world.users.puneMr, async (client) => {
      const wrongHours = checkInItem(world.visits.pune, WED_0300_IST);
      const notMine = checkInItem(world.visits.south);
      const response = await push(client, [wrongHours, notMine]);

      expect(response.results[0]?.rejectionCode).toBe('outside_shift_window');
      expect(response.results[1]?.rejectionCode).toBe('not_your_record');
    });
  });

  it('rejects a malformed item as malformed, and carries on', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const good = visitItem();
      const response = await push(client, [{ entity: 'visit' }, good]);
      expect(response.results[0]?.rejectionCode).toBe('malformed_item');
      expect(response.results[1]?.status).toBe('accepted');
    });
  });

  // Until BE-W7 this asserted `unsupported_entity`, because apply_sync_item refused
  // `recording` and `voice_note` outright. The audio storage layer landed in BE-W7
  // and both are now applied, so every value of sync_entity_kind is accepted and the
  // `unsupported_entity` branch is unreachable. It stays in the vocabulary for the
  // next entity that is declared before it is implemented.
  //
  // What this test still guards is the property the original one was for: a refusal
  // carries the code that is TRUE of it, rather than a generic one.
  it('rejects a recording with no upload grant by name, not generically', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const response = await push(client, [
        {
          id: randomUUID(),
          entity: 'recording',
          operation: 'create',
          entityId: randomUUID(),
          clientCreatedAt: WED_1000_IST,
          payload: {},
        },
      ]);
      expect(response.results[0]?.status).toBe('rejected');
      expect(response.results[0]?.rejectionCode).toBe('validation_failed');
      expect(response.results[0]?.rejectionDetail).toMatch(/uploadGrantId/);
    });
  });

  it('surfaces rejections through list_sync_rejections', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const item = checkInItem(world.visits.pune, WED_0300_IST);
      await push(client, [item]);
      const rejections = await client.query<{ id: string; rejection_code: string }>(
        'select id, rejection_code from public.list_sync_rejections()',
      );
      expect(rejections.rows.map((r) => r.id)).toContain(item['id']);
    });
  });

  it('leaves room for a manager override without a later migration', async () => {
    // Not built. The column exists so that building it is code rather than a
    // migration against a table with months of real data in it.
    await inRolledBackTransaction(async (client) => {
      const result = await client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'sync_items'
            and column_name = 'supersedes_sync_item_id'`,
      );
      expect(result.rows).toHaveLength(1);
    });
  });
});

// =============================================================================
// Conflicts eliminated: call reports
// =============================================================================

describe.skipIf(!reachable)('call reports are append-only versions', () => {
  it('refuses UPDATE at the trigger layer, even from the owner', async () => {
    await expect(
      inRolledBackTransaction((client: Client) =>
        client.query(`update public.call_reports set summary = 'rewritten'`),
      ),
    ).rejects.toThrow(/append-only/);
  });

  it('refuses UPDATE from an authenticated MR', async () => {
    await expect(
      asUserTx(world.users.puneMr, (client) =>
        client.query(`update public.call_reports set summary = 'rewritten'`),
      ),
    ).rejects.toThrow();
  });

  it('records an edit as version 2 and leaves version 1 untouched', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const revisedId = randomUUID();
      await client.query('select public.revise_call_report($1, $2, $3)', [
        revisedId,
        world.callReports.pune,
        'Corrected after listening back to the voice note.',
      ]);

      const original = await client.query<{ summary: string; version: number }>(
        'select summary, version from public.call_reports where id = $1',
        [world.callReports.pune],
      );
      const revised = await client.query<{ version: number; supersedes_call_report_id: string }>(
        'select version, supersedes_call_report_id from public.call_reports where id = $1',
        [revisedId],
      );

      expect(original.rows[0]?.version).toBe(1);
      expect(original.rows[0]?.summary).toMatch(/Pune formulary/);
      expect(revised.rows[0]?.version).toBe(2);
      expect(revised.rows[0]?.supersedes_call_report_id).toBe(world.callReports.pune);
    });
  });

  it('refuses a fork — two versions cannot supersede the same parent', async () => {
    await expect(
      asUserTx(world.users.puneMr, async (client) => {
        await client.query('select public.revise_call_report($1, $2, $3)', [
          randomUUID(),
          world.callReports.pune,
          'first edit',
        ]);
        return client.query('select public.revise_call_report($1, $2, $3)', [
          randomUUID(),
          world.callReports.pune,
          'competing edit',
        ]);
      }),
    ).rejects.toThrow(/already been superseded/);
  });

  it('shows only the newest version in call_report_current', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const revisedId = randomUUID();
      await client.query('select public.revise_call_report($1, $2, $3)', [
        revisedId,
        world.callReports.pune,
        'newer',
      ]);
      const current = await client.query<{ id: string }>(
        'select id from public.call_report_current where visit_id = $1',
        [world.visits.pune],
      );
      expect(current.rows.map((r) => r.id)).toEqual([revisedId]);
    });
  });
});

describe.skipIf(!reachable)('approval is a separate append-only decision', () => {
  it('records a decision without touching the report', async () => {
    await asUserTx(world.users.westManager, async (client) => {
      await client.query('select public.approve_call_report($1, true, $2)', [
        world.callReports.pune,
        'Solid handling of the pricing question.',
      ]);
      const view = await client.query<{ effective_status: string; decided_by_user_id: string }>(
        'select effective_status, decided_by_user_id from public.call_report_current where id = $1',
        [world.callReports.pune],
      );
      expect(view.rows[0]?.effective_status).toBe('approved');
      expect(view.rows[0]?.decided_by_user_id).toBe(world.users.westManager.id);
    });
  });

  it('never lets the author decide their own report', async () => {
    await expect(
      asUserTx(world.users.puneMr, (client) =>
        client.query('select public.approve_call_report($1, true, $2)', [
          world.callReports.pune,
          'approving myself',
        ]),
      ),
    ).rejects.toThrow(/only a field_manager or admin|may not decide/);
  });

  it('refuses to decide a report that has been superseded', async () => {
    await expect(
      inRolledBackTransaction(async (client) => {
        await asUser(client, world.users.puneMr);
        await client.query('select public.revise_call_report($1, $2, $3)', [
          randomUUID(),
          world.callReports.pune,
          'newer version',
        ]);
        await client.query('reset role');
        await asUser(client, world.users.westManager);
        return client.query('select public.approve_call_report($1, true, $2)', [
          world.callReports.pune,
          'deciding a stale version',
        ]);
      }),
    ).rejects.toThrow(/superseded/);
  });

  it('records a reversal as a new row referencing the first decision', async () => {
    await asUserTx(world.users.westManager, async (client) => {
      await client.query('select public.approve_call_report($1, true, $2)', [
        world.callReports.pune,
        'approved',
      ]);
      await client.query('select public.approve_call_report($1, false, $2)', [
        world.callReports.pune,
        'reversed after the MR clarified',
      ]);
      const rows = await client.query<{ approved: boolean; supersedes_approval_id: string | null }>(
        'select approved, supersedes_approval_id from public.call_report_approvals where call_report_id = $1 order by decided_at',
        [world.callReports.pune],
      );
      expect(rows.rows).toHaveLength(2);
      expect(rows.rows[0]?.approved).toBe(true);
      expect(rows.rows[1]?.approved).toBe(false);
      // The reversal references the decision it reverses. Neither row is edited.
      expect(rows.rows[1]?.supersedes_approval_id).not.toBeNull();
      expect(rows.rows[0]?.supersedes_approval_id).toBeNull();
    });
  });

  it('refuses UPDATE on an approval from any role', async () => {
    await expect(
      inRolledBackTransaction((client: Client) =>
        client.query(`update public.call_report_approvals set approved = true`),
      ),
    ).rejects.toThrow(/append-only/);
  });
});

// =============================================================================
// Conflicts eliminated: the stale beat plan
// =============================================================================

describe.skipIf(!reachable)('a stale beat plan warns, never discards', () => {
  const supersedeBeatPlan = async (client: Client): Promise<string> => {
    const newerId = randomUUID();
    await client.query(
      `insert into public.beat_plans (id, mr_id, territory_id, plan_date, status, version, supersedes_beat_plan_id)
       select $1, mr_id, territory_id, plan_date, 'submitted', version + 1, id
         from public.beat_plans where id = $2`,
      [newerId, world.beatPlans.pune],
    );
    return newerId;
  };

  it('accepts work filed against a superseded plan, with a warning', async () => {
    await inRolledBackTransaction(async (client) => {
      // The manager revised the plan while the MR was offline.
      await supersedeBeatPlan(client);
      await asUser(client, world.users.puneMr);

      const item = visitItem({
        payload: {
          doctorId: world.doctors.pune,
          status: 'completed',
          beatPlanId: world.beatPlans.pune,
        },
      });
      const response = await push(client, [item]);

      // The MR's work is valid. The plan is stale. Neither is discarded.
      expect(response.results[0]?.status).toBe('accepted');
      expect(response.results[0]?.warnings).toContain('stale_beat_plan');
    });
  });

  it('does not warn when the plan is still current', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const item = visitItem({
        payload: {
          doctorId: world.doctors.pune,
          status: 'completed',
          beatPlanId: world.beatPlans.pune,
        },
      });
      const response = await push(client, [item]);
      expect(response.results[0]?.warnings).toEqual([]);
    });
  });

  it('shows only the newest plan version in beat_plan_current', async () => {
    await inRolledBackTransaction(async (client) => {
      const newerId = await supersedeBeatPlan(client);
      await asUser(client, world.users.puneMr);
      const current = await client.query<{ id: string }>(
        'select id from public.beat_plan_current where mr_id = $1',
        [world.users.puneMr.id],
      );
      expect(current.rows.map((r) => r.id)).toEqual([newerId]);
    });
  });
});

// =============================================================================
// Observability
// =============================================================================

describe.skipIf(!reachable)('sync observability', () => {
  it('answers what is in this MR queue and when they last synced', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      await push(client, [visitItem(), checkInItem(world.visits.pune, WED_0300_IST)]);
      const status = await client.query<{
        accepted_count: number;
        rejected_count: number;
        last_successful_sync_at: string | null;
      }>('select * from public.sync_queue_status($1)', [world.users.puneMr.id]);

      expect(status.rows[0]?.accepted_count).toBe(1);
      expect(status.rows[0]?.rejected_count).toBe(1);
      expect(status.rows[0]?.last_successful_sync_at).not.toBeNull();
    });
  });

  it('is visible to the MR manager', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      await push(client, [visitItem()]);
      await client.query('reset role');
      await asUser(client, world.users.westManager);
      const status = await client.query('select * from public.sync_queue_status($1)', [
        world.users.puneMr.id,
      ]);
      expect(status.rows).toHaveLength(1);
    });
  });

  it('is not visible to a manager outside the team', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      await push(client, [visitItem()]);
      await client.query('reset role');
      await asUser(client, world.users.southManager);
      const status = await client.query('select * from public.sync_queue_status($1)', [
        world.users.puneMr.id,
      ]);
      expect(status.rows).toEqual([]);
    });
  });

  it('does not let an MR read another MR queue directly', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.southMr);
      await push(client, [
        {
          id: randomUUID(),
          entity: 'visit',
          operation: 'create',
          entityId: randomUUID(),
          clientCreatedAt: WED_1000_IST,
          payload: { doctorId: world.doctors.south, status: 'completed' },
        },
      ]);
      await client.query('reset role');
      await asUser(client, world.users.puneMr);
      const rows = await client.query('select id from public.sync_items where mr_id = $1', [
        world.users.southMr.id,
      ]);
      expect(rows.rows).toEqual([]);
    });
  });

  it('does not let the field write sync_items directly', async () => {
    await expect(
      asUserTx(world.users.puneMr, (client) =>
        client.query(
          `insert into public.sync_items (id, mr_id, entity, operation, entity_id, payload, status, client_created_at)
           values (gen_random_uuid(), $1, 'visit', 'create', gen_random_uuid(), '{}', 'accepted', now())`,
          [world.users.puneMr.id],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

// =============================================================================
// The shift-window rule, exposed for client-side advisory checks
// =============================================================================

describe.skipIf(!reachable)('my_shift_window', () => {
  it('returns the resolved window and the territory it came from', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const result = await client.query<{ payload: Record<string, unknown> }>(
        'select public.my_shift_window() as payload',
      );
      const payload = result.rows[0]?.payload;
      expect(payload?.['resolvedFromTerritoryId']).toBe(world.territories.national);
      expect((payload?.['window'] as Record<string, unknown>)['timezone']).toBe('Asia/Kolkata');
    });
  });

  it('reports an unconfigured window as null rather than an error', async () => {
    // The app must render "your hours are not configured, captures will be refused".
    // An exception here would look like a transient failure worth retrying.
    await inRolledBackTransaction(async (client) => {
      await client.query('delete from public.territory_shift_windows');
      await asUser(client, world.users.puneMr);
      const result = await client.query<{ payload: Record<string, unknown> }>(
        'select public.my_shift_window() as payload',
      );
      expect(result.rows[0]?.payload['window']).toBeNull();
    });
  });
});
