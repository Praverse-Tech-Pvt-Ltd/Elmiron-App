import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * MR-12 Part D — `not_met`, the outcome an MR could not previously record.
 *
 * The decision was taken by the reviewer on the operator's behalf in MR-11 C5 and recorded
 * in `.ai-collab/decisions.md` before anything was built. Its terms are the tests below:
 * the reason is REQUIRED, the copy claims ATTENDANCE rather than success, and `not_met` is
 * NEVER scored against the MR.
 *
 * D5 asks for two-sided mutation, and every case here has its opposite: the constraint
 * that requires a reason is paired with the one that forbids it, and each guard is shown
 * both refusing what it must refuse and admitting what it must admit.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

const CLINIC_LAT = 18.5204;
const CLINIC_LON = 73.8567;
const WED_1025_IST = '2026-08-12T10:25:00+05:30';

const asUserTx = async <T>(user: FixtureUser, fn: (client: Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await asUser(client, user);
    return fn(client);
  });

const aVisit = async (client: Client): Promise<string> => {
  const visitId = randomUUID();
  await client.query(
    `insert into public.visits (id, mr_id, doctor_id, clinic_address_id, status)
     values ($1, $2, $3, $4, 'in_progress')`,
    [visitId, world.users.puneMr.id, world.doctors.pune, world.clinicAddresses.pune],
  );
  return visitId;
};

const checkOut = async (client: Client, visitId: string, reason?: string): Promise<void> => {
  await client.query('select * from public.record_check_out($1, $2, $3, $4, $5, null, $6, $7)', [
    randomUUID(),
    visitId,
    CLINIC_LAT,
    CLINIC_LON,
    WED_1025_IST,
    'automatic',
    reason ?? null,
  ]);
};

const visitRow = async (
  client: Client,
  visitId: string,
): Promise<{ status: string; not_met_reason: string | null; completed_at: string | null }> => {
  const row = await client.query<{
    status: string;
    not_met_reason: string | null;
    completed_at: string | null;
  }>('select status, not_met_reason, completed_at from public.visits where id = $1', [visitId]);
  const found = row.rows[0];
  if (found === undefined) throw new Error('visit vanished');
  return found;
};

// =============================================================================
// D1 — the constraint pair
// =============================================================================

describe.skipIf(!reachable)('D1: not_met requires a reason, and only not_met may have one', () => {
  it('refuses a not_met visit with no reason', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      await expect(
        client.query(
          `insert into public.visits (id, mr_id, doctor_id, clinic_address_id, status)
           values ($1, $2, $3, $4, 'not_met')`,
          [randomUUID(), world.users.puneMr.id, world.doctors.pune, world.clinicAddresses.pune],
        ),
      ).rejects.toMatchObject({ constraint: 'visits_not_met_has_reason' });
    });
  });

  it('and admits one WITH a reason — the positive control', async () => {
    // A constraint that refused every not_met would satisfy the case above.
    await asUserTx(world.users.puneMr, async (client) => {
      const id = randomUUID();
      await client.query(
        `insert into public.visits (id, mr_id, doctor_id, clinic_address_id, status, not_met_reason)
         values ($1, $2, $3, $4, 'not_met', 'Doctor called into theatre')`,
        [id, world.users.puneMr.id, world.doctors.pune, world.clinicAddresses.pune],
      );
      expect((await visitRow(client, id)).not_met_reason).toBe('Doctor called into theatre');
    });
  });

  /**
   * The other half of the pair, and the reason `consent_records` has two constraints
   * rather than one. Without this a visit corrected from `not_met` to `completed` keeps
   * "doctor in theatre" attached to it — a reason that outlives the status it explained is
   * a reason that lies, and it lies in a row a manager reads.
   */
  it('refuses a reason on a visit that is NOT not_met', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      await expect(
        client.query(
          `insert into public.visits
             (id, mr_id, doctor_id, clinic_address_id, status, not_met_reason)
           values ($1, $2, $3, $4, 'completed', 'Doctor called into theatre')`,
          [randomUUID(), world.users.puneMr.id, world.doctors.pune, world.clinicAddresses.pune],
        ),
      ).rejects.toMatchObject({ constraint: 'visits_reason_only_when_not_met' });
    });
  });

  it('and clears the reason when the status moves off not_met', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const id = randomUUID();
      await client.query(
        `insert into public.visits (id, mr_id, doctor_id, clinic_address_id, status, not_met_reason)
         values ($1, $2, $3, $4, 'not_met', 'Doctor called into theatre')`,
        [id, world.users.puneMr.id, world.doctors.pune, world.clinicAddresses.pune],
      );
      // Moving the status without clearing the reason must fail, not silently keep it.
      // Behind a savepoint: a constraint violation aborts the transaction, and the second
      // half of this case has to run in a live one.
      await client.query('savepoint before_bad_update');
      await expect(
        client.query(`update public.visits set status = 'completed' where id = $1`, [id]),
      ).rejects.toMatchObject({ constraint: 'visits_reason_only_when_not_met' });
      await client.query('rollback to savepoint before_bad_update');

      await client.query(
        `update public.visits set status = 'completed', not_met_reason = null where id = $1`,
        [id],
      );
      expect((await visitRow(client, id)).status).toBe('completed');
    });
  });
});

// =============================================================================
// D2 — record_check_out writes the outcome
// =============================================================================

