import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase, withClient } from './db.js';
import { asOwner, mintAccessToken, rest } from './auth.js';
import { refusalForSqlState } from '@fieldforce/core';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * MR-08 Part B — BE-W84. What a `visits` row must satisfy to be coherent.
 *
 * `visits` had direct INSERT and UPDATE grants and **no validation trigger at all**. A
 * probe against the live schema put five incoherent visits in and all five were accepted:
 * a cross-tenant doctor, another doctor's clinic address, another MR's beat plan, a
 * `started_at` a year in the future and a `completed_at` a year in the future.
 *
 * **Each rule is proved twice, and the two are different claims.**
 *
 *   * **as an ordinary MR over REST** — what a client is told, through Kong and
 *     PostgREST, which is the path Part C converts the app onto;
 *   * **as `postgres`** — a role with `BYPASSRLS` that holds every grant, and what
 *     `apply_sync_item`, every fixture and any future service connects as. RLS says
 *     nothing to it, so this is the half that proves the rule is in the trigger rather
 *     than in a policy.
 *
 * That distinction is the whole finding. `visits_insert_own` already refused a doctor
 * outside the MR's territory over REST — and `apply_sync_item` is `SECURITY DEFINER` and
 * takes `doctorId` straight from the payload, so **the offline path was weaker than the
 * online one for a rule the product had already stated.**
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

interface VisitOverrides {
  doctorId?: string;
  clinicAddressId?: string | null;
  beatPlanId?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  mrId?: string;
}

/** Inserts a visit as the OWNER, so only the trigger can refuse it. */
const insertAsOwner = async (client: Client, overrides: VisitOverrides = {}) =>
  asOwner(client, () =>
    client.query(
      `insert into public.visits
         (id, mr_id, doctor_id, clinic_address_id, beat_plan_id, status, started_at, completed_at)
       values ($1, $2, $3, $4, $5, 'in_progress', $6, $7)`,
      [
        randomUUID(),
        overrides.mrId ?? world.users.puneMr.id,
        overrides.doctorId ?? world.doctors.pune,
        overrides.clinicAddressId ?? null,
        overrides.beatPlanId ?? null,
        overrides.startedAt ?? new Date().toISOString(),
        overrides.completedAt ?? null,
      ],
    ),
  );

