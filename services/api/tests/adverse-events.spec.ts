import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asUser, asDatabaseRole } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * BE-W7 — adverse-event ingest, mechanical half only.
 *
 * The PV and privacy sign-off that governs the legal design of this path has been
 * outstanding since week 1, so only three things are built and only three things are
 * tested here:
 *
 *   1. The record is append-only.
 *   2. The statutory clock starts at the server's receipt.
 *   3. Routing is to a human, always.
 *
 * The third is tested as an ABSENCE, which is the only way to test it. There is no
 * severity column to assert the value of; the assertion is that no such column
 * exists, so the next person who wants one has to delete a test to get it.
 *
 * No PHI. Every reported_text below describes nobody.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

const asUserTx = async <T>(user: FixtureUser, fn: (client: Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await asUser(client, user);
    return fn(client);
  });

const SYNTHETIC_REPORT = 'Prescriber mentioned a reaction during the call. No patient named.';

// =============================================================================
// 1. Ingest
// =============================================================================

describe.skipIf(!reachable)('reporting an adverse event', () => {
  it('records what the MR said, attributed to them', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const id = randomUUID();
      const row = await client.query<{
        source: string;
        reported_by_mr_id: string;
        reported_text: string;
      }>(
        'select source, reported_by_mr_id, reported_text from public.report_adverse_event($1, $2, $3)',
        [id, world.visits.pune, SYNTHETIC_REPORT],
      );

      expect(row.rows[0]?.source).toBe('mr_reported');
      expect(row.rows[0]?.reported_by_mr_id).toBe(world.users.puneMr.id);
      expect(row.rows[0]?.reported_text).toBe(SYNTHETIC_REPORT);
    });
  });

  it('refuses a report with no description of what happened', async () => {
    // A report that discharges no duty is worse than no report: it starts a clock
    // nobody can act on.
    await expect(
      asUserTx(world.users.puneMr, (client) =>
        client.query('select public.report_adverse_event($1, $2, $3)', [
          randomUUID(),
          world.visits.pune,
          '   ',
        ]),
      ),
    ).rejects.toThrow(/needs a description/);
  });

  it('refuses a report against somebody else’s visit', async () => {
    await expect(
      asUserTx(world.users.puneMr, (client) =>
        client.query('select public.report_adverse_event($1, $2, $3)', [
          randomUUID(),
          world.visits.south,
          SYNTHETIC_REPORT,
        ]),
      ),
    ).rejects.toThrow(/is not yours/);
  });

  it('is idempotent, so the offline queue can retry it safely', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      const id = randomUUID();
      const args = [id, world.visits.pune, SYNTHETIC_REPORT];
      await client.query('select public.report_adverse_event($1, $2, $3)', args);
      await client.query('select public.report_adverse_event($1, $2, $3)', args);

      const count = await client.query<{ count: string }>(
        'select count(*) as count from public.adverse_event_reports where visit_id = $1',
        [world.visits.pune],
      );
      // A duplicate adverse event is a duplicate statutory deadline and a duplicate
      // report to the regulator.
      expect(Number(count.rows[0]?.count)).toBe(1);
    });
  });

  it('keeps the pipeline out of the field’s hands', async () => {
    await expect(
      asUserTx(world.users.puneMr, (client) =>
        client.query('select public.ingest_detected_adverse_event($1, $2, $3)', [
          randomUUID(),
          world.visits.pune,
          randomUUID(),
        ]),
      ),
      // A detection carries nobody's name. An MR filing one would be an
      // unattributable report.
    ).rejects.toThrow(/permission denied/i);
  });
});

// =============================================================================
// 2. The statutory clock
// =============================================================================

