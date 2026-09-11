import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import { sampleBody } from './sync-bodies.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * BE-W97 — a refusal's FIGURES leave the database.
 *
 * MR-27 C2 drove a real `45004` from the samples screen. It fired, it was refused, and the
 * MR read *"this would put MR27 UCPMP c over the UCPMP cap for
 * 83aa5660-470b-4c82-aa90-000b5347cb1c this month"* — a raw doctor UUID and no numbers.
 * The numbers were never missing; `enforce_ucpmp_sample_cap` has raised with
 * `detail = format('cap %s, already given %s, this entry %s, period starting %s', …)` since
 * BE-W21. `sync_push` called `get stacked diagnostics` for `RETURNED_SQLSTATE` and
 * `MESSAGE_TEXT` and nothing else, so DETAIL and HINT died inside the handler.
 *
 * **These cases are about the TRANSPORT, not about the cap.** They assert that whatever a
 * raise site attaches arrives on the verdict, and that an accepted item carries nothing —
 * because a field that is always populated proves nothing when it is populated.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

interface PushVerdict {
  id: string;
  status: string;
  sqlState: string | null;
  sqlDetail: string | null;
  sqlHint: string | null;
  rejectionDetail: string | null;
}

const push = async (client: Client, items: unknown[]): Promise<PushVerdict[]> => {
  const result = await client.query<{ payload: { results: PushVerdict[] } }>(
    'select public.sync_push($1, $2::jsonb) as payload',
    [randomUUID(), JSON.stringify(items)],
  );
  const payload = result.rows[0]?.payload;
  if (payload === undefined) throw new Error('sync_push returned nothing');
  return payload.results;
};

/**
 * A UCPMP cap for this MR's territory, inside the test transaction only.
 *
 * `app_thresholds` is append-only and `blocked-on-you` **5.9** says not to invent the
 * product's cap — so this is a row that never commits. It exists to make the trigger fire,
 * not to decide what the ceiling should be. The whole test runs in
 * `inRolledBackTransaction`, so nothing survives it.
 */
const capOf = async (client: Client, quantity: number): Promise<void> => {
  // Read from the SEEDED profile rather than from `world.users.puneMr.territoryId`, so a
  // fixture that stopped writing the territory it claims would fail here rather than
  // silently scope the cap row to a territory nothing is in.
  const territory = await client.query<{ territory_id: string | null }>(
    `select territory_id from public.user_profiles where id = $1`,
    [world.users.puneMr.id],
  );
  const territoryId = territory.rows[0]?.territory_id;
  // The precondition, asserted: a null territory means `threshold_number` reads the global
  // scope, the cap row would not apply, and the 45004 case below would pass as an
  // `accepted` item while claiming the trigger fired.
  expect(
    territoryId,
    'the fixture MR must have a territory for a territory cap to apply',
  ).toBeTruthy();
  await client.query(
    `insert into public.app_thresholds (key, value, unit, scope, territory_id, note)
     values ('ucpmp_sample_cap_quantity', $1::jsonb, 'units', 'territory', $2,
             'BE-W97 test only. Rolled back. NOT a product decision -- 5.9 is unanswered.')`,
    [JSON.stringify(quantity), territoryId],
  );
};

