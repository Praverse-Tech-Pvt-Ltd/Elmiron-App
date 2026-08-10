import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * BE-W5 — the manager surface and the approval workflow.
 *
 * A manager oversees 8–15 MRs and wants what is OFF-PLAN. The assertions here are
 * mostly about what is absent: no ranking, no score, no ordering of MRs against
 * each other, and no way to decide a report you wrote yourself.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

const WED_0300_IST = '2026-08-12T03:00:00+05:30';
const CLINIC_LAT = 18.5204;
const CLINIC_LON = 73.8567;

const asUserTx = async <T>(user: FixtureUser, fn: (client: Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await asUser(client, user);
    return fn(client);
  });

const push = async (client: Client, items: Record<string, unknown>[]): Promise<unknown> => {
  const result = await client.query('select public.sync_push($1, $2::jsonb) as response', [
    randomUUID(),
    JSON.stringify(items),
  ]);
  return result.rows[0];
};

const poisonCheckIn = (visitId: string): Record<string, unknown> => ({
  id: randomUUID(),
  entity: 'check_in',
  operation: 'create',
  entityId: randomUUID(),
  clientCreatedAt: WED_0300_IST,
  payload: {
    visitId,
    latitude: CLINIC_LAT,
    longitude: CLINIC_LON,
    occurredAt: WED_0300_IST,
  },
});

// =============================================================================
// Dead-letter reinstatement
// =============================================================================

describe.skipIf(!reachable)('dead-letter reinstatement', () => {
  const deadLetter = async (client: Client): Promise<string> => {
    const item = poisonCheckIn(world.visits.pune);
    for (let attempt = 1; attempt <= 6; attempt += 1) await push(client, [item]);
    return item['id'] as string;
  };

  it('a dead letter is always reversible, with no taxonomy of whose fault it was', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      const itemId = await deadLetter(client);

      await client.query('reset role');
      await asUser(client, world.users.westManager);
      const result = await client.query<{ status: string; attempts_forgiven: number }>(
        'select status, attempts_forgiven from public.reinstate_sync_item($1, $2)',
        [itemId, 'Shift window for Pune was wrong; corrected today.'],
      );

      expect(result.rows[0]?.status).toBe('rejected');
      expect(result.rows[0]?.attempts_forgiven).toBe(6);
    });
  });

  it('gives a reinstated item a fresh attempt budget without erasing its history', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      const itemId = await deadLetter(client);

      await client.query('reset role');
      await asUser(client, world.users.westManager);
      await client.query('select public.reinstate_sync_item($1, $2)', [itemId, 'corrected']);

      const row = await client.query<{ attempt_count: number; attempts_forgiven: number }>(
        'select attempt_count, attempts_forgiven from public.sync_items where id = $1',
        [itemId],
      );
      // Attempts are forgiven, never rewritten. The record that it failed six times
      // is what makes attributing the reversal worth anything.
      expect(row.rows[0]?.attempt_count).toBe(6);
      expect(row.rows[0]?.attempts_forgiven).toBe(6);
    });
  });

  it('requires a reason', async () => {
    await expect(
      inRolledBackTransaction(async (client) => {
        await asUser(client, world.users.puneMr);
        const itemId = await deadLetter(client);
        await client.query('reset role');
        await asUser(client, world.users.westManager);
        return client.query('select public.reinstate_sync_item($1, $2)', [itemId, '   ']);
      }),
    ).rejects.toThrow(/requires a reason/);
  });

  it('records the reversal as an append-only, attributed row', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      const itemId = await deadLetter(client);
      await client.query('reset role');
      await asUser(client, world.users.westManager);
      await client.query('select public.reinstate_sync_item($1, $2)', [
        itemId,
        'Territory hours were misconfigured.',
      ]);

      const rows = await client.query<{ reinstated_by_user_id: string; reason: string }>(
        'select reinstated_by_user_id, reason from public.sync_item_reinstatements where sync_item_id = $1',
        [itemId],
      );
      expect(rows.rows[0]?.reinstated_by_user_id).toBe(world.users.westManager.id);
      expect(rows.rows[0]?.reason).toMatch(/misconfigured/);
    });
  });

  it('refuses UPDATE on a reinstatement from any role', async () => {
    await expect(
      inRolledBackTransaction((client: Client) =>
        client.query(`update public.sync_item_reinstatements set reason = 'rewritten'`),
      ),
    ).rejects.toThrow(/append-only/);
  });

  it('is refused to an MR, and to a manager outside the team', async () => {
    await expect(
      inRolledBackTransaction(async (client) => {
        await asUser(client, world.users.puneMr);
        const itemId = await deadLetter(client);
        return client.query('select public.reinstate_sync_item($1, $2)', [
          itemId,
          'let me through',
        ]);
      }),
    ).rejects.toThrow(/only a field_manager or admin/);

    await expect(
      inRolledBackTransaction(async (client) => {
        await asUser(client, world.users.puneMr);
        const itemId = await deadLetter(client);
        await client.query('reset role');
        await asUser(client, world.users.southManager);
        return client.query('select public.reinstate_sync_item($1, $2)', [itemId, 'not my team']);
      }),
    ).rejects.toThrow(/not in your scope/);
  });

  it('refuses to reinstate something that is not dead-lettered', async () => {
    await expect(
      inRolledBackTransaction(async (client) => {
        await asUser(client, world.users.puneMr);
        const item = poisonCheckIn(world.visits.pune);
        await push(client, [item]); // one rejection, not yet dead
        await client.query('reset role');
        await asUser(client, world.users.westManager);
        return client.query('select public.reinstate_sync_item($1, $2)', [item['id'], 'too early']);
      }),
    ).rejects.toThrow(/only a dead-lettered item/);
  });
});