describe.skipIf(!reachable)('B3 — every rule refuses, as the owner and over REST', () => {
  it('THE POSITIVE CONTROL: a coherent visit is still accepted', async () => {
    // Every refusal below is also what a trigger that rejects everything produces, and
    // that failure would close BE-W84 by making the product unusable.
    await inRolledBackTransaction(async (client) => {
      await insertAsOwner(client, { clinicAddressId: world.clinicAddresses.pune });
      const rows = await asOwner(client, () =>
        client.query('select 1 from public.visits where mr_id = $1', [world.users.puneMr.id]),
      );
      expect(rows.rowCount ?? 0).toBeGreaterThan(0);
    });
  });

  it('R1 cross-TENANT doctor is refused 42501, even as postgres', async () => {
    // The probe accepted this. `visible_territory_ids` is organisation-scoped since MR-06,
    // so the territory rule would catch it too — but a cross-tenant visit deserves to be
    // told it crossed a tenant, not that it picked the wrong territory.
    await inRolledBackTransaction(async (client) => {
      await expect(insertAsOwner(client, { doctorId: world.doctors.rival })).rejects.toMatchObject({
        code: '42501',
      });
    });
  });

  it('R2 a doctor outside the MR territory is refused 42501 as postgres too', async () => {
    // `visits_insert_own` refuses this over REST and always has. `apply_sync_item`
    // bypasses RLS entirely, so before this trigger the offline path accepted it.
    await inRolledBackTransaction(async (client) => {
      await expect(insertAsOwner(client, { doctorId: world.doctors.south })).rejects.toMatchObject({
        code: '42501',
      });
    });
  });

  it('R2 over REST, an ordinary MR is told not_permitted — the contract is unchanged', async () => {
    // The code follows the remedy rather than the layer that noticed. A BEFORE trigger
    // fires ahead of the policy's WITH CHECK, so a trigger raising anything but 42501
    // would silently change what an MR is told about a situation that has not changed.
    const response = await rest('/visits', {
      method: 'POST',
      token: mintAccessToken(world.users.puneMr),
      body: {
        id: randomUUID(),
        doctor_id: world.doctors.south,
      },
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = response.body as { code?: string };
    expect(refusalForSqlState(body.code).code).toBe('not_permitted');
  });

  it('R3 a clinic address belonging to another doctor is refused 23514', async () => {
    // Shape, not permission: `record_check_in` measures the geofence from this address,
    // so a visit pointing at another doctor's clinic makes
    // `distance_from_clinic_metres` a measurement against the wrong building.
    await inRolledBackTransaction(async (client) => {
      await expect(
        insertAsOwner(client, {
          doctorId: world.doctors.pune,
          clinicAddressId: world.clinicAddresses.south,
        }),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  it('R4 a beat plan belonging to another MR is refused 23514', async () => {
    await inRolledBackTransaction(async (client) => {
      const otherPlan = randomUUID();
      await asOwner(client, () =>
        client.query(
          `insert into public.beat_plans (id, mr_id, territory_id, plan_date, status)
           values ($1, $2, $3, current_date, 'submitted')`,
          [otherPlan, world.users.southMr.id, world.territories.south],
        ),
      );
      await expect(insertAsOwner(client, { beatPlanId: otherPlan })).rejects.toMatchObject({
        code: '23514',
      });
    });
  });

  it('R5 started_at in the future is refused 45007, with the visit-shaped remedy', async () => {
    await inRolledBackTransaction(async (client) => {
      try {
        await insertAsOwner(client, {
          startedAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
        });
        throw new Error('a visit starting a year from now was accepted');
      } catch (error: unknown) {
        const e = error as { code?: string; hint?: string };
        expect(e.code).toBe('45007');
        // 45007's consent hint says "do not re-ask the doctor", which would be nonsense
        // here. The remedy is the same — fix the clock — and the sentence is not.
        expect(e.hint).toMatch(/device clock is ahead/i);
        expect(e.hint).not.toMatch(/re-?ask the doctor/i);
      }
    });
  });

  it('R6 completed_at in the future is refused 45007', async () => {
    await inRolledBackTransaction(async (client) => {
      await expect(
        insertAsOwner(client, {
          completedAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
        }),
      ).rejects.toMatchObject({ code: '45007' });
    });
  });

  it('scheduled_for in the future is ACCEPTED — a beat plan schedules ahead', async () => {
    // The rejected candidate, asserted rather than assumed. A bound here would have
    // broken beat planning, and a test that only proves refusals would not have noticed.
    await inRolledBackTransaction(async (client) => {
      await asOwner(client, () =>
        client.query(
          `insert into public.visits (id, mr_id, doctor_id, status, scheduled_for)
           values ($1, $2, $3, 'planned', now() + interval '3 days')`,
          [randomUUID(), world.users.puneMr.id, world.doctors.pune],
        ),
      );
    });
  });

  it('an UPDATE cannot move a coherent visit to an incoherent one', async () => {
    // The trigger is `before insert or update of ...`. Without the update clause a client
    // could insert a valid visit and then repoint it, which is the same defect with an
    // extra statement in front of it.
    await inRolledBackTransaction(async (client) => {
      const id = randomUUID();
      await asOwner(client, () =>
        client.query(
          `insert into public.visits (id, mr_id, doctor_id, status, started_at)
           values ($1, $2, $3, 'in_progress', now())`,
          [id, world.users.puneMr.id, world.doctors.pune],
        ),
      );
      await expect(
        asOwner(client, () =>
          client.query('update public.visits set doctor_id = $2 where id = $1', [
            id,
            world.doctors.rival,
          ]),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});

describe.skipIf(!reachable)('B4 — the fixture that encoded an impossible state', () => {
  it('nagpurMr can only be booked against a doctor in a territory they cover', async () => {
    // `manager.spec`'s consent-divergence fixture booked nagpurMr against the PUNE
    // doctor. `visits_insert_own` had always refused that over REST; the fixture wrote as
    // `postgres`, so nothing checked it. Third fixture in this project found encoding a
    // state the product refuses, after a doctor shown a notice before it existed and
    // consents seeded 27 days old.
    await inRolledBackTransaction(async (client) => {
      await expect(
        insertAsOwner(client, {
          mrId: world.users.nagpurMr.id,
          doctorId: world.doctors.pune,
        }),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('and no visit in the committed fixtures violates the rules it now enforces', async () => {
    // A sweep rather than a spot check. If any fixture still holds an incoherent visit,
    // the number below is not zero and the message names how many.
    await withClient(async (client) => {
      const bad = await client.query<{ n: string }>(
        `select count(*) as n
           from public.visits v
           join public.doctors d on d.id = v.doctor_id
           join public.user_profiles p on p.id = v.mr_id
          where p.organisation_id is distinct from d.organisation_id
             or not exists (
                  select 1 from public.visible_territory_ids(v.mr_id) t
                   where t = d.territory_id)`,
      );
      expect(Number(bad.rows[0]?.n), 'committed fixtures hold incoherent visits').toBe(0);
    });
  });
});