describe.skipIf(!reachable)('BE-W97 — the verdict carries DETAIL and HINT', () => {
  it('a 45004 arrives with the cap, the month-to-date, this entry and the period', async () => {
    await inRolledBackTransaction(async (client) => {
      await capOf(client, 1);
      await asUser(client, world.users.puneMr);

      const id = randomUUID();
      const results = await push(client, [
        {
          id,
          entity: 'sample_and_input',
          entityId: id,
          payload: sampleBody({
            id,
            visitId: world.visits.pune,
            doctorId: world.doctors.pune,
            kind: 'sample',
            itemName: `BE-W97 ${randomUUID().slice(0, 8)}`,
            quantity: 2,
            declaredValueInr: 300,
            occurredAt: new Date(Date.now() - 60_000).toISOString(),
          }),
        },
      ]);

      const verdict = results[0];
      // The precondition before any assertion about the detail: the trigger fired at all.
      // Without this, an unconfigured cap returns `accepted`, `sqlDetail` is null, and
      // "null is null" would read as agreement.
      expect(verdict?.status, 'the cap row did not take effect').toBe('rejected');
      expect(verdict?.sqlState).toBe('45004');

      // Each figure named. "the detail is non-null" is a check on the container and would
      // pass on an empty string or on a DETAIL from some other raise site.
      expect(verdict?.sqlDetail).toContain('cap 1');
      expect(verdict?.sqlDetail).toContain('already given 0');
      expect(verdict?.sqlDetail).toContain('this entry 2');
      expect(verdict?.sqlDetail).toMatch(/period starting \d{4}-\d{2}-\d{2}/u);
      expect(verdict?.sqlHint).toContain('speak to your manager');
    });
  });

  it('the 45004 SENTENCE names the doctor, and carries no UUID at all', async () => {
    // The other half of the same finding, and the half a transport fix does not touch. A
    // UUID in front of a rep standing in a clinic is the shape of information, not
    // information: they cannot check it, repeat it, or tell whether it is the right doctor.
    await inRolledBackTransaction(async (client) => {
      await capOf(client, 1);
      const name = await client.query<{ full_name: string }>(
        `select full_name from public.doctors where id = $1`,
        [world.doctors.pune],
      );
      const doctorName = name.rows[0]?.full_name;
      expect(
        doctorName,
        'the fixture doctor must have a name for this to assert anything',
      ).toBeTruthy();

      await asUser(client, world.users.puneMr);
      const id = randomUUID();
      const results = await push(client, [
        {
          id,
          entity: 'sample_and_input',
          entityId: id,
          payload: sampleBody({
            id,
            visitId: world.visits.pune,
            doctorId: world.doctors.pune,
            kind: 'sample',
            itemName: `BE-W97 named ${randomUUID().slice(0, 8)}`,
            quantity: 2,
            declaredValueInr: 300,
            occurredAt: new Date(Date.now() - 60_000).toISOString(),
          }),
        },
      ]);

      expect(results[0]?.status).toBe('rejected');
      expect(results[0]?.rejectionDetail).toContain(doctorName as string);
      expect(results[0]?.rejectionDetail).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/u,
      );
    });
  });

  it('an ACCEPTED item carries no DETAIL, so absence means success', async () => {
    // The positive control on the field itself. BE-W75 added the same control for
    // `sqlState` and for the same reason: a field that is always populated cannot be read
    // as evidence of anything.
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      const id = randomUUID();
      const results = await push(client, [
        { id, entity: 'visit', entityId: id, payload: { doctorId: world.doctors.pune } },
      ]);
      expect(results[0]?.status).toBe('accepted');
      expect(results[0]?.sqlDetail).toBeNull();
      expect(results[0]?.sqlHint).toBeNull();
    });
  });

  it('a MALFORMED item carries the keys with nulls, not a verdict missing them', async () => {
    // `sync_push` raises this one itself, so there is nothing stacked to read. The keys are
    // still present: a verdict whose SHAPE varies by branch pushes the branching into every
    // client, and `SyncPushResultSchema` requires both fields.
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      const results = await push(client, [
        { id: randomUUID(), entity: 'visit', entityId: 'not-a-uuid', payload: {} },
      ]);
      expect(results[0]?.status).toBe('rejected');
      expect(results[0]).toHaveProperty('sqlDetail');
      expect(results[0]).toHaveProperty('sqlHint');
      expect(results[0]?.sqlDetail).toBeNull();
    });
  });

  it('does NOT leak one item’s figures onto the next item in the same batch', async () => {
    // The reason `v_pg_detail` is reset with `v_item_state` rather than declared and
    // forgotten. A rep recording two products where only the second breaks the cap would
    // otherwise be shown the first line's numbers against the second line -- figures that
    // are real, precise, and about the wrong row.
    await inRolledBackTransaction(async (client) => {
      await capOf(client, 1);
      await asUser(client, world.users.puneMr);

      const overCap = randomUUID();
      const fine = randomUUID();
      const results = await push(client, [
        {
          id: overCap,
          entity: 'sample_and_input',
          entityId: overCap,
          payload: sampleBody({
            id: overCap,
            visitId: world.visits.pune,
            doctorId: world.doctors.pune,
            kind: 'sample',
            itemName: `BE-W97 over ${randomUUID().slice(0, 8)}`,
            quantity: 5,
            declaredValueInr: 300,
            occurredAt: new Date(Date.now() - 60_000).toISOString(),
          }),
        },
        { id: fine, entity: 'visit', entityId: fine, payload: { doctorId: world.doctors.pune } },
      ]);

      const refused = results.find((r) => r.id === overCap);
      const accepted = results.find((r) => r.id === fine);
      expect(refused?.status).toBe('rejected');
      expect(refused?.sqlDetail).toContain('this entry 5');
      expect(accepted?.status).toBe('accepted');
      expect(accepted?.sqlDetail).toBeNull();
      expect(accepted?.sqlHint).toBeNull();
    });
  });
});
