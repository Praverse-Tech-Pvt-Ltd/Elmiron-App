import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { requireDatabase, withClient } from './db.js';
import { asUser, withIdentityLock } from './auth.js';
import type { ProfileLike } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';
import { callReportItem, checkInItem, checkOutItem } from './sync-bodies.js';

/**
 * `BE-W176` — the unplanned visit made OFFLINE on the phone, end to end on the real server.
 *
 * The phone's outbox holds four items in the order the rep did them -- the visit, its check-in,
 * its call report, its check-out -- and on reconnect replays them in that order (the outbox holds
 * the three behind the visit until it is accepted; `apps/field/src/sync/unplanned-visit.test.ts`).
 * Here the server gets exactly that, in the payload shapes the phone sends, then the same batch
 * again as after a lost answer; then the rep pulls, and the manager reviews.
 *
 * COMMITTED, because `sync_pull` cannot see its own transaction's rows. Everything is under a rep
 * and a territory of its own (a child of Pune, inside the west manager's subtree) with an all-day
 * window, so no other suite's rows or working hours are touched and the hour of the run does not
 * matter. The rows stay: visits and call reports are append-only history.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

interface Verdict {
  readonly id: string;
  readonly status: string;
  readonly sqlState: string | null;
}

const committed = async <T>(
  user: FixtureUser | ProfileLike,
  fn: (client: Client) => Promise<T>,
): Promise<T> =>
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

describe.skipIf(!reachable)(
  'BE-W176 — an offline unplanned visit, replayed, pulled and reviewed',
  () => {
    it('one visit, UNPLANNED with its reason, worked to completion -- and the manager sees and reviews it', async () => {
      const territory = randomUUID();
      const doctor = randomUUID();
      const clinic = randomUUID();
      const rep = await withIdentityLock(async () => {
        const id = randomUUID();
        await withClient(async (client) => {
          await client.query(
            `insert into public.territories (id, name, code, parent_id, organisation_id)
           values ($1, $2, $3, $4, $5)`,
            [
              territory,
              `Unplanned flow ${id.slice(0, 6)}`,
              `UPF-${id.slice(0, 6)}`,
              world.territories.pune,
              world.organisationId,
            ],
          );
          await client.query(
            `insert into public.territory_shift_windows
             (territory_id, shift_start, shift_end, timezone, grace_minutes, active_weekdays)
           values ($1, '00:00', '23:59', 'Asia/Kolkata', 60, '{1,2,3,4,5,6,7}')`,
            [territory],
          );
          await client.query(
            `insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')`,
            [id, `unplanned-flow-${id.slice(0, 8)}@example.test`],
          );
          await client.query(
            `insert into public.user_profiles (id, full_name, role, territory_id, is_active, organisation_id)
           values ($1, 'Unplanned Flow Rep', 'mr', $2, true, $3)`,
            [id, territory, world.organisationId],
          );
          await client.query(
            `insert into public.doctors (id, organisation_id, full_name, territory_id) values ($1, $2, 'Dr Walk-in', $3)`,
            [doctor, world.organisationId, territory],
          );
          await client.query(
            `insert into public.clinic_addresses (id, doctor_id, label, line1, city, state, postal_code, latitude, longitude)
           values ($1, $2, 'Main clinic', '1 Road', 'Pune', 'Maharashtra', '411001', 18.5204, 73.8567)`,
            [clinic, doctor],
          );
        });
        return { id, role: 'mr' as const, territoryId: territory, isActive: true };
      });

      // The four the phone queued offline, timed a little in the past (the server's clock rules).
      const times = await withClient(async (client) => {
        const r = await client.query<{ made: string; in: string; out: string }>(
          `select (now() - interval '50 minutes')::text as made, (now() - interval '45 minutes')::text as in,
                (now() - interval '15 minutes')::text as out`,
        );
        const row = r.rows[0];
        if (row === undefined) throw new Error('no clock');
        return {
          made: new Date(row.made).toISOString(),
          in: new Date(row.in).toISOString(),
          out: new Date(row.out).toISOString(),
        };
      });
      const visit = randomUUID();
      const queued = [
        // Exactly what `createPushClient().createUnplannedVisit` sends.
        {
          id: visit,
          entity: 'visit',
          operation: 'create',
          entityId: visit,
          clientCreatedAt: times.made,
          payload: {
            doctorId: doctor,
            clinicAddressId: clinic,
            scheduledFor: times.made,
            origin: 'unplanned',
            unplannedReason: 'Doctor called me in',
          },
        },
        checkInItem({
          visitId: visit,
          coordinates: { latitude: 18.5204, longitude: 73.8567 },
          occurredAt: times.in,
        }),
        callReportItem({
          visitId: visit,
          summary: 'Discussed the dosing guide.',
          clientCreatedAt: times.in,
        }),
        checkOutItem({
          visitId: visit,
          coordinates: { latitude: 18.5204, longitude: 73.8567 },
          occurredAt: times.out,
        }),
      ];

      const push = (client: Client) =>
        client
          .query<{ r: { results: Verdict[] } }>('select public.sync_push($1, $2::jsonb) as r', [
            randomUUID(),
            JSON.stringify(queued),
          ])
          .then((result) => result.rows[0]?.r.results ?? []);

      const first = await committed(rep, push);
      expect(first.map((v) => v.status)).toEqual(['accepted', 'accepted', 'accepted', 'accepted']);
      // The answer was lost; the phone sends the same four again.
      const again = await committed(rep, push);
      expect(again.map((v) => v.status)).toEqual([
        'duplicate',
        'duplicate',
        'duplicate',
        'duplicate',
      ]);

      // The rep pulls: ONE visit, the phone's own id, unplanned, completed, on a day.
      const pulled = await committed(rep, async (client) => {
        const r = await client.query<{
          p: {
            changes: {
              entity: string;
              entityId: string;
              payload: Record<string, unknown> | null;
            }[];
          };
        }>(`select public.sync_pull(null, array['visit'], 500) as p`);
        return (r.rows[0]?.p.changes ?? []).filter((c) => c.entity === 'visit');
      });
      expect(pulled).toHaveLength(1);
      expect(pulled[0]?.entityId).toBe(visit);
      expect(pulled[0]?.payload).toMatchObject({
        origin: 'unplanned',
        unplanned_reason: 'Doctor called me in',
        beat_plan_id: null,
        status: 'completed',
      });
      const day = String(pulled[0]?.payload?.['visit_day']);
      expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/u);

      const counts = await withClient(async (client) => {
        const r = await client.query<{ c: number; r: number; o: number }>(
          `select (select count(*)::int from public.check_ins where visit_id = $1) as c,
                (select count(*)::int from public.call_reports where visit_id = $1) as r,
                (select count(*)::int from public.check_outs where visit_id = $1) as o`,
          [visit],
        );
        return r.rows[0];
      });
      expect(counts).toEqual({ c: 1, r: 1, o: 1 });

      // The manager: sees it on that day, kept apart as unplanned, with the reason -- and reviews it.
      const review = await committed(world.users.westManager, async (client) => {
        const before = await client.query<{
          r: {
            visits: {
              visitId: string;
              origin: string;
              unplannedReason: string;
              status: string;
              reviewedByMe: boolean;
            }[];
          };
        }>('select public.manager_day_review($1, $2::date, $2::date) as r', [rep.id, day]);
        await client.query('select public.review_unplanned_visit($1, null)', [visit]);
        const after = await client.query<{
          r: { visits: { visitId: string; reviewedByMe: boolean }[] };
        }>('select public.manager_day_review($1, $2::date, $2::date) as r', [rep.id, day]);
        return { before: before.rows[0]?.r.visits ?? [], after: after.rows[0]?.r.visits ?? [] };
      });
      expect(review.before).toHaveLength(1);
      expect(review.before[0]).toMatchObject({
        visitId: visit,
        origin: 'unplanned',
        unplannedReason: 'Doctor called me in',
        status: 'completed',
        reviewedByMe: false,
      });
      expect(review.after[0]).toMatchObject({ visitId: visit, reviewedByMe: true });
    });
  },
);
