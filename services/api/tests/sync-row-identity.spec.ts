import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asOwner, asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';
import { consentItem } from './sync-bodies.js';
import type { SyncItem } from './sync-bodies.js';
import type { CreateConsentRecordRequest } from '@fieldforce/core';

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

type Item = SyncItem<CreateConsentRecordRequest>;

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

/**
 * MR-25 B3. Built by `consentItem` in `sync-bodies.ts`, which annotates the body with
 * `CreateConsentRecordRequest` and parses it through `CreateConsentRecordRequestSchema`. A
 * change to the contract now fails here at COMPILE time, which is the whole point of the
 * sweep: the previous version of this helper was a hand-typed literal that could drift from
 * the contract in silence, exactly as `gate1.spec.ts` did.
 */
const aConsent = (
  visitId: string,
  doctorId: string,
  versionId: string,
  outcome: 'consented' | 'declined',
  capturedAt: string,
): Item =>
  consentItem({
    visitId,
    doctorId,
    outcome,
    consentTextVersionId: versionId,
    displayedLanguage: 'en-IN',
    capturedAt,
  });

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

      const first = aConsent(
        visitId,
        world.doctors.pune,
        world.consentTextVersionId,
        'consented',
        new Date(Date.now() - 60_000).toISOString(),
      );
      const second = aConsent(
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
      const item = aConsent(
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
      const item = aConsent(
        visitId,
        world.doctors.pune,
        world.consentTextVersionId,
        'consented',
        new Date().toISOString(),
      );
      // **The one deliberate escape from the contract type in this file, and it is the
      // point of the case.** Every other body here is built by `sync-bodies.ts` and cannot
      // drift from `CreateConsentRecordRequest` without failing to compile. This case has to
      // send a body the contract FORBIDS -- `id` is required by the schema -- so it casts out
      // and back, which is exactly the shape of thing that has to be visible and rare rather
      // than the default. A client cannot produce this body; the server must still refuse it,
      // because the alternative is the silent fallback to `p_entity_id` that discarded a
      // doctor's withdrawal of consent.
      const payloadWithoutId = { ...(item.payload as unknown as Record<string, unknown>) };
      delete payloadWithoutId['id'];
      const results = await push(client, [
        { ...item, payload: payloadWithoutId as unknown as CreateConsentRecordRequest },
      ]);

      expect(results[0]?.status, 'no id means no row').toBe('rejected');
    });
  });
});