// =============================================================================
// Rejections are explained, not just coded
// =============================================================================

describe.skipIf(!reachable)('rejections carry a human explanation beside the code', () => {
  it('puts the machine-readable code and the human sentence in the same row', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const item = poisonCheckIn(world.visits.pune);
      await push(client, [item]);

      const row = await client.query<{
        rejection_code: string;
        explanation: string;
        attempts_remaining: number;
      }>(
        'select rejection_code, explanation, attempts_remaining from public.list_sync_rejections()',
      );
      expect(row.rows[0]?.rejection_code).toBe('outside_shift_window');
      expect(row.rows[0]?.explanation).toMatch(/working hours/i);
      expect(row.rows[0]?.attempts_remaining).toBe(4);
    });
  });

  it('flags an item that has been reinstated', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      const item = poisonCheckIn(world.visits.pune);
      for (let attempt = 1; attempt <= 6; attempt += 1) await push(client, [item]);
      await client.query('reset role');
      await asUser(client, world.users.westManager);
      await client.query('select public.reinstate_sync_item($1, $2)', [item['id'], 'fixed hours']);

      const row = await client.query<{ was_reinstated: boolean; attempts_remaining: number }>(
        'select was_reinstated, attempts_remaining from public.sync_item_explained where id = $1',
        [item['id']],
      );
      expect(row.rows[0]?.was_reinstated).toBe(true);
      expect(row.rows[0]?.attempts_remaining).toBe(5);
    });
  });
});

// =============================================================================
// The manager surface
// =============================================================================

