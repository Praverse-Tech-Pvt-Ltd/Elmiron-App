import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase, withClient } from './db.js';
import { asOwner, asUser, withIdentityLock } from './auth.js';
import type { ProfileLike } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';
import {
  DayReviewSchema,
  PLANNING_RPC,
  PlannableDoctorSchema,
  PlannableRepSchema,
  PlanningGrantRevocationSchema,
  PlanningGrantSchema,
  PlanSummarySchema,
  UnplannedVisitReviewSchema,
} from '@fieldforce/core';

/**
 * `BE-W171` / `BE-C78` — the manager plans a rep's day (`20261009000200_manager_planning`).
 *
 * The matrix, one `describe` per rule:
 *   who may plan (own subtree; a grant; a revoked or expired grant; another company; a rep; an admin)
 *   what a plan writes (versions, visits, idempotency, history untouched)
 *   reassignment (never silent; explicit and audited)
 *   unplanned visits (explicit, with a reason, reviewed afterwards; a malformed visit is not one)
 *   the rep receives the planned day through `sync_pull`, and works it through `sync_push`
 *
 * Every planned date is in 2030, because `plan_mr_day` refuses a day that has already ended in
 * the rep's zone -- which is itself asserted below.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

const DAY = '2030-01-16';
const NEXT_DAY = '2030-01-17';

type Person = FixtureUser | ProfileLike;

interface PlanSummary {
  beatPlanId: string;
  version: number;
  unchanged: boolean;
  replayed: boolean;
  visitsCreated: number;
  visitsMoved: number;
  visitsCancelled: number;
  visitsKept: number;
}

interface VisitRow {
  id: string;
  mr_id: string;
  doctor_id: string;
  beat_plan_id: string | null;
  status: string;
  origin: string;
  planned_date: string | null;
  unplanned_reason: string | null;
}

const asTx = async <T>(user: Person, fn: (client: Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await asUser(client, user);
    return fn(client);
  });

/** The SQLSTATE and message a statement fails with -- or nulls when it succeeds. */
const failure = async (client: Client, sql: string, params: unknown[] = []) => {
  await client.query('savepoint probe');
  try {
    await client.query(sql, params);
    await client.query('release savepoint probe');
    return { code: null, message: null, hint: null };
  } catch (error) {
    await client.query('rollback to savepoint probe');
    const e = error as { code?: string; message?: string; hint?: string };
    return { code: e.code ?? 'unknown', message: e.message ?? '', hint: e.hint ?? null };
  }
};

const PLAN_SQL = 'select public.plan_mr_day($1, $2::date, $3::jsonb, $4) as summary';

const plan = async (
  client: Client,
  mrId: string,
  date: string,
  doctorIds: readonly string[],
  requestId: string = randomUUID(),
): Promise<PlanSummary> => {
  const result = await client.query<{ summary: PlanSummary }>(PLAN_SQL, [
    mrId,
    date,
    JSON.stringify(doctorIds.map((doctorId) => ({ doctorId }))),
    requestId,
  ]);
  const summary = result.rows[0]?.summary;
  if (summary === undefined) throw new Error('plan_mr_day returned nothing');
  return summary;
};

const planFails = (client: Client, mrId: string, date: string, doctorIds: readonly string[]) =>
  failure(client, PLAN_SQL, [
    mrId,
    date,
    JSON.stringify(doctorIds.map((doctorId) => ({ doctorId }))),
    randomUUID(),
  ]);

/** Read as the owner, so RLS never hides what the assertion is about. */
const visitsOf = async (client: Client, mrId: string, date: string): Promise<VisitRow[]> =>
  asOwner(client, async () => {
    const rows = await client.query<VisitRow>(
      `select id, mr_id, doctor_id, beat_plan_id, status::text, origin::text,
              planned_date::text, unplanned_reason
         from public.visits where mr_id = $1 and planned_date = $2 order by created_at, id`,
      [mrId, date],
    );
    return rows.rows;
  });

/** A doctor in a territory, written as the owner (master data). */
const makeDoctor = async (client: Client, territoryId: string): Promise<string> =>
  asOwner(client, async () => {
    const id = randomUUID();
    await client.query(
      `insert into public.doctors (id, organisation_id, full_name, territory_id)
       values ($1, $2, $3, $4)`,
      [id, world.organisationId, `Dr Planning ${id.slice(0, 6)}`, territoryId],
    );
    return id;
  });

/** A second rep in a territory, inside the caller's transaction. Serialised (`BE-W116`). */
const makeRep = async (client: Client, territoryId: string): Promise<ProfileLike> =>
  withIdentityLock(async () => {
    const id = randomUUID();
    await asOwner(client, async () => {
      await client.query(
        `insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')`,
        [id, `planning-rep-${id.slice(0, 8)}@example.test`],
      );
      await client.query(
        `insert into public.user_profiles (id, full_name, role, territory_id, is_active, organisation_id)
         values ($1, 'Planning Rep', 'mr', $2, true, $3)`,
        [id, territoryId, world.organisationId],
      );
    });
    return { id, role: 'mr', territoryId, isActive: true };
  });