describe.skipIf(!reachable)('the fifteen-day clock', () => {
  it('starts at the server’s receipt, not at anything the device claims', async () => {
    await inRolledBackTransaction(async (client) => {
      const id = randomUUID();
      // The same shape as the received_at test in BE-W3 and the retention test in
      // BE-W6: a device that could start or shorten a compliance clock by lying
      // about when something happened would make every one of them worthless.
      await client.query(
        `insert into public.adverse_event_reports
           (id, visit_id, source, reported_by_mr_id, reported_text,
            received_at, statutory_due_at, client_reported_at)
         values ($1, $2, 'mr_reported', $3, $4,
                 now() - interval '200 days',   -- the device claims it is ancient
                 now() - interval '185 days',   -- and that the deadline has passed
                 now() - interval '200 days')`,
        [id, world.visits.pune, world.users.puneMr.id, SYNTHETIC_REPORT],
      );

      const row = await client.query<{
        received_at: string;
        statutory_due_at: string;
        client_reported_at: string;
      }>(
        `select received_at, statutory_due_at, client_reported_at
           from public.adverse_event_reports where id = $1`,
        [id],
      );

      expect(Date.now() - new Date(row.rows[0]?.received_at ?? 0).getTime()).toBeLessThan(60_000);

      const due = new Date(row.rows[0]?.statutory_due_at ?? 0).getTime();
      expect(due).toBeGreaterThan(Date.now() + 14.5 * 24 * 3600 * 1000);
      expect(due).toBeLessThan(Date.now() + 15.5 * 24 * 3600 * 1000);

      // The device's claim is kept. It is evidence about the MR's experience — it is
      // simply not the clock.
      expect(Date.now() - new Date(row.rows[0]?.client_reported_at ?? 0).getTime()).toBeGreaterThan(
        190 * 24 * 3600 * 1000,
      );
    });
  });

  it('is exactly fifteen days after receipt, in a pinned timezone', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      // A statutory deadline that can be wrong by a timezone will eventually be
      // wrong by a timezone. The trigger pins Asia/Kolkata rather than inheriting
      // whatever the connection happens to be set to.
      await client.query(`set local timezone = 'America/Los_Angeles'`);
      const row = await client.query<{ received_at: string; statutory_due_at: string }>(
        `select received_at, statutory_due_at
           from public.report_adverse_event($1, $2, $3)`,
        [randomUUID(), world.visits.pune, SYNTHETIC_REPORT],
      );

      const received = new Date(row.rows[0]?.received_at ?? 0).getTime();
      const due = new Date(row.rows[0]?.statutory_due_at ?? 0).getTime();
      expect(due - received).toBe(15 * 24 * 3600 * 1000);
    });
  });

  it('is visible and countable from day one', async () => {
    await asUserTx(world.users.puneMr, async (client) => {
      await client.query('select public.report_adverse_event($1, $2, $3)', [
        randomUUID(),
        world.visits.pune,
        SYNTHETIC_REPORT,
      ]);

      const clock = await client.query<{ hours_remaining: number; overdue: boolean }>(
        'select hours_remaining, overdue from public.adverse_event_clock',
      );
      expect(clock.rows[0]?.overdue).toBe(false);
      expect(clock.rows[0]?.hours_remaining).toBeGreaterThan(14 * 24);

      const summary = await client.query<{ s: { total: number; overdueCount: number } }>(
        'select public.adverse_event_clock_summary() as s',
      );
      // Because the thing that gets missed is a deadline nobody was counting.
      expect(summary.rows[0]?.s.total).toBeGreaterThanOrEqual(1);
      expect(summary.rows[0]?.s.overdueCount).toBe(0);
    });
  });

  it('counts an overdue report as overdue', async () => {
    await inRolledBackTransaction(async (client) => {
      const id = randomUUID();
      await client.query(
        `insert into public.adverse_event_reports
           (id, visit_id, source, reported_by_mr_id, reported_text)
         values ($1, $2, 'mr_reported', $3, $4)`,
        [id, world.visits.pune, world.users.puneMr.id, SYNTHETIC_REPORT],
      );
      // The trigger owns the clock, so an overdue case has to be manufactured
      // through the one path that can: an out-of-band update by the owner. That the
      // update below is possible at all is itself asserted against, further down.
      await client.query(
        'alter table public.adverse_event_reports disable trigger adverse_event_reports_reject_mutation',
      );
      await client.query(
        `update public.adverse_event_reports
            set statutory_due_at = now() - interval '2 days' where id = $1`,
        [id],
      );
      await client.query(
        'alter table public.adverse_event_reports enable trigger adverse_event_reports_reject_mutation',
      );

      const clock = await client.query<{ overdue: boolean; hours_remaining: number }>(
        'select overdue, hours_remaining from public.adverse_event_clock where id = $1',
        [id],
      );
      expect(clock.rows[0]?.overdue).toBe(true);
      expect(clock.rows[0]?.hours_remaining).toBeLessThan(0);
    });
  });
});