describe.skipIf(!reachable)('D2: record_check_out states the outcome', () => {
  it('writes not_met with the reason when the doctor was unavailable', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const visitId = await aVisit(client);
      await checkOut(client, visitId, 'Doctor called into theatre');

      const visit = await visitRow(client, visitId);
      expect(visit.status).toBe('not_met');
      expect(visit.not_met_reason).toBe('Doctor called into theatre');
      // The visit still ENDED. An MR who attended and found nobody has spent that time,
      // and erasing it is the same shape of harm as scoring the outcome against them.
      expect(visit.completed_at).not.toBeNull();
    });
  });

  it('writes completed when no reason is given — the positive control', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const visitId = await aVisit(client);
      await checkOut(client, visitId);

      const visit = await visitRow(client, visitId);
      expect(visit.status).toBe('completed');
      expect(visit.not_met_reason).toBeNull();
      expect(visit.completed_at).not.toBeNull();
    });
  });

  /**
   * A blank reason is not a reason. Without the `nullif(trim(...), '')` a UI that sends an
   * empty string for "no reason" would file every ordinary check-out as `not_met` — and
   * the constraint would ACCEPT it, because `''` is not null. The status would be wrong
   * and nothing would report it.
   */
  it('treats whitespace as no reason rather than as a not_met', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const visitId = await aVisit(client);
      await checkOut(client, visitId, '   ');
      expect((await visitRow(client, visitId)).status).toBe('completed');
    });
  });

  it('does not move a visit that was never checked out', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const visitId = await aVisit(client);
      expect((await visitRow(client, visitId)).status).toBe('in_progress');
    });
  });
});

// =============================================================================
// D2 — through the outbox, which is how it will actually arrive
// =============================================================================

/**
 * `apply_sync_item` is REVOKED from `authenticated` — deliberately, and MR-12 Part B
 * pinned that. A client cannot call it; only `sync_push`, which is SECURITY DEFINER, may.
 * So these cases install the MR's claims (so `auth.uid()` resolves) WITHOUT switching
 * role, which is the shape `sync_push` runs in. Calling `asUser` here fails with
 * "permission denied for function apply_sync_item", and that failure is the guard working.
 */
const asClaimsOnly = async <T>(user: FixtureUser, fn: (client: Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await client.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({ sub: user.id, role: 'authenticated', aud: 'authenticated' }),
    ]);
    return fn(client);
  });

describe.skipIf(!reachable)('D2: a check-out queued offline keeps its outcome', () => {
  /**
   * `apply_sync_item` called `record_check_out` with seven arguments. The eighth has a
   * default, so nothing BROKE — a queued not-met check-out simply arrived as `completed`
   * with the reason dropped. That is the Part B class exactly: a write that succeeds as
   * the wrong thing, invisible because the row does arrive.
   */
  it('carries notMetReason through apply_sync_item', async () => {
    await asClaimsOnly(world.users.puneMr, async (client) => {
      const visitId = await aVisit(client);
      await client.query(
        `select public.apply_sync_item('check_out'::public.sync_entity_kind, $1, $2::jsonb)`,
        [
          randomUUID(),
          JSON.stringify({
            visitId,
            latitude: CLINIC_LAT,
            longitude: CLINIC_LON,
            occurredAt: WED_1025_IST,
            notMetReason: 'Doctor called into theatre',
          }),
        ],
      );

      const visit = await visitRow(client, visitId);
      expect(visit.status, 'a queued not-met check-out arrived as completed').toBe('not_met');
      expect(visit.not_met_reason).toBe('Doctor called into theatre');
    });
  });

  it('and still completes an ordinary queued check-out', async () => {
    await asClaimsOnly(world.users.puneMr, async (client) => {
      const visitId = await aVisit(client);
      await client.query(
        `select public.apply_sync_item('check_out'::public.sync_entity_kind, $1, $2::jsonb)`,
        [
          randomUUID(),
          JSON.stringify({
            visitId,
            latitude: CLINIC_LAT,
            longitude: CLINIC_LON,
            occurredAt: WED_1025_IST,
          }),
        ],
      );
      expect((await visitRow(client, visitId)).status).toBe('completed');
    });
  });
});

// =============================================================================
// D4 — never scored against the MR
// =============================================================================

describe.skipIf(!reachable)('D4: not_met is never scored against the MR', () => {
  /**
   * **Asserted against the schema, not against prose.** A metric that punishes an honest
   * outcome manufactures dishonest ones, so the guarantee has to be that the database has
   * no column such a metric could read. There is no `not_met_by`, no fault column and no
   * attribution to a person anywhere in the shape.
   */
  it('has no column attributing a not_met to a person', async () => {
    await inRolledBackTransaction(async (client) => {
      const cols = await client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'visits'`,
      );
      const names = cols.rows.map((r) => r.column_name);
      expect(names).toContain('not_met_reason');
      for (const forbidden of ['not_met_by', 'not_met_fault', 'mr_at_fault', 'not_met_blame']) {
        expect(names, `visits.${forbidden} attributes an honest outcome to a person`).not.toContain(
          forbidden,
        );
      }
    });
  });

  /**
   * The manager-facing surface must not count it as a failure either. `team_activity` is
   * the view a field manager reads; if `not_met` ever appears there in a "missed" or
   * "failed" sense it is being scored, whatever the schema says.
   */
  it('and no manager-facing view treats it as an MR failure', async () => {
    await inRolledBackTransaction(async (client) => {
      const views = await client.query<{ viewname: string; definition: string }>(
        `select viewname, definition from pg_views where schemaname = 'public'`,
      );
      for (const view of views.rows) {
        const scored =
          /not_met/i.test(view.definition) && /fail|miss|penal|blame/i.test(view.definition);
        expect(scored, `view ${view.viewname} scores not_met as a failure`).toBe(false);
      }
    });
  });
});
