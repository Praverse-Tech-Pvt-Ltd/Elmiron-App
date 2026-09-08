import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { requireDatabase, withClient } from './db.js';
import { asOwner } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * MR-11 Part B — BE-W87. Clinic addresses in the pull, as their own entity.
 *
 * `sync_pull` carried `visit`, `beat_plan` and `doctor`, and a doctor payload is
 * `to_jsonb(d)` — the row and nothing else. Four read paths and the geofence need
 * addresses, and `pull.ts`'s docstring names the difficulty (*"rows, not aggregates"*)
 * without resolving it, because nothing has ever called the module.
 *
 * **A separate entity rather than a denormalised doctor**, and these tests are written
 * against the reasons rather than the shape:
 *
 *   * a clinic edit must sync **on its own `updated_at`**, with no trigger bumping a
 *     parent that would otherwise never change;
 *   * it must be **scoped by RLS**, because `sync_pull` is SECURITY INVOKER and the arm
 *     therefore carries no predicate of its own;
 *   * a removed clinic must arrive as an ordinary **payload-free tombstone**, not as an
 *     array that quietly got shorter.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

interface Change {
  entity: string;
  entityId: string;
  reason: string;
  payload: Record<string, unknown> | null;
  updatedAt: string;
}
interface PullResponse {
  changes: Change[];
  /**
   * **`hasMore` and `nextCursor`, read off the response rather than assumed.**
   *
   * The first draft of this file declared `truncated` and `cursor`, which are not what
   * `sync_pull` returns. Both came back `undefined`, so `drain` stopped after one page and
   * every "cursor" passed to a second pull was null — making it a FULL RE-SYNC, which by
   * design carries no tombstones at all. The deletion test then failed for a reason that
   * had nothing to do with deletions.
   *
   * A shape assumed rather than read, which is the defect this repository keeps finding in
   * its own code. `select jsonb_object_keys(public.sync_pull(null))` answers it in one
   * line: changes, hasMore, nextCursor, serverTime, completeness.
   */
  hasMore: boolean;
  nextCursor: string;
  serverTime: string;
  completeness: { entities: string[] };
}

const pull = async (client: Client, cursor: string | null = null): Promise<PullResponse> => {
  const result = await client.query<{ payload: PullResponse }>(
    'select public.sync_pull($1, null, 500) as payload',
    [cursor],
  );
  const payload = result.rows[0]?.payload;
  if (payload === undefined) throw new Error('sync_pull returned nothing');
  return payload;
};

/**
 * Pull until the stream is exhausted, and return the cursor that means "caught up".
 *
 * **Not decoration — the first version of these tests failed without it.** The fixtures
 * accumulate across suites, so a first pull is often `truncated`, and a truncated cursor
 * is a PAGINATION cursor: it carries the `upto` snapshot of the page it came from. Pulling
 * again with it continues inside that old snapshot, which by construction cannot contain a
 * row committed afterwards — so a deletion made between the two calls was invisible, and
 * the test read that as a missing tombstone rather than as an unfinished page.
 *
 * That is the cursor behaving exactly as designed. Draining first is what a client does.
 */
const drain = async (client: Client): Promise<{ ids: string[]; cursor: string }> => {
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 50; i += 1) {
    const response: PullResponse = await pull(client, cursor);
    ids.push(...response.changes.map((c) => c.entityId));
    cursor = response.nextCursor;
    if (!response.hasMore) return { ids, cursor };
  }
  throw new Error('the pull never stopped being truncated');
};

