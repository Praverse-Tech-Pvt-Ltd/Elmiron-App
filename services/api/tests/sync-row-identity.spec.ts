import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asOwner, asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * MR-24 B — a sync item's ROW identity is its own id, not the visit it belongs to.
 *
 * **The defect these hold closed, observed end to end on an emulator.** A doctor consented;
 * the consent screen was reopened on the same visit; the doctor tapped "No, don't record";
 * the server answered `accepted`; and `consent_records` still held exactly one row saying
 * `consented`. The refusal existed nowhere, and the MR was told it was recorded.
 *
 * `push-client.ts` sends `entityId: body.visitId` for all five writes, and its comment says
 * why: so that "everything waiting on one visit groups together ON THE QUEUE SCREEN". A
 * display key. `apply_sync_item` used it as each record's PRIMARY KEY, and `capture_consent`
 * opens with `select ... where c.id = p_id; if found then return v_existing`. So the second
 * consent for a visit found the first and returned it, silently.
 *
 * **Why no test caught it:** every suite here builds one item per entity per visit. With one
 * consent per visit in every fixture, "the row id is the visit id" and "the row id is the
 * request id" are indistinguishable — the dimension that separates them is *a second write
 * of the same entity to the same visit*, and nothing varied it. These cases vary exactly
 * that, which is also why the first one below fails against the old function.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

interface Item {
  readonly id: string;
  readonly entity: string;
  readonly operation: string;
  readonly entityId: string;
  readonly clientCreatedAt: string;
  readonly payload: Record<string, unknown>;
}

interface SyncResult {
  readonly id: string;
  readonly status: string;
  readonly rejectionCode: string | null;
}

const push = async (client: Client, items: readonly Item[]): Promise<SyncResult[]> => {
  const result = await client.query<{ response: { results: SyncResult[] } }>(
    'select public.sync_push($1, $2::jsonb) as response',
    [randomUUID(), JSON.stringify(items)],
  );
  return result.rows[0]?.response.results ?? [];
};

/** A consent body exactly as `packages/core` shapes it: its own `id`, the visit separately. */
const consentItem = (
  visitId: string,
  doctorId: string,
  versionId: string,
  outcome: 'consented' | 'declined',
  capturedAt: string,
): Item => {
  const id = randomUUID();
  return {
    id,
    entity: 'consent_record',
    operation: 'create',
    // The client's grouping key. Deliberately the VISIT, for every item, as push-client sends it.
    entityId: visitId,
    clientCreatedAt: capturedAt,
    payload: {
      id,
      visitId,
      doctorId,
      outcome,
      notAskedReason: null,
      displayedLanguage: 'en-IN',
      consentTextVersionId: versionId,
      capturedAt,
    },
  };
};

/**
 * Counted as the OWNER, not as the MR.
 *
 * `authenticated` holds no SELECT on `consent_records` -- consent is written through
 * `capture_consent` and read back by nobody on the device, which is why BE-W90 exists. A
 * test that counted as the MR would fail with "permission denied" and say nothing about the
 * defect. `asOwner` leaves `request.jwt.claims` untouched, so the pushes either side of it
 * still run as the MR.
 */
const countConsents = async (client: Client, visitId: string): Promise<number> =>
  asOwner(client, async () => {
    const result = await client.query<{ count: string }>(
      'select count(*) as count from public.consent_records where visit_id = $1',
      [visitId],
    );
    return Number(result.rows[0]?.count ?? '0');
  });

describe.skipIf(!reachable)('two answers on one visit are two records', () => {
  it('records a DECLINE that follows a consent on the same visit', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      const visitId = world.visits.pune;

      const first = consentItem(
        visitId,
        world.doctors.pune,
        world.consentTextVersionId,
        'consented',
        new Date(Date.now() - 60_000).toISOString(),
      );
      const second = consentItem(
        visitId,
        world.doctors.pune,
        world.consentTextVersionId,
        'declined',
        new Date().toISOString(),
      );

      const before = await countConsents(client, visitId);
      expect((await push(client, [first]))[0]?.status, 'the consent must be accepted').toBe(
        'accepted',
      );
      expect((await push(client, [second]))[0]?.status, 'the decline must be accepted').toBe(
        'accepted',
      );

      // The whole defect in one assertion. Under the old function both items carried
      // `entityId = visitId`, the second found the first by primary key and returned it, and
      // this count stayed at one while the caller was told "accepted".
      expect(
        await countConsents(client, visitId),
        'a decline after a consent must be its own record, not a silent no-op',
      ).toBe(before + 2);

      const outcomes = await asOwner(client, () =>
        client.query<{ outcome: string }>(
          'select outcome from public.consent_records where visit_id = $1 order by captured_at',
          [visitId],
        ),
      );
      expect(outcomes.rows.map((r) => r.outcome)).toContain('declined');
    });
  });

  it('STILL treats a genuine REPLAY of the same item as one record — the positive control', async () => {
    await inRolledBackTransaction(async (client) => {
      // Without this, "give every item a fresh row" would satisfy the case above and destroy
      // exactly-once: an outbox flush that retries a queued consent would write it twice.
      // A real retry carries the SAME `body.id`, which is what makes the two cases differ.
      await asUser(client, world.users.puneMr);
      const visitId = world.visits.pune;
      const item = consentItem(
        visitId,
        world.doctors.pune,
        world.consentTextVersionId,
        'consented',
        new Date().toISOString(),
      );

      const before = await countConsents(client, visitId);
      expect((await push(client, [item]))[0]?.status).toBe('accepted');
      const afterFirst = await countConsents(client, visitId);
      // Same item, pushed again, exactly as a retried flush would send it.
      await push(client, [item]);

      expect(afterFirst, 'the first push writes one row').toBe(before + 1);
      expect(
        await countConsents(client, visitId),
        'a replayed item must not write a second row',
      ).toBe(afterFirst);
    });
  });

  it('refuses an item of these entities that carries no id of its own', async () => {
    await inRolledBackTransaction(async (client) => {
      // The fallback to `p_entity_id` IS the defect, so its absence is asserted rather than
      // assumed. A body with no id must be refused, not quietly filed under the visit.
      await asUser(client, world.users.puneMr);
      const visitId = world.visits.pune;
      const item = consentItem(
        visitId,
        world.doctors.pune,
        world.consentTextVersionId,
        'consented',
        new Date().toISOString(),
      );
      const payloadWithoutId: Record<string, unknown> = { ...item.payload };
      delete payloadWithoutId['id'];
      const results = await push(client, [{ ...item, payload: payloadWithoutId }]);

      expect(results[0]?.status, 'no id means no row').toBe('rejected');
    });
  });
});