describe.skipIf(!reachable)('team activity and coverage', () => {
  it('shows a manager their whole subtree and nobody else', async () => {
    await asUserTx(world.users.westManager, async (client) => {
      const rows = await client.query<{ mr_id: string }>(
        'select mr_id from public.team_activity()',
      );
      const ids = rows.rows.map((r) => r.mr_id);
      expect(ids).toContain(world.users.puneMr.id);
      expect(ids).toContain(world.users.nagpurMr.id);
      expect(ids).not.toContain(world.users.southMr.id);
    });
  });

  it('shows an MR only themselves', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const rows = await client.query<{ mr_id: string }>(
        'select mr_id from public.team_activity()',
      );
      expect(rows.rows.map((r) => r.mr_id)).toEqual([world.users.puneMr.id]);
    });
  });

  it('reports a position only from captures inside working hours', async () => {
    // The manager view must not surface where an MR was outside their shift. The
    // fixture check-ins are seeded directly, bypassing record_check_in, so this is
    // the filter doing the work rather than the capture path.
    await inRolledBackTransaction(async (client) => {
      await client.query(
        `insert into public.check_ins
           (id, visit_id, mr_id, latitude, longitude, geofence_status, source, occurred_at)
         values (gen_random_uuid(), $1, $2, 1.0, 1.0, 'inside', 'manual', $3)`,
        [world.visits.pune, world.users.puneMr.id, WED_0300_IST],
      );
      await asUser(client, world.users.westManager);
      const rows = await client.query<{ last_latitude: number | null }>(
        `select last_latitude from public.team_activity('2026-08-12')`,
      );
      // 1.0 is the out-of-hours capture. It must not be what the manager sees.
      expect(rows.rows.every((r) => r.last_latitude !== 1.0)).toBe(true);
    });
  });

  it('counts a missed visit as a planned doctor who was not seen', async () => {
    await asUserTx(world.users.westManager, async (client) => {
      const rows = await client.query<{ mr_id: string; missed_visit_count: number }>(
        `select mr_id, missed_visit_count from public.coverage(current_date, current_date)
          where mr_id = $1`,
        [world.users.puneMr.id],
      );
      // The fixture beat plan has no entries, so nothing is missed. The point of the
      // assertion is the shape: a number, per MR, per day, and not a ratio.
      expect(rows.rows[0]?.missed_visit_count).toBe(0);
    });
  });

  it('refuses per-MR detail for someone outside the caller scope', async () => {
    await expect(
      asUserTx(world.users.westManager, (client) =>
        client.query('select public.mr_activity_detail($1)', [world.users.southMr.id]),
      ),
    ).rejects.toThrow(/not in your scope/);
  });

  it('returns per-MR detail for someone inside it', async () => {
    await asUserTx(world.users.westManager, async (client) => {
      const result = await client.query<{ payload: Record<string, unknown> }>(
        'select public.mr_activity_detail($1) as payload',
        [world.users.puneMr.id],
      );
      expect(result.rows[0]?.payload['mrId']).toBe(world.users.puneMr.id);
      expect(result.rows[0]?.payload).toHaveProperty('visits');
      expect(result.rows[0]?.payload).toHaveProperty('mileage');
    });
  });
});