// =============================================================================
// 3. Append-only, against everybody
// =============================================================================

describe.skipIf(!reachable)('the record cannot be changed', () => {
  const seed = async (client: Client): Promise<string> => {
    const id = randomUUID();
    await client.query(
      `insert into public.adverse_event_reports
         (id, visit_id, source, reported_by_mr_id, reported_text)
       values ($1, $2, 'mr_reported', $3, $4)`,
      [id, world.visits.pune, world.users.puneMr.id, SYNTHETIC_REPORT],
    );
    return id;
  };

  it.each(['update', 'delete'] as const)('refuses %s from the table owner', async (operation) => {
    await expect(
      inRolledBackTransaction(async (client) => {
        const id = await seed(client);
        // As `postgres`, which holds BYPASSRLS. An absent policy would stop nothing;
        // the statement-level trigger is the control.
        return operation === 'update'
          ? client.query(
              `update public.adverse_event_reports set reported_text = 'edited' where id = $1`,
              [id],
            )
          : client.query('delete from public.adverse_event_reports where id = $1', [id]);
      }),
    ).rejects.toThrow(/append-only/);
  });

  it('refuses an update that matches no rows at all', async () => {
    // A row-level trigger never fires for a zero-row UPDATE, so it would report
    // "0 rows affected" and read as success. The guard is statement-level.
    await expect(
      inRolledBackTransaction((client) =>
        client.query(
          `update public.adverse_event_reports set reported_text = 'edited'
            where id = '00000000-0000-4000-8000-000000000000'`,
        ),
      ),
    ).rejects.toThrow(/append-only/);
  });

  it('refuses truncate', async () => {
    await expect(
      inRolledBackTransaction((client) => client.query('truncate public.adverse_event_reports')),
    ).rejects.toThrow(/append-only/);
  });

  it('holds no update or delete privilege for service_role either', async () => {
    await inRolledBackTransaction(async (client) => {
      const grants = await client.query<{ privilege_type: string }>(
        `select privilege_type from information_schema.role_table_grants
          where table_name = 'adverse_event_reports' and grantee = 'service_role'
            and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')`,
      );
      // The trigger already refuses. Revoking as well means the attempt does not
      // even reach it — two independent layers, as with consent_records.
      expect(grants.rows).toEqual([]);
    });
  });
});

// =============================================================================
// 4. Routing is to a human, always
// =============================================================================