const grant = async (
  client: Client,
  managerId: string,
  territoryId: string,
  from: string,
  until: string | null,
): Promise<string> => {
  await asUser(client, world.users.admin);
  const result = await client.query<{ id: string }>(
    'select (public.grant_planning_access($1, $2, $3::date, $4::date, $5)).id as id',
    [managerId, territoryId, from, until, 'covering for a colleague on leave'],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('grant_planning_access returned nothing');
  return id;
};

// =============================================================================
// 1. Who may plan
// =============================================================================

describe.skipIf(!reachable)('BE-C78 — who may plan a rep’s day', () => {
  it('a manager plans a rep in their own territory subtree', async () => {
    await asTx(world.users.westManager, async (client) => {
      const summary = await plan(client, world.users.puneMr.id, DAY, [world.doctors.pune]);
      expect(summary).toMatchObject({ version: 1, unchanged: false, visitsCreated: 1 });

      const visits = await visitsOf(client, world.users.puneMr.id, DAY);
      expect(visits).toHaveLength(1);
      expect(visits[0]).toMatchObject({
        doctor_id: world.doctors.pune,
        beat_plan_id: summary.beatPlanId,
        status: 'planned',
        origin: 'planned',
        planned_date: DAY,
        unplanned_reason: null,
      });
      // The visit is on the plan's DAY by the server's own rule, which is what the phone shows.
      const day = await asOwner(client, async () =>
        client.query<{ d: string }>(
          'select public.visit_day(v)::text as d from public.visits v where v.id = $1',
          [visits[0]?.id],
        ),
      );
      expect(day.rows[0]?.d).toBe(DAY);
    });
  });

  it('a manager cannot plan a rep outside their territory', async () => {
    await asTx(world.users.southManager, async (client) => {
      const refused = await planFails(client, world.users.puneMr.id, DAY, [world.doctors.pune]);
      expect(refused.code).toBe('42501');
      expect(await visitsOf(client, world.users.puneMr.id, DAY)).toHaveLength(0);
    });
  });

  it('an admin’s grant lets that manager plan there — for the granted dates only', async () => {
    await inRolledBackTransaction(async (client) => {
      await grant(client, world.users.southManager.id, world.territories.pune, DAY, DAY);
      await asUser(client, world.users.southManager);

      const summary = await plan(client, world.users.puneMr.id, DAY, [world.doctors.pune]);
      expect(summary.visitsCreated).toBe(1);

      const nextDay = await planFails(client, world.users.puneMr.id, NEXT_DAY, [
        world.doctors.pune,
      ]);
      expect(nextDay.code, 'the grant ended the day before').toBe('42501');
    });
  });

  it('a revoked grant plans nothing, and revoking twice is one revocation', async () => {
    await inRolledBackTransaction(async (client) => {
      const grantId = await grant(
        client,
        world.users.southManager.id,
        world.territories.pune,
        DAY,
        null,
      );
      const first = await client.query<{ id: string }>(
        'select (public.revoke_planning_access($1, $2)).id as id',
        [grantId, 'colleague is back'],
      );
      const second = await client.query<{ id: string }>(
        'select (public.revoke_planning_access($1, $2)).id as id',
        [grantId, 'clicked twice'],
      );
      expect(second.rows[0]?.id).toBe(first.rows[0]?.id);

      await asUser(client, world.users.southManager);
      const refused = await planFails(client, world.users.puneMr.id, DAY, [world.doctors.pune]);
      expect(refused.code).toBe('42501');
    });
  });

  it('a manager cannot plan for another company, and another company’s admin cannot grant', async () => {
    await asTx(world.users.westManager, async (client) => {
      const refused = await planFails(client, world.users.rivalMr.id, DAY, [world.doctors.rival]);
      expect(refused.code).toBe('42501');
    });
    await asTx(world.users.rivalAdmin, async (client) => {
      const refused = await failure(
        client,
        'select public.grant_planning_access($1, $2, $3::date, null, $4)',
        [world.users.westManager.id, world.territories.rival, DAY, 'cross-tenant attempt'],
      );
      expect(refused.code).toBe('42501');
    });
  });

  it('a rep cannot plan — not through the RPC, not by writing a plan row', async () => {
    await asTx(world.users.puneMr, async (client) => {
      const viaRpc = await planFails(client, world.users.puneMr.id, DAY, [world.doctors.pune]);
      expect(viaRpc.code).toBe('42501');

      const viaTable = await failure(
        client,
        `insert into public.beat_plans (mr_id, territory_id, plan_date) values ($1, $2, $3)`,
        [world.users.puneMr.id, world.territories.pune, DAY],
      );
      expect(viaTable.code).toBe('42501');
    });
  });

  it('an admin plans nothing and writes no visit — and says why', async () => {
    await asTx(world.users.admin, async (client) => {
      const viaRpc = await planFails(client, world.users.puneMr.id, DAY, [world.doctors.pune]);
      expect(viaRpc.code).toBe('42501');
      expect(viaRpc.hint).toContain('BE-C78');

      const forARep = await failure(
        client,
        `insert into public.visits (id, mr_id, doctor_id, origin, unplanned_reason)
         values ($1, $2, $3, 'unplanned', 'admin attempt')`,
        [randomUUID(), world.users.puneMr.id, world.doctors.pune],
      );
      expect(forARep.code).toBe('42501');

      const forThemselves = await failure(
        client,
        `insert into public.visits (id, mr_id, doctor_id, origin, unplanned_reason)
         values ($1, $2, $3, 'unplanned', 'admin attempt')`,
        [randomUUID(), world.users.admin.id, world.doctors.pune],
      );
      expect(forThemselves.code).toBe('42501');

      const internal = await failure(
        client,
        `select public.write_plan_version(m, r, $3::date, '[]'::jsonb, null)
           from public.user_profiles m, public.user_profiles r where m.id = $1 and r.id = $2`,
        [world.users.admin.id, world.users.puneMr.id, DAY],
      );
      expect(internal.code, 'the internal writer is not callable by a client').toBe('42501');
    });
  });

  it('a day that has ended in the rep’s zone cannot be planned', async () => {
    await asTx(world.users.westManager, async (client) => {
      const refused = await planFails(client, world.users.puneMr.id, '2020-01-01', [
        world.doctors.pune,
      ]);
      expect(refused.code).toBe('22023');
      expect(refused.message).toContain('plan_date_in_past');
    });
  });

  it('a doctor outside the rep’s territory cannot be on their plan', async () => {
    await inRolledBackTransaction(async (client) => {
      const nagpurDoctor = await makeDoctor(client, world.territories.nagpur);
      await asUser(client, world.users.westManager);
      const refused = await planFails(client, world.users.puneMr.id, DAY, [nagpurDoctor]);
      expect(refused.code).toBe('42501');
    });
  });
});

describe.skipIf(!reachable)(
  'BE-C78 — what the console reads, in the shared contract’s shapes',
  () => {
    it('a GRANT opens the rep and their doctors to the picker, where RLS alone would show nothing', async () => {
      await inRolledBackTransaction(async (client) => {
        await asUser(client, world.users.southManager);
        const before = await client.query(
          `select * from public.${PLANNING_RPC.plannableReps}($1::date)`,
          [DAY],
        );
        expect(before.rows.map((r: { mr_id: string }) => r.mr_id)).not.toContain(
          world.users.puneMr.id,
        );

        await grant(client, world.users.southManager.id, world.territories.pune, DAY, DAY);
        await asUser(client, world.users.southManager);

        const reps = (
          await client.query(`select * from public.${PLANNING_RPC.plannableReps}($1::date)`, [DAY])
        ).rows.map((r) => PlannableRepSchema.parse(r));
        expect(reps.find((r) => r.mr_id === world.users.puneMr.id)).toMatchObject({
          via_grant: true,
        });

        const doctors = (
          await client.query(
            `select * from public.${PLANNING_RPC.plannableDoctors}($1, $2::date)`,
            [world.users.puneMr.id, DAY],
          )
        ).rows.map((r) => PlannableDoctorSchema.parse(r));
        expect(doctors.map((d) => d.doctor_id)).toContain(world.doctors.pune);
        expect(
          doctors.find((d) => d.doctor_id === world.doctors.pune)?.clinics.map((c) => c.id),
        ).toContain(world.clinicAddresses.pune);

        // The grant is PLANNING scope, not visibility: the doctor is still not readable as a table row.
        const direct = await client.query('select id from public.doctors where id = $1', [
          world.doctors.pune,
        ]);
        expect(direct.rowCount).toBe(0);

        // And outside the granted day, the picker is closed again.
        const closed = await failure(
          client,
          `select * from public.${PLANNING_RPC.plannableDoctors}($1, $2::date)`,
          [world.users.puneMr.id, NEXT_DAY],
        );
        expect(closed.code).toBe('42501');
      });
    });

    it('grant, revoke and review rows parse with the shared schemas', async () => {
      await inRolledBackTransaction(async (client) => {
        await asUser(client, world.users.admin);
        const granted = await client.query<{ g: unknown }>(
          'select to_jsonb(public.grant_planning_access($1, $2, $3::date, null, $4)) as g',
          [world.users.southManager.id, world.territories.pune, DAY, 'covering for a colleague'],
        );
        const grantRow = PlanningGrantSchema.parse(granted.rows[0]?.g);
        const revoked = await client.query<{ r: unknown }>(
          'select to_jsonb(public.revoke_planning_access($1, $2)) as r',
          [grantRow.id, 'colleague is back'],
        );
        expect(PlanningGrantRevocationSchema.parse(revoked.rows[0]?.r).grant_id).toBe(grantRow.id);

        await asUser(client, world.users.puneMr);
        const visitId = randomUUID();
        await client.query(
          `insert into public.visits (id, mr_id, doctor_id, origin, unplanned_reason)
         values ($1, $2, $3, 'unplanned', 'Doctor called me in')`,
          [visitId, world.users.puneMr.id, world.doctors.pune],
        );
        await asUser(client, world.users.westManager);
        const review = await client.query<{ r: unknown }>(
          'select to_jsonb(public.review_unplanned_visit($1, null)) as r',
          [visitId],
        );
        expect(UnplannedVisitReviewSchema.parse(review.rows[0]?.r).visit_id).toBe(visitId);
      });
    });

    it('plan_mr_day and manager_day_review answer in the contract’s shapes', async () => {
      await asTx(world.users.westManager, async (client) => {
        const summary = PlanSummarySchema.parse(
          await plan(client, world.users.puneMr.id, DAY, [world.doctors.pune]),
        );
        const review = await client.query<{ r: unknown }>(
          `select public.${PLANNING_RPC.managerDayReview}($1, $2::date, $2::date) as r`,
          [world.users.puneMr.id, DAY],
        );
        const parsed = DayReviewSchema.parse(review.rows[0]?.r);
        expect(parsed.plans).toHaveLength(1);
        expect(parsed.plans[0]).toMatchObject({ beatPlanId: summary.beatPlanId, version: 1 });
        expect(parsed.plans[0]?.entries.map((e) => e.doctorId)).toEqual([world.doctors.pune]);
        expect(parsed.visits).toHaveLength(1);
        expect(parsed.visits[0]).toMatchObject({
          origin: 'planned',
          status: 'planned',
          plannedDate: DAY,
        });
      });
    });
  },
);

// =============================================================================
// 2. What a plan writes: versions, visits, idempotency
// =============================================================================

describe.skipIf(!reachable)('BE-C78 — a plan is versioned, and a save is idempotent', () => {
  it('an edit is a new version; unstarted visits follow it; nothing is duplicated', async () => {
    await inRolledBackTransaction(async (client) => {
      const second = await makeDoctor(client, world.territories.pune);
      await asUser(client, world.users.westManager);

      const v1 = await plan(client, world.users.puneMr.id, DAY, [world.doctors.pune]);
      const [firstVisit] = await visitsOf(client, world.users.puneMr.id, DAY);

      const v2 = await plan(client, world.users.puneMr.id, DAY, [world.doctors.pune, second]);
      expect(v2).toMatchObject({
        version: 2,
        visitsCreated: 1,
        visitsMoved: 1,
        visitsCancelled: 0,
      });

      const afterV2 = await visitsOf(client, world.users.puneMr.id, DAY);
      expect(afterV2).toHaveLength(2);
      // The SAME visit row follows the plan -- the phone's reference to it stays good.
      expect(afterV2.find((v) => v.doctor_id === world.doctors.pune)).toMatchObject({
        id: firstVisit?.id,
        beat_plan_id: v2.beatPlanId,
      });

      // Version 1 is untouched history: still there, still with its one stop.
      const v1Rows = await asOwner(client, async () =>
        client.query<{ supersededBy: string | null; entries: number }>(
          `select (select n.id from public.beat_plans n where n.supersedes_beat_plan_id = b.id) as "supersededBy",
                  (select count(*)::int from public.beat_plan_entries e where e.beat_plan_id = b.id) as entries
             from public.beat_plans b where b.id = $1`,
          [v1.beatPlanId],
        ),
      );
      expect(v1Rows.rows[0]).toEqual({ supersededBy: v2.beatPlanId, entries: 1 });

      const v3 = await plan(client, world.users.puneMr.id, DAY, [second]);
      expect(v3).toMatchObject({
        version: 3,
        visitsCancelled: 1,
        visitsMoved: 1,
        visitsCreated: 0,
      });
      const afterV3 = await visitsOf(client, world.users.puneMr.id, DAY);
      expect(afterV3.find((v) => v.doctor_id === world.doctors.pune)?.status).toBe('cancelled');
    });
  });

  it('re-saving the same plan writes nothing', async () => {
    await asTx(world.users.westManager, async (client) => {
      const first = await plan(client, world.users.puneMr.id, DAY, [world.doctors.pune]);
      const again = await plan(client, world.users.puneMr.id, DAY, [world.doctors.pune]);
      expect(again).toMatchObject({ beatPlanId: first.beatPlanId, version: 1, unchanged: true });
      expect(await visitsOf(client, world.users.puneMr.id, DAY)).toHaveLength(1);
    });
  });

  it('a retried request returns the first answer and writes nothing — even after a later edit', async () => {
    await inRolledBackTransaction(async (client) => {
      const second = await makeDoctor(client, world.territories.pune);
      await asUser(client, world.users.westManager);
      const requestId = randomUUID();
      const first = await plan(client, world.users.puneMr.id, DAY, [world.doctors.pune], requestId);
      await plan(client, world.users.puneMr.id, DAY, [world.doctors.pune, second]);

      // The client never saw the first response, and retries it.
      const retry = await plan(client, world.users.puneMr.id, DAY, [world.doctors.pune], requestId);
      expect(retry).toMatchObject({ beatPlanId: first.beatPlanId, replayed: true });

      const live = (await visitsOf(client, world.users.puneMr.id, DAY)).filter(
        (v) => v.status !== 'cancelled',
      );
      expect(live, 'the retry did not roll the plan back to version 1').toHaveLength(2);

      const reused = await failure(client, PLAN_SQL, [
        world.users.nagpurMr.id,
        DAY,
        '[]',
        requestId,
      ]);
      expect(reused.code, 'a request id names one save').toBe('22023');
    });
  });

  it('the database refuses a second live planned visit for one rep, doctor and day', async () => {
    await asTx(world.users.westManager, async (client) => {
      const summary = await plan(client, world.users.puneMr.id, DAY, [world.doctors.pune]);
      // The race the index exists for: a SECOND plan write for the same rep, doctor and day. So the
      // insert runs as the plan path does, with its flag set -- otherwise the "only the plan writes
      // a planned visit" rule refuses it first, and the index would go untested.
      await client.query(`select set_config('app.planning_write', 'on', true)`);
      const raced = await asOwner(client, () =>
        failure(
          client,
          `insert into public.visits (id, mr_id, doctor_id, beat_plan_id, origin, planned_date)
           values ($1, $2, $3, $4, 'planned', $5)`,
          [randomUUID(), world.users.puneMr.id, world.doctors.pune, summary.beatPlanId, DAY],
        ),
      );
      expect(raced.code).toBe('23505');
    });
  });

  it('a visit that has started is history: a later plan neither moves nor cancels it', async () => {
    await asTx(world.users.westManager, async (client) => {
      const v1 = await plan(client, world.users.puneMr.id, DAY, [world.doctors.pune]);
      const [visit] = await visitsOf(client, world.users.puneMr.id, DAY);
      await asOwner(client, async () => {
        await client.query(
          `update public.visits set status = 'completed',
                  started_at = now() - interval '2 hours', completed_at = now() - interval '1 hour'
            where id = $1`,
          [visit?.id],
        );
      });

      const v2 = await plan(client, world.users.puneMr.id, DAY, []);
      expect(v2.visitsCancelled).toBe(0);
      const [after] = await visitsOf(client, world.users.puneMr.id, DAY);
      expect(after).toMatchObject({
        id: visit?.id,
        status: 'completed',
        beat_plan_id: v1.beatPlanId,
      });

      const v3 = await plan(client, world.users.puneMr.id, DAY, [world.doctors.pune]);
      expect(v3, 'the completed visit counts; no second visit is made').toMatchObject({
        visitsCreated: 0,
        visitsKept: 1,
      });
    });
  });
});

// =============================================================================
// 3. Reassignment
// =============================================================================

describe.skipIf(!reachable)('BE-C78 — planned work moves only when a manager moves it', () => {
  it('a rep changing territory takes no planned visit anywhere, and a visit’s rep cannot be rewritten', async () => {
    await asTx(world.users.westManager, async (client) => {
      await plan(client, world.users.puneMr.id, DAY, [world.doctors.pune]);
      const [visit] = await visitsOf(client, world.users.puneMr.id, DAY);

      await asOwner(client, async () => {
        await client.query('update public.user_profiles set territory_id = $1 where id = $2', [
          world.territories.nagpur,
          world.users.puneMr.id,
        ]);
      });
      const [after] = await visitsOf(client, world.users.puneMr.id, DAY);
      expect(after).toMatchObject({
        id: visit?.id,
        mr_id: world.users.puneMr.id,
        status: 'planned',
      });

      const rewrite = await asOwner(client, () =>
        failure(client, 'update public.visits set mr_id = $1 where id = $2', [
          world.users.nagpurMr.id,
          visit?.id,
        ]),
      );
      expect(rewrite.code, 'not even the owner moves a visit between reps').toBe('42501');
    });
  });

  it('an explicit reassignment cancels the source, plans the target, and records both', async () => {
    await inRolledBackTransaction(async (client) => {
      const otherRep = await makeRep(client, world.territories.pune);
      await asUser(client, world.users.westManager);
      await plan(client, world.users.puneMr.id, DAY, [world.doctors.pune]);
      const [visit] = await visitsOf(client, world.users.puneMr.id, DAY);

      const requestId = randomUUID();
      const reassign = 'select public.reassign_planned_visits($1::uuid[], $2, $3, $4) as r';
      const result = await client.query<{
        r: { reassigned: { fromVisitId: string; toVisitId: string }[] };
      }>(reassign, [[visit?.id], otherRep.id, 'Pune rep is on leave', requestId]);
      const pair = result.rows[0]?.r.reassigned[0];
      expect(pair?.fromVisitId).toBe(visit?.id);

      expect((await visitsOf(client, world.users.puneMr.id, DAY))[0]?.status).toBe('cancelled');
      const target = await visitsOf(client, otherRep.id, DAY);
      expect(target).toHaveLength(1);
      expect(target[0]).toMatchObject({
        id: pair?.toVisitId,
        origin: 'planned',
        status: 'planned',
      });

      const recorded = await client.query<{ reason: string; by: string }>(
        `select reason, reassigned_by_user_id as by from public.plan_reassignments where from_visit_id = $1`,
        [visit?.id],
      );
      expect(recorded.rows).toEqual([
        { reason: 'Pune rep is on leave', by: world.users.westManager.id },
      ]);

      // A retry returns the same pair and writes nothing.
      const retry = await client.query<{ r: { replayed: boolean; reassigned: unknown[] } }>(
        reassign,
        [[visit?.id], otherRep.id, 'Pune rep is on leave', requestId],
      );
      expect(retry.rows[0]?.r).toMatchObject({ replayed: true, reassigned: [pair] });
      expect(await visitsOf(client, otherRep.id, DAY)).toHaveLength(1);
    });
  });

  it('reassignment needs a reason, a target in the doctor’s territory, and an unstarted visit', async () => {
    await inRolledBackTransaction(async (client) => {
      const otherRep = await makeRep(client, world.territories.pune);
      await asUser(client, world.users.westManager);
      await plan(client, world.users.puneMr.id, DAY, [world.doctors.pune]);
      const [visit] = await visitsOf(client, world.users.puneMr.id, DAY);
      const reassign = 'select public.reassign_planned_visits($1::uuid[], $2, $3, $4)';

      const noReason = await failure(client, reassign, [
        [visit?.id],
        otherRep.id,
        '',
        randomUUID(),
      ]);
      expect(noReason.message).toContain('reassignment_needs_reason');

      const wrongTerritory = await failure(client, reassign, [
        [visit?.id],
        world.users.nagpurMr.id,
        'cover',
        randomUUID(),
      ]);
      expect(wrongTerritory.message).toContain('doctor_outside_target_territory');

      await asOwner(client, async () => {
        await client.query(
          `update public.visits set status = 'in_progress', started_at = now() - interval '5 minutes' where id = $1`,
          [visit?.id],
        );
      });
      const started = await failure(client, reassign, [
        [visit?.id],
        otherRep.id,
        'cover',
        randomUUID(),
      ]);
      expect(started.message).toContain('visit_not_reassignable');
    });
  });
});

// =============================================================================
// 4. Unplanned visits
// =============================================================================

describe.skipIf(!reachable)(
  'BE-C78 — an unplanned visit is explicit, has a reason, and is reviewed',
  () => {
    const push = async (client: Client, items: unknown[]) => {
      const result = await client.query<{
        r: { results: { status: string; rejectionDetail: string | null }[] };
      }>('select public.sync_push($1, $2::jsonb) as r', [randomUUID(), JSON.stringify(items)]);
      return result.rows[0]?.r.results ?? [];
    };
    const visitItem = (visitId: string, payload: Record<string, unknown>) => ({
      id: randomUUID(),
      entity: 'visit',
      operation: 'create',
      entityId: visitId,
      clientCreatedAt: new Date().toISOString(),
      payload: { doctorId: world.doctors.pune, ...payload },
    });

    it('a rep makes one without approval; it is marked, and carries its reason', async () => {
      await asTx(world.users.puneMr, async (client) => {
        const visitId = randomUUID();
        const [verdict] = await push(client, [
          visitItem(visitId, { origin: 'unplanned', unplannedReason: 'Doctor called me in' }),
        ]);
        expect(verdict?.status).toBe('accepted');
        const row = await client.query<VisitRow>(
          'select origin::text, unplanned_reason, beat_plan_id from public.visits where id = $1',
          [visitId],
        );
        expect(row.rows[0]).toMatchObject({
          origin: 'unplanned',
          unplanned_reason: 'Doctor called me in',
          beat_plan_id: null,
        });
      });
    });

    it('no reason, no origin: refused, each with its own reason', async () => {
      await asTx(world.users.puneMr, async (client) => {
        const [noReason, noOrigin] = await push(client, [
          visitItem(randomUUID(), { origin: 'unplanned', unplannedReason: ' ' }),
          visitItem(randomUUID(), {}),
        ]);
        expect(noReason?.status).toBe('rejected');
        expect(noReason?.rejectionDetail).toContain('unplanned_visit_needs_reason');
        expect(noOrigin?.status).toBe('rejected');
        expect(noOrigin?.rejectionDetail).toContain('visit_origin_required');
      });
    });

    it('a malformed visit — no origin, no plan — is refused, never filed as unplanned', async () => {
      await asTx(world.users.puneMr, async (client) => {
        const bare = await failure(
          client,
          `insert into public.visits (id, mr_id, doctor_id) values ($1, $2, $3)`,
          [randomUUID(), world.users.puneMr.id, world.doctors.pune],
        );
        expect(bare.code).toBe('22023');
        expect(bare.message).toContain('visit_origin_required');

        const unplannedWithoutReason = await failure(
          client,
          `insert into public.visits (id, mr_id, doctor_id, origin) values ($1, $2, $3, 'unplanned')`,
          [randomUUID(), world.users.puneMr.id, world.doctors.pune],
        );
        expect(unplannedWithoutReason.code).toBe('23514');

        const plannedByHand = await failure(
          client,
          `insert into public.visits (id, mr_id, doctor_id, beat_plan_id, origin, planned_date)
         values ($1, $2, $3, $4, 'planned', $5)`,
          [randomUUID(), world.users.puneMr.id, world.doctors.pune, world.beatPlans.pune, DAY],
        );
        expect(plannedByHand.code).toBe('42501');
        expect(plannedByHand.message).toContain('planned_visit_from_plan_only');
      });
    });

    it('the manager sees it afterwards, kept apart from planned and unclassified visits, and reviews it', async () => {
      await inRolledBackTransaction(async (client) => {
        await asUser(client, world.users.puneMr);
        const visitId = randomUUID();
        await push(client, [
          visitItem(visitId, {
            origin: 'unplanned',
            unplannedReason: 'Doctor called me in',
            status: 'completed',
            startedAt: new Date(Date.now() - 3_600_000).toISOString(),
            completedAt: new Date(Date.now() - 1_800_000).toISOString(),
          }),
        ]);

        await asUser(client, world.users.westManager);
        const today = await client.query<{ d: string }>(
          `select (now() at time zone z.time_zone)::date::text as d
           from public.day_zone_for($1) z`,
          [world.users.puneMr.id],
        );
        const day = today.rows[0]?.d ?? '';
        const review = await client.query<{
          r: {
            visits: {
              visitId: string;
              origin: string;
              unplannedReason: string | null;
              reviewedByMe: boolean;
            }[];
          };
        }>('select public.manager_day_review($1, $2::date, $2::date) as r', [
          world.users.puneMr.id,
          day,
        ]);
        const seen = review.rows[0]?.r.visits.find((v) => v.visitId === visitId);
        expect(seen).toMatchObject({
          origin: 'unplanned',
          unplannedReason: 'Doctor called me in',
          reviewedByMe: false,
        });

        const first = await client.query<{ id: string }>(
          'select (public.review_unplanned_visit($1, $2)).id as id',
          [visitId, 'fine — a call-in'],
        );
        const again = await client.query<{ id: string }>(
          'select (public.review_unplanned_visit($1, null)).id as id',
          [visitId],
        );
        expect(again.rows[0]?.id).toBe(first.rows[0]?.id);

        await asUser(client, world.users.southManager);
        const outsider = await failure(client, 'select public.review_unplanned_visit($1, null)', [
          visitId,
        ]);
        expect(outsider.code).toBe('42501');
      });
    });

    it('an unclassified (pre-existing) visit is never presented or reviewed as unplanned', async () => {
      await asTx(world.users.westManager, async (client) => {
        const refused = await failure(client, 'select public.review_unplanned_visit($1, null)', [
          world.visits.pune,
        ]);
        expect(refused.code).toBe('22023');
        const origin = await asOwner(client, async () =>
          client.query<{ origin: string }>('select origin::text from public.visits where id = $1', [
            world.visits.pune,
          ]),
        );
        expect(origin.rows[0]?.origin).toBe('unclassified');
      });
    });
  },
);

// =============================================================================
// 5. End to end: the plan reaches the rep through sync, and is worked through sync
// =============================================================================

describe.skipIf(!reachable)('BE-C78 — the planned day reaches the rep and is worked', () => {
  /**
   * COMMITTED, because `sync_pull` cannot see its own transaction's rows (`fixtures.ts`). A fresh
   * rep of its own, so no other suite's pull sees these rows. Its day is collapsed back to ONE plan
   * version at the end: two versions of one rep's day cannot survive `20260813000100`'s rollback,
   * which restores one plan per rep per day, and `verify-rollbacks` runs on what the suite leaves.
   */
  it('plan → pull; a repeated pull, a re-save and an edit never duplicate a visit', async () => {
    // Straight into `auth.users`, as `makeRep` does: the pull reads claims, not a GoTrue session,
    // and this file's GoTrue budget is spent by `seedFixtures()`.
    const rep = await withIdentityLock(async () => {
      const id = randomUUID();
      await withClient(async (client) => {
        await client.query(
          `insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')`,
          [id, `planning-e2e-${id.slice(0, 8)}@example.test`],
        );
        await client.query(
          `insert into public.user_profiles (id, full_name, role, territory_id, is_active, organisation_id)
           values ($1, 'Planning E2E Rep', 'mr', $2, true, $3)`,
          [id, world.territories.pune, world.organisationId],
        );
      });
      return { id, role: 'mr' as const, territoryId: world.territories.pune, isActive: true };
    });

    const committed = async <T>(user: Person, fn: (client: Client) => Promise<T>): Promise<T> =>
      withClient(async (client) => {
        await client.query('begin');
        try {
          await asUser(client, user);
          const value = await fn(client);
          await client.query('commit');
          return value;
        } catch (error) {
          await client.query('rollback');
          throw error;
        }
      });

    const doctor = await withClient(async (client) => {
      const id = randomUUID();
      await client.query(
        `insert into public.doctors (id, organisation_id, full_name, territory_id) values ($1, $2, $3, $4)`,
        [id, world.organisationId, 'Dr Planning E2E', world.territories.pune],
      );
      return id;
    });
    try {
      const summary = await committed(world.users.westManager, (client) =>
        plan(client, rep.id, DAY, [world.doctors.pune]),
      );
      expect(summary.visitsCreated).toBe(1);

      type Change = { entity: string; entityId: string; payload: Record<string, unknown> | null };
      const pullAll = () =>
        committed(rep, async (client) => {
          const r = await client.query<{ p: { changes: Change[] } }>(
            `select public.sync_pull(null, array['visit', 'beat_plan', 'beat_plan_entry'], 500) as p`,
          );
          return r.rows[0]?.p.changes ?? [];
        });
      const plannedVisits = (changes: Change[]) =>
        changes.filter((c) => c.entity === 'visit' && c.payload?.['planned_date'] === DAY);

      const first = await pullAll();
      const visits = plannedVisits(first);
      expect(visits).toHaveLength(1);
      expect(visits[0]?.payload).toMatchObject({
        origin: 'planned',
        status: 'planned',
        beat_plan_id: summary.beatPlanId,
        visit_day: DAY,
      });
      expect(first.some((c) => c.entity === 'beat_plan' && c.entityId === summary.beatPlanId)).toBe(
        true,
      );
      expect(
        first.some(
          (c) =>
            c.entity === 'beat_plan_entry' && c.payload?.['beat_plan_id'] === summary.beatPlanId,
        ),
      ).toBe(true);

      // A repeated pull, and the manager re-saving the same plan, change nothing on the phone.
      await committed(world.users.westManager, (client) =>
        plan(client, rep.id, DAY, [world.doctors.pune]),
      );
      expect(plannedVisits(await pullAll())).toHaveLength(1);

      // An edit reaches the phone as the SAME visit, now on the new version -- never a second visit.
      const v2 = await committed(world.users.westManager, (client) =>
        plan(client, rep.id, DAY, [doctor, world.doctors.pune]),
      );
      const afterEdit = plannedVisits(await pullAll());
      expect(afterEdit).toHaveLength(2);
      expect(afterEdit.find((c) => c.entityId === visits[0]?.entityId)?.payload).toMatchObject({
        beat_plan_id: v2.beatPlanId,
        status: 'planned',
      });
      // Working the day -- check-ins, call reports, check-out against these planned visits, sent
      // twice with no duplicate -- is Gate 1 (`gate1.spec.ts`), on a fixed day inside the window.
    } finally {
      // Visits are history and cannot be deleted (removing one cascades into the append-only
      // `call_reports`), so they stay. What `verify-rollbacks` cannot survive is two versions of one
      // rep's day, so the day is collapsed back to version 1: the visits are re-pointed to it and
      // the newer versions removed, newest first (each references the one it supersedes).
      await withClient(async (client) => {
        const versions = await client.query<{ id: string; version: number }>(
          'select id, version from public.beat_plans where mr_id = $1 order by version desc',
          [rep.id],
        );
        const first = versions.rows.find((v) => v.version === 1);
        if (first === undefined) return;
        await client.query('update public.visits set beat_plan_id = $2 where mr_id = $1', [
          rep.id,
          first.id,
        ]);
        for (const version of versions.rows.filter((v) => v.version > 1)) {
          // Entries first, while their plan still exists: the entries' sync trigger scopes its
          // deletion event by the plan's rep, which a cascade from the plan could no longer read.
          const entries = await client.query<{ id: string }>(
            'delete from public.beat_plan_entries where beat_plan_id = $1 returning id',
            [version.id],
          );
          await client.query('delete from public.beat_plans where id = $1', [version.id]);
          // And the deletion events those two deletes emitted: they describe test rows, and an
          // older rollback (`20260917000300`) restores an entity check that has no
          // `beat_plan_entry`, so a left-over event of that kind fails `verify-rollbacks`.
          await client.query(
            `delete from public.sync_events
              where (entity = 'beat_plan_entry' and entity_id = any($1::uuid[]))
                 or (entity = 'beat_plan' and entity_id = $2)`,
            [entries.rows.map((e) => e.id), version.id],
          );
        }
      });
    }
  });
});
