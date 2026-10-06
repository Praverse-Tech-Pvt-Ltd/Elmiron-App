import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * W2-C B / `BE-W159` — the rep FLAGS a possible adverse event, through `sync_push` (`BE-C36`).
 *
 * The ruling: the MR flags and performs no medical assessment; patient-identifiable information
 * stays out. The record says WHO, WHEN and WHAT THEY TYPED — and nothing else, because nothing
 * else is theirs to say. Driven through `sync_push`, the path the phone uses, offline included.
 */

const reachable = await requireDatabase();
let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 120_000);

interface Verdict {
  status: string;
  rejectionCode: string | null;
  sqlState: string | null;
}

const flag = async (
  db: Client,
  opts: { text: string; visitId?: string; itemId?: string; rowId?: string },
): Promise<{ verdict: Verdict; rowId: string }> => {
  const rowId = opts.rowId ?? randomUUID();
  const visitId = opts.visitId ?? world.visits.pune;
  const item = {
    id: opts.itemId ?? randomUUID(),
    entity: 'adverse_event',
    operation: 'create',
    entityId: visitId,
    clientCreatedAt: '2026-09-10T10:05:00+05:30',
    payload: {
      id: rowId,
      visitId,
      reportedText: opts.text,
      clientReportedAt: '2026-09-10T10:05:00+05:30',
    },
  };
  await asUser(db, world.users.puneMr);
  const { rows } = await db.query<{ result: { results: Verdict[] } }>(
    'select public.sync_push($1, $2::jsonb) as result',
    [randomUUID(), JSON.stringify([item])],
  );
  await db.query('reset role');
  const verdict = rows[0]?.result.results[0];
  if (verdict === undefined) throw new Error('sync_push returned no verdict');
  return { verdict, rowId };
};

describe.skipIf(!reachable)('W2-C B — a rep flags a possible adverse event', () => {
  it('is ACCEPTED, and the record is who, when and what they typed', async () => {
    await inRolledBackTransaction(async (db) => {
      const { verdict, rowId } = await flag(db, { text: '  Rash after the second dose.  ' });
      expect(verdict.status).toBe('accepted');
      const { rows } = await db.query<{
        source: string;
        reported_by_mr_id: string;
        reported_text: string;
        client_reported_at: Date;
        received_at: Date;
        statutory_due_at: Date;
      }>('select * from public.adverse_event_reports where id = $1', [rowId]);
      const row = rows[0];
      expect(row?.source).toBe('mr_reported');
      expect(row?.reported_by_mr_id).toBe(world.users.puneMr.id);
      expect(row?.reported_text, 'trimmed, otherwise as typed').toBe('Rash after the second dose.');
      expect(row?.client_reported_at.toISOString()).toBe('2026-09-10T04:35:00.000Z');
      // The statutory clock is the SERVER's: fifteen days from receipt, never from the phone.
      const days =
        ((row?.statutory_due_at.getTime() ?? 0) - (row?.received_at.getTime() ?? 0)) / 86_400_000;
      expect(days).toBe(15);
    });
  });

  it('a REPLAYED flag is the same report — one row, one statutory clock', async () => {
    await inRolledBackTransaction(async (db) => {
      const itemId = randomUUID();
      const rowId = randomUUID();
      const first = await flag(db, { text: 'Dizziness.', itemId, rowId });
      const again = await flag(db, { text: 'Dizziness.', itemId, rowId });
      expect(first.verdict.status).toBe('accepted');
      expect(again.verdict.status).toBe('duplicate');
      const { rows } = await db.query<{ n: string }>(
        'select count(*) n from public.adverse_event_reports where id = $1',
        [rowId],
      );
      expect(rows[0]?.n).toBe('1');
    });
  });

  it('an EMPTY flag is refused — there must be words — and nothing is written', async () => {
    await inRolledBackTransaction(async (db) => {
      const { verdict, rowId } = await flag(db, { text: '   ' });
      expect(verdict.status).toBe('rejected');
      expect(verdict.sqlState).toBe('22023');
      const { rows } = await db.query('select 1 from public.adverse_event_reports where id = $1', [
        rowId,
      ]);
      expect(rows).toHaveLength(0);
    });
  });

  it('a flag on ANOTHER rep’s visit is refused', async () => {
    await inRolledBackTransaction(async (db) => {
      const { verdict } = await flag(db, {
        text: 'Not my visit.',
        visitId: world.visits.south,
      });
      expect(verdict.status).toBe('rejected');
      expect(verdict.sqlState).toBe('42501');
    });
  });

  it('BE-C36: the record has NO patient-identifying field and NO assessment field to require', async () => {
    // The structural half of "nothing patient-identifying can be required": if the table had a
    // patient name, age, phone or a severity, a form could be made to demand one. It has none.
    await inRolledBackTransaction(async (db) => {
      const { rows } = await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'adverse_event_reports'`,
      );
      const columns = rows.map((r) => r.column_name);
      for (const forbidden of [
        /patient/u,
        /age/u,
        /phone/u,
        /address/u,
        /severity/u,
        /triage/u,
        /score/u,
      ]) {
        expect(
          columns.filter((c) => forbidden.test(c) && c !== 'statutory_due_at'),
          String(forbidden),
        ).toEqual([]);
      }
    });
  });
});