describe.skipIf(!reachable)('no machine gets an opinion', () => {
  it('has no column a model could write a judgement into', async () => {
    await inRolledBackTransaction(async (client) => {
      const columns = await client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'adverse_event_reports'`,
      );
      const names = columns.rows.map((r) => r.column_name);

      // Absent by design, not by omission. A field a model could write a judgement
      // into is a field a model will write a judgement into, and every adverse event
      // this system sees would then arrive pre-sorted by software.
      for (const forbidden of [
        'severity',
        'seriousness',
        'priority',
        'triage_state',
        'triage_status',
        'confidence',
        'score',
        'risk_level',
        'category',
        'classification',
        'assessment',
        'causality',
        'auto_resolved',
      ]) {
        expect(names, `adverse_event_reports must not have a ${forbidden} column`).not.toContain(
          forbidden,
        );
      }
    });
  });

  it('gives the LLM gateway no access of any kind', async () => {
    await inRolledBackTransaction(async (client) => {
      const grants = await client.query<{ privilege_type: string }>(
        `select privilege_type from information_schema.role_table_grants
          where table_name in ('adverse_event_reports', 'adverse_event_clock')
            and grantee = 'llm_gateway'`,
      );
      expect(grants.rows).toEqual([]);
    });
  });

  it('refuses the gateway a read, rather than returning it nothing', async () => {
    await expect(
      inRolledBackTransaction(async (client) => {
        await client.query('set local role llm_gateway');
        return client.query('select * from public.adverse_event_reports');
      }),
      // The Gate 0 amendment's distinction: here the ABSENCE of a grant is the
      // control, so an empty result would mean the control is missing and something
      // else happened to filter the rows.
    ).rejects.toThrow(/permission denied/i);
  });

  it('shows an MR their own reports and not the pipeline’s detections', async () => {
    await inRolledBackTransaction(async (client) => {
      const mine = randomUUID();
      const detected = randomUUID();
      await client.query(
        `insert into public.adverse_event_reports
           (id, visit_id, source, reported_by_mr_id, reported_text)
         values ($1, $2, 'mr_reported', $3, $4)`,
        [mine, world.visits.pune, world.users.puneMr.id, SYNTHETIC_REPORT],
      );
      await client.query(
        `insert into public.adverse_event_reports
           (id, visit_id, source, redacted_transcript_id)
         values ($1, $2, 'transcript_detected', $3)`,
        [detected, world.visits.pune, randomUUID()],
      );

      await asUser(client, world.users.puneMr);
      const visible = await client.query<{ id: string }>(
        'select id from public.adverse_event_reports',
      );
      const ids = visible.rows.map((r) => r.id);

      expect(ids).toContain(mine);
      // Being shown that software flagged your consultation, with no human having
      // looked yet, is an accusation the system is not in a position to make.
      expect(ids).not.toContain(detected);
    });
  });

  it('lets nobody in the field write the table directly', async () => {
    await expect(
      inRolledBackTransaction(async (client) => {
        await asDatabaseRole(client, 'authenticated');
        return client.query(
          `insert into public.adverse_event_reports (id, visit_id, source, reported_text)
           values (gen_random_uuid(), $1, 'mr_reported', 'direct write')`,
          [world.visits.pune],
        );
      }),
    ).rejects.toThrow(/permission denied/i);
  });
});

// =============================================================================
// 5. The shape the sign-off has to rule on
// =============================================================================

describe.skipIf(!reachable)('what is deliberately unresolved', () => {
  it('points at the redacted transcript and never copies its text', async () => {
    await inRolledBackTransaction(async (client) => {
      const columns = await client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'adverse_event_reports'`,
      );
      const names = columns.rows.map((r) => r.column_name);

      expect(names).toContain('redacted_transcript_id');
      // The redaction gate is the only reason an automated detector may look at a
      // consultation at all. A table that copied the passage out would route around
      // it.
      expect(names).not.toContain('raw_transcript_id');
      expect(names).not.toContain('segments');
      expect(names).not.toContain('transcript_text');
    });
  });

  it('survives the withdrawal that destroys the transcript it points at', async () => {
    // Found by a test, not by reasoning: written as `references ... on delete set
    // null`, deleting the transcript makes Postgres issue an UPDATE here, which the
    // append-only trigger refuses — so a consent withdrawal would fail outright for
    // any visit with an adverse event. `on delete restrict` is worse still: it lets
    // an adverse-event report veto a doctor's withdrawal.
    await inRolledBackTransaction(async (client) => {
      const constraints = await client.query<{ count: string }>(
        `select count(*) as count
           from information_schema.referential_constraints rc
           join information_schema.key_column_usage k
             on k.constraint_name = rc.constraint_name
          where k.table_name = 'adverse_event_reports'
            and k.column_name = 'redacted_transcript_id'`,
      );
      expect(Number(constraints.rows[0]?.count)).toBe(0);
    });
  });

  it('keeps the MR’s own words, which is the field the sign-off must rule on', async () => {
    await inRolledBackTransaction(async (client) => {
      const columns = await client.query<{ column_name: string; is_nullable: string }>(
        `select column_name, is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = 'adverse_event_reports'
            and column_name = 'reported_text'`,
      );
      // It exists because a report with no description discharges no duty. It is the
      // one field here that can carry patient information, which is exactly the
      // §2.6-versus-DPDP tension nobody has ruled on. Omitting it would have decided
      // that question silently, by making the feature useless.
      expect(columns.rows).toHaveLength(1);
      expect(columns.rows[0]?.is_nullable).toBe('YES');
    });
  });

  it('requires a detection to carry a transcript and no free text', async () => {
    await expect(
      inRolledBackTransaction((client) =>
        client.query(
          `insert into public.adverse_event_reports (id, visit_id, source, reported_text)
           values (gen_random_uuid(), $1, 'transcript_detected', 'a model wrote this')`,
          [world.visits.pune],
        ),
      ),
    ).rejects.toThrow(/adverse_event_mr_reported_shape/);
  });
});