describe.skipIf(!reachable)('team exceptions', () => {
  it('flags an MR who has not synced recently', async () => {
    await asUserTx(world.users.westManager, async (client) => {
      const rows = await client.query<{ mr_id: string; exception_kind: string }>(
        'select mr_id, exception_kind from public.team_exceptions()',
      );
      const stale = rows.rows.filter((r) => r.exception_kind === 'no_recent_sync');
      expect(stale.map((r) => r.mr_id)).toContain(world.users.puneMr.id);
    });
  });

  it('flags a high rejection rate', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      const items = Array.from({ length: 6 }, () => poisonCheckIn(world.visits.pune));
      await push(client, items);
      await client.query('reset role');
      await asUser(client, world.users.westManager);
      const rows = await client.query<{ mr_id: string; exception_kind: string; detail: unknown }>(
        `select mr_id, exception_kind, detail from public.team_exceptions('2026-08-12')`,
      );
      const flagged = rows.rows.filter((r) => r.exception_kind === 'high_rejection_rate');
      expect(flagged.map((r) => r.mr_id)).toContain(world.users.puneMr.id);
    });
  });

  /** puneMr declines everything, nagpurMr consents to everything. Both deviate. */
  const seedDivergentConsents = async (client: Client): Promise<void> => {
    const seed = async (
      mrId: string,
      visitId: string,
      outcome: 'consented' | 'declined',
    ): Promise<void> => {
      for (let i = 0; i < 4; i += 1) {
        await client.query(
          `insert into public.consent_records
             (id, visit_id, doctor_id, captured_by_mr_id, outcome, consent_text_version_id,
              displayed_language, captured_at)
           values (gen_random_uuid(), $1, $2, $3, $4, $5, 'en-IN', '2026-08-12T11:00:00+05:30')`,
          [visitId, world.doctors.pune, mrId, outcome, world.consentTextVersionId],
        );
      }
    };
    await seed(world.users.puneMr.id, world.visits.pune, 'declined');

    const nagpurVisit = randomUUID();
    await client.query(
      `insert into public.visits (id, mr_id, doctor_id, status) values ($1, $2, $3, 'completed')`,
      [nagpurVisit, world.users.nagpurMr.id, world.doctors.pune],
    );
    await seed(world.users.nagpurMr.id, nagpurVisit, 'consented');
  };

  it('emits nothing at all below the team-size floor', async () => {
    // The fixture manager oversees two MRs. A median over two people is one
    // person's number, so the anomaly is suppressed entirely — not emitted with a
    // low-confidence marker, which somebody would act on anyway.
    await inRolledBackTransaction(async (client) => {
      await seedDivergentConsents(client);
      await asUser(client, world.users.westManager);
      const rows = await client.query(
        `select mr_id from public.team_exceptions('2026-08-12')
          where exception_kind = 'consent_rate_anomaly'`,
      );
      expect(rows.rows).toEqual([]);
    });
  });

  it('flags a consent-rate anomaly as data quality once the team is large enough', async () => {
    await inRolledBackTransaction(async (client) => {
      await seedDivergentConsents(client);
      // Lower the floor through the config table rather than the code — which also
      // proves the threshold is read at query time.
      await client.query(
        `insert into public.app_thresholds (key, value, unit, note)
         values ('consent_min_team_size', '2'::jsonb, 'count', 'test override')`,
      );
      await asUser(client, world.users.westManager);
      const rows = await client.query<{ mr_id: string; detail: Record<string, unknown> }>(
        `select mr_id, detail from public.team_exceptions('2026-08-12')
          where exception_kind = 'consent_rate_anomaly'`,
      );

      expect(rows.rows.length).toBeGreaterThan(0);
      for (const row of rows.rows) {
        // Never a performance measure. The label is part of the contract.
        expect(row.detail['signal']).toBe('data_quality');
        expect(row.detail).toHaveProperty('teamMedian');
        expect(row.detail).toHaveProperty('sampleSize');
        expect(row.detail).toHaveProperty('teamSize');
      }
    });
  });

  it('reads its thresholds from config rather than from the migration', async () => {
    // Uses the rejection rate rather than the sync clock: received_at is stamped
    // with clock_timestamp(), which is later than the transaction's now(), so a
    // clock-based threshold behaves confusingly inside a single transaction. Noted
    // in docs/gotchas.md.
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);
      await push(
        client,
        Array.from({ length: 6 }, () => poisonCheckIn(world.visits.pune)),
      );

      await client.query('reset role');
      await asUser(client, world.users.westManager);
      const before = await client.query<{ mr_id: string }>(
        `select mr_id from public.team_exceptions('2026-08-12')
          where exception_kind = 'high_rejection_rate'`,
      );
      expect(before.rows.map((r) => r.mr_id)).toContain(world.users.puneMr.id);

      // Raise the bar above what is achievable. Nothing about the data changes.
      await client.query('reset role');
      await client.query(
        `insert into public.app_thresholds (key, value, unit, note)
         values ('rejection_rate_threshold', '1.5'::jsonb, 'ratio', 'test override')`,
      );
      await asUser(client, world.users.westManager);
      const after = await client.query<{ mr_id: string }>(
        `select mr_id from public.team_exceptions('2026-08-12')
          where exception_kind = 'high_rejection_rate'`,
      );
      expect(after.rows).toEqual([]);
    });
  });

  it('contains no score, rank or percentile anywhere in its output', async () => {
    // The absence is the requirement. A ranking of MRs against one another turns a
    // fraud signal into a leaderboard position, which is the opposite of what it
    // means.
    await inRolledBackTransaction(async (client) => {
      const columns = await client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public'
            and table_name in ('team_exceptions', 'team_activity', 'coverage')`,
      );
      for (const forbidden of ['score', 'rank', 'percentile', 'grade', 'rating']) {
        expect(columns.rows.map((r) => r.column_name)).not.toContain(forbidden);
      }

      await asUser(client, world.users.westManager);
      const rows = await client.query<{ detail: Record<string, unknown> }>(
        'select detail from public.team_exceptions()',
      );
      for (const row of rows.rows) {
        for (const forbidden of ['score', 'rank', 'percentile', 'grade', 'rating']) {
          expect(Object.keys(row.detail)).not.toContain(forbidden);
        }
      }
    });
  });

  it('is empty for a manager whose team is outside the data', async () => {
    await asUserTx(world.users.southManager, async (client) => {
      const rows = await client.query<{ mr_id: string }>(
        'select mr_id from public.team_exceptions()',
      );
      expect(rows.rows.map((r) => r.mr_id)).not.toContain(world.users.puneMr.id);
    });
  });
});

// =============================================================================
// Approval workflow
// =============================================================================

describe.skipIf(!reachable)('approval workflow', () => {
  it('offers a manager the reports they may decide', async () => {
    await asUserTx(world.users.westManager, async (client) => {
      const rows = await client.query<{ id: string }>(
        'select id from public.approvable_call_reports()',
      );
      expect(rows.rows.map((r) => r.id)).toContain(world.callReports.pune);
    });
  });

  it('never offers a manager their own report', async () => {
    await inRolledBackTransaction(async (client) => {
      // Give the manager a report of their own by making them the author.
      const visitId = randomUUID();
      const reportId = randomUUID();
      await client.query(
        `insert into public.visits (id, mr_id, doctor_id, status) values ($1, $2, $3, 'completed')`,
        [visitId, world.users.westManager.id, world.doctors.pune],
      );
      await client.query(
        `insert into public.call_reports (id, visit_id, mr_id, summary, status)
         values ($1, $2, $3, 'mine', 'submitted')`,
        [reportId, visitId, world.users.westManager.id],
      );
      await asUser(client, world.users.westManager);
      const rows = await client.query<{ id: string }>(
        'select id from public.approvable_call_reports()',
      );
      expect(rows.rows.map((r) => r.id)).not.toContain(reportId);
    });
  });

  it('offers an MR nothing at all', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const rows = await client.query('select id from public.approvable_call_reports()');
      expect(rows.rows).toEqual([]);
    });
  });

  it('decides forty reports in one call, with a verdict for each', async () => {
    await inRolledBackTransaction(async (client) => {
      const ids: string[] = [];
      for (let i = 0; i < 40; i += 1) {
        const visitId = randomUUID();
        const reportId = randomUUID();
        await client.query(
          `insert into public.visits (id, mr_id, doctor_id, status) values ($1, $2, $3, 'completed')`,
          [visitId, world.users.puneMr.id, world.doctors.pune],
        );
        await client.query(
          `insert into public.call_reports (id, visit_id, mr_id, summary, status)
           values ($1, $2, $3, $4, 'submitted')`,
          [reportId, visitId, world.users.puneMr.id, `report ${String(i)}`],
        );
        ids.push(reportId);
      }

      await asUser(client, world.users.westManager);
      const result = await client.query<{ payload: { results: Array<{ decided: boolean }> } }>(
        'select public.approve_call_reports_bulk($1, true, $2) as payload',
        [ids, 'Monday clear-down'],
      );

      const results = result.rows[0]?.payload.results ?? [];
      expect(results).toHaveLength(40);
      expect(results.every((r) => r.decided)).toBe(true);
    });
  });

  it('does not let one bad id roll back the rest of the batch', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.westManager);
      const result = await client.query<{
        payload: { results: Array<{ id: string; decided: boolean; error: string | null }> };
      }>('select public.approve_call_reports_bulk($1, true, $2) as payload', [
        [world.callReports.pune, randomUUID(), world.callReports.south],
        'mixed batch',
      ]);

      const results = result.rows[0]?.payload.results ?? [];
      expect(results[0]?.decided).toBe(true); // in scope
      expect(results[1]?.decided).toBe(false); // does not exist
      expect(results[2]?.decided).toBe(false); // another manager's team
      expect(results[2]?.error).toMatch(/not in your scope/);

      // The good one really was decided.
      const decided = await client.query<{ effective_status: string }>(
        'select effective_status from public.call_report_current where id = $1',
        [world.callReports.pune],
      );
      expect(decided.rows[0]?.effective_status).toBe('approved');
    });
  });

  it('reports its own truncation rather than silently dropping the tail', async () => {
    // Same failure as a silent cap in search_doctors, and it was fixed in one place
    // and not the other. A caller who submits 250 must be told 50 were not decided.
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.westManager);
      const ids = Array.from({ length: 250 }, () => randomUUID());
      const result = await client.query<{
        payload: {
          results: unknown[];
          decidedCount: number;
          notDecidedCount: number;
          submittedCount: number;
          truncated: boolean;
          limit: number;
        };
      }>('select public.approve_call_reports_bulk($1, true, $2) as payload', [ids, 'oversized']);

      const payload = result.rows[0]?.payload;
      expect(payload?.truncated).toBe(true);
      expect(payload?.limit).toBe(200);
      expect(payload?.submittedCount).toBe(250);
      expect(payload?.results).toHaveLength(200);
      expect((payload?.decidedCount ?? 0) + (payload?.notDecidedCount ?? 0)).toBe(200);
    });
  });

  it('reports truncated=false for a batch inside the cap', async () => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.westManager);
      const result = await client.query<{
        payload: { truncated: boolean; submittedCount: number };
      }>('select public.approve_call_reports_bulk($1, true, $2) as payload', [
        [world.callReports.pune],
        'small batch',
      ]);
      expect(result.rows[0]?.payload.truncated).toBe(false);
      expect(result.rows[0]?.payload.submittedCount).toBe(1);
    });
  });

  it('keeps effective_status derived rather than stored', async () => {
    await inRolledBackTransaction(async (client) => {
      const columns = await client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'call_reports'`,
      );
      const names = columns.rows.map((r) => r.column_name);
      expect(names).not.toContain('effective_status');
      expect(names).not.toContain('approved_by_user_id');
    });
  });

  it('escalates a report left undecided past the threshold', async () => {
    await asUserTx(world.users.westManager, async (client) => {
      const overdue = await client.query<{ call_report_id: string }>(
        `select call_report_id from public.overdue_call_reports(interval '0 seconds')`,
      );
      expect(overdue.rows.map((r) => r.call_report_id)).toContain(world.callReports.pune);
    });
  });

  it('stops escalating once a decision exists', async () => {
    await asUserTx(world.users.westManager, async (client) => {
      await client.query('select public.approve_call_report($1, true, $2)', [
        world.callReports.pune,
        'decided',
      ]);
      const overdue = await client.query<{ call_report_id: string }>(
        `select call_report_id from public.overdue_call_reports(interval '0 seconds')`,
      );
      expect(overdue.rows.map((r) => r.call_report_id)).not.toContain(world.callReports.pune);
    });
  });
});