/** A committed connection acting as `user`, so writes are visible to a later snapshot. */
const asCommittedUser = async <T>(user: FixtureUser, fn: (client: Client) => Promise<T>) =>
  withClient(async (client) => {
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

describe.skipIf(!reachable)('BE-W87 — a clinic address is its own entity in the stream', () => {
  it('the pull carries them, and completeness says so', async () => {
    await asCommittedUser(world.users.puneMr, async (client) => {
      const first = await pull(client);
      const clinics = first.changes.filter((c) => c.entity === 'clinic_address');

      expect(clinics.length, 'no clinic addresses in the stream').toBeGreaterThan(0);
      // The field reports what this pull can carry, and it now carries one more thing. A
      // completeness field that does not move as capability grows is a lie in the other
      // direction.
      expect(first.completeness.entities).toContain('clinic_address');

      // A real payload, not a stub: the geofence needs coordinates and the doctors list
      // needs a city.
      const payload = clinics[0]?.payload;
      expect(payload).not.toBeNull();
      expect(payload).toHaveProperty('city');
      expect(payload).toHaveProperty('latitude');
      expect(payload).toHaveProperty('doctor_id');
    });
  });

  it('RLS scopes it: another MR’s clinics are absent, and their own are present', async () => {
    // The arm carries no predicate — `sync_pull` is SECURITY INVOKER, so
    // `clinic_addresses_select_visible_doctor` does the work, exactly as it does for the
    // doctor arm. If that assumption were wrong this is where it shows.
    const mine = await asCommittedUser(world.users.puneMr, async (client) => {
      const drained = await drain(client);
      return drained.ids;
    });

    expect(mine, 'the MR cannot see their OWN clinic').toContain(world.clinicAddresses.pune);
    expect(mine, 'a clinic in another subtree leaked').not.toContain(world.clinicAddresses.south);
    expect(mine, 'a clinic in another TENANT leaked').not.toContain(world.clinicAddresses.rival);
  });

  it('an EDIT arrives on its own updated_at, with no trigger bumping the doctor', async () => {
    // The whole argument for a separate entity. A denormalised doctor payload would only
    // carry this edit if something bumped `doctors.updated_at` — hand-maintained coupling
    // that, if ever missed, means a clinic edit never syncs and nothing reports it.
    const cursor = await asCommittedUser(world.users.puneMr, async (client) => {
      const drained = await drain(client);
      return drained.cursor;
    });

    await withClient((client) =>
      asOwner(client, () =>
        client.query('update public.clinic_addresses set label = $2 where id = $1', [
          world.clinicAddresses.pune,
          `Edited ${randomUUID().slice(0, 6)}`,
        ]),
      ),
    );

    await asCommittedUser(world.users.puneMr, async (client) => {
      const next = await pull(client, cursor);
      const ids = next.changes.map((c) => c.entityId);
      expect(ids, 'the edited clinic did not arrive').toContain(world.clinicAddresses.pune);

      const change = next.changes.find((c) => c.entityId === world.clinicAddresses.pune);
      expect(change?.entity).toBe('clinic_address');
      expect(change?.reason).toBe('upserted');
      expect(change?.payload).not.toBeNull();
    });
  });

  it('a REMOVAL arrives as a payload-free tombstone, in cursor order', async () => {
    // Not "the array got shorter", which is what a nested payload would have offered and
    // which is not a deletion signal at all.
    const doctorId = randomUUID();
    const clinicId = randomUUID();
    await withClient((client) =>
      asOwner(client, async () => {
        await client.query(
          `insert into public.doctors
             (id, organisation_id, full_name, registration_number, specialty, qualification,
              territory_id, assigned_mr_id)
           values ($1, $2, 'Dr Tombstone Fixture', $3, 'Urology', 'MBBS', $4, $5)`,
          [
            doctorId,
            world.organisationId,
            `TS-${randomUUID().slice(0, 8)}`,
            world.territories.pune,
            world.users.puneMr.id,
          ],
        );
        await client.query(
          `insert into public.clinic_addresses
             (id, doctor_id, label, line1, city, state, postal_code, latitude, longitude)
           values ($1, $2, 'Doomed', '1 St', 'Pune', 'Maharashtra', '411001', 18.5, 73.8)`,
          [clinicId, doctorId],
        );
      }),
    );

    const cursor = await asCommittedUser(world.users.puneMr, async (client) => {
      const drained = await drain(client);
      expect(drained.ids, 'the new clinic never arrived').toContain(clinicId);
      return drained.cursor;
    });

    await withClient((client) =>
      asOwner(client, () =>
        client.query('delete from public.clinic_addresses where id = $1', [clinicId]),
      ),
    );

    await asCommittedUser(world.users.puneMr, async (client) => {
      const next = await pull(client, cursor);
      const tombstone = next.changes.find((c) => c.entityId === clinicId);

      expect(tombstone, 'the deletion did not arrive').toBeDefined();
      expect(tombstone?.entity).toBe('clinic_address');
      expect(tombstone?.reason).toBe('deleted');
      // Payload-free is the property, expressed in the wire format and not only in the
      // table: a tombstone must not carry the row it is announcing the loss of.
      expect(tombstone?.payload).toBeNull();
    });
  });

  it('a full re-sync carries no tombstone for a clinic the caller never had', async () => {
    // Section 1's second protection, for the new entity. A client rebuilding from nothing
    // could only be told about records it never held, so a full pull carries no
    // deletions at all — and a tombstone naming another subtree's clinic would disclose
    // that it had existed.
    const doctorId = randomUUID();
    const clinicId = randomUUID();
    await withClient((client) =>
      asOwner(client, async () => {
        await client.query(
          `insert into public.doctors
             (id, organisation_id, full_name, registration_number, specialty, qualification,
              territory_id, assigned_mr_id)
           values ($1, $2, 'Dr South Tombstone', $3, 'Urology', 'MBBS', $4, $5)`,
          [
            doctorId,
            world.organisationId,
            `TS2-${randomUUID().slice(0, 8)}`,
            world.territories.south,
            world.users.southMr.id,
          ],
        );
        await client.query(
          `insert into public.clinic_addresses
             (id, doctor_id, label, line1, city, state, postal_code, latitude, longitude)
           values ($1, $2, 'Elsewhere', '9 Rd', 'Bengaluru', 'Karnataka', '560001', 12.9, 77.5)`,
          [clinicId, doctorId],
        );
        await client.query('delete from public.clinic_addresses where id = $1', [clinicId]);
      }),
    );

    await asCommittedUser(world.users.puneMr, async (client) => {
      const full = await drain(client);
      expect(full.ids).not.toContain(clinicId);
      // The positive control: the pull is not simply empty.
      expect(full.ids.length).toBeGreaterThan(0);
    });
  });
});
