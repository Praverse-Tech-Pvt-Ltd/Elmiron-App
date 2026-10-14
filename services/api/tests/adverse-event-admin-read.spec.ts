import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase, withClient } from './db.js';
import { ANON_KEY, API_URL, asUser, mintAccessToken } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';
import {
  AdverseEventClockSummarySchema,
  AdverseEventListSchema,
  AdverseEventReadSchema,
} from '@fieldforce/core';

/**
 * `BE-W215` — a flagged adverse event reaches its own company's admin, and no other company can
 * count it (`20261014000200_adverse_event_admin_read`).
 *
 * Until Q-13 names a pharmacovigilance contact, the tenant's ADMIN is the human the flags route to;
 * C1 makes that admin a tenant administrator. So the matrix, for each of the three reads:
 *
 *   * the admin of organisation A succeeds and sees A's reports — the POSITIVE CONTROL, without
 *     which every "B's report is absent" below could pass because nothing is returned to anybody;
 *   * A's admin sees nothing of B's, and B's own admin does (the control on the other side);
 *   * A's field manager — the filing rep's own line manager — and A's rep are refused `42501`;
 *   * a reason is required where the rep's words or the queue are read, and each read writes ONE
 *     audit row naming it.
 *
 * Reports are inserted as the owner inside a rolled-back transaction, so nothing here is left
 * behind except the one HTTP refusal at the end, which has to commit to prove it is recorded.
 * Every `reported_text` below describes nobody.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

const SYNTHETIC = 'Prescriber mentioned a reaction during the call. No patient named.';
const REASON = 'BE-W215 spec: weekly PV review';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The SQLSTATE and message a statement fails with — or nulls when it succeeds. */
const failure = async (client: Client, sql: string, params: unknown[] = []) => {
  await client.query('savepoint probe');
  try {
    await client.query(sql, params);
    await client.query('release savepoint probe');
    return { code: null, message: null };
  } catch (error) {
    await client.query('rollback to savepoint probe');
    const e = error as { code?: string; message?: string };
    return { code: e.code ?? 'unknown', message: e.message ?? '' };
  }
};

const one = async <T>(client: Client, sql: string, params: unknown[] = []): Promise<T> => {
  const result = await client.query<{ v: T }>(sql, params);
  const row = result.rows[0];
  if (row === undefined) throw new Error(`no row from ${sql}`);
  return row.v;
};

/** Back to the owner, who may insert and read `audit_log`. The claims GUC is left as it was. */
const asOwnerNow = async (client: Client): Promise<void> => {
  await client.query('reset role');
};

/** An MR-reported flag, as `report_adverse_event` would write it; the trigger stamps the clock. */
const flag = async (client: Client, visitId: string, mr: FixtureUser): Promise<string> => {
  const id = randomUUID();
  await client.query(
    `insert into public.adverse_event_reports
       (id, visit_id, source, reported_by_mr_id, reported_text)
     values ($1, $2, 'mr_reported', $3, $4)`,
    [id, visitId, mr.id, SYNTHETIC],
  );
  return id;
};

/** A pipeline detection: a pointer, no words, nobody's name. */
const detection = async (client: Client, visitId: string): Promise<string> => {
  const id = randomUUID();
  await client.query(
    `insert into public.adverse_event_reports (id, visit_id, source, redacted_transcript_id)
     values ($1, $2, 'transcript_detected', $3)`,
    [id, visitId, randomUUID()],
  );
  return id;
};

/**
 * A flag with a chosen deadline. The trigger owns the clock, so the only way to have an overdue or
 * nearly-due report is to skip it: `replica` for this one insert, inside the rolled-back
 * transaction, with `received_at` fifteen days before the deadline so the row looks real.
 */
const flagDue = async (
  client: Client,
  visitId: string,
  mr: FixtureUser,
  dueIn: string,
): Promise<string> => {
  const id = randomUUID();
  await client.query('set local session_replication_role = replica');
  await client.query(
    `insert into public.adverse_event_reports
       (id, visit_id, source, reported_by_mr_id, reported_text, received_at, statutory_due_at)
     values ($1, $2, 'mr_reported', $3, $4,
             now() + $5::interval - interval '15 days', now() + $5::interval)`,
    [id, visitId, mr.id, SYNTHETIC, dueIn],
  );
  await client.query('set local session_replication_role = origin');
  return id;
};

/** Audited SELECTs of `adverse_event_reports` by this actor, read as the owner. */
const auditedReads = async (client: Client, actor: FixtureUser): Promise<number> => {
  await asOwnerNow(client);
  return Number(
    await one<string>(
      client,
      `select count(*)::text as v from public.audit_log
        where actor_id = $1 and table_name = 'adverse_event_reports' and action = 'select'`,
      [actor.id],
    ),
  );
};

const summary = (client: Client) =>
  one<unknown>(client, 'select public.adverse_event_clock_summary() as v');

const list = (client: Client, args: unknown[] = [REASON]) =>
  one<unknown>(
    client,
    `select public.list_adverse_events(${args.map((_, i) => `$${String(i + 1)}`).join(', ')}) as v`,
    args,
  );

const read = (client: Client, id: string, reason: string | null = REASON) =>
  one<unknown>(client, 'select public.read_adverse_event($1, $2) as v', [id, reason]);

// =============================================================================
// 1. The summary counts the caller's own company, for its admin
// =============================================================================

describe.skipIf(!reachable)('adverse_event_clock_summary — scoped to the caller’s company', () => {
  it('A’s admin counts A’s reports only; B’s admin counts B’s — the leak is closed', async () => {
    await inRolledBackTransaction(async (client) => {
      const aSoon = await flagDue(client, world.visits.pune, world.users.puneMr, '2 hours');
      const aOverdue = await flagDue(client, world.visits.pune, world.users.puneMr, '-2 days');
      await flag(client, world.visits.pune, world.users.puneMr);
      // B's reports, one of them overdue: if A's figures moved by any of these, the leak is back.
      await flag(client, world.visits.rival, world.users.rivalMr);
      await flagDue(client, world.visits.rival, world.users.rivalMr, '-5 days');
      await flagDue(client, world.visits.rival, world.users.rivalMr, '1 hour');

      // As jsonb renders it on this connection, so the comparison is exact to the microsecond.
      const due = (id: string) =>
        one<string>(
          client,
          `select to_jsonb(statutory_due_at) #>> '{}' as v
             from public.adverse_event_reports where id = $1`,
          [id],
        );
      const soonAt = await due(aSoon);
      const overdueAt = await due(aOverdue);

      await asUser(client, world.users.admin);
      const a = AdverseEventClockSummarySchema.parse(await summary(client));
      expect(a.total).toBe(3);
      expect(a.overdueCount).toBe(1);
      expect(a.dueWithin24Hours).toBe(1);
      // B's deadlines are nearer on both sides (1 hour; 5 days overdue); A's admin must see A's.
      expect(a.nextDueAt).toBe(soonAt);
      expect(a.oldestOverdueAt).toBe(overdueAt);

      await asUser(client, world.users.rivalAdmin);
      const b = AdverseEventClockSummarySchema.parse(await summary(client));
      expect(b.total).toBe(3);
      expect(b.overdueCount).toBe(1);
      expect(b.dueWithin24Hours).toBe(1);
    });
  });

  it('an admin with no reports gets zeroes and nulls, not another company’s figures', async () => {
    await inRolledBackTransaction(async (client) => {
      await flag(client, world.visits.rival, world.users.rivalMr);
      await asUser(client, world.users.admin);
      expect(AdverseEventClockSummarySchema.parse(await summary(client))).toEqual({
        total: 0,
        overdueCount: 0,
        dueWithin24Hours: 0,
        nextDueAt: null,
        oldestOverdueAt: null,
      });
    });
  });

  it.each(['westManager', 'puneMr', 'rivalMr'] as const)(
    'refuses %s with 42501 — only the admin is on the route until Q-13',
    async (who) => {
      await inRolledBackTransaction(async (client) => {
        await flag(client, world.visits.pune, world.users.puneMr);
        await asUser(client, world.users[who]);
        const f = await failure(client, 'select public.adverse_event_clock_summary()');
        expect(f.code).toBe('42501');
        expect(f.message).toMatch(/only an admin may read the adverse-event clock/);
      });
    },
  );
});

// =============================================================================
// 2. The list — the queue, without the words
// =============================================================================

describe.skipIf(!reachable)('list_adverse_events', () => {
  it('shows A’s admin A’s reports, newest first, and nothing of B’s', async () => {
    await inRolledBackTransaction(async (client) => {
      const older = await flag(client, world.visits.pune, world.users.puneMr);
      const detected = await detection(client, world.visits.pune);
      const theirs = await flag(client, world.visits.rival, world.users.rivalMr);

      await asUser(client, world.users.admin);
      const expectedDay = await one<string>(
        client,
        'select public.visit_day(v)::text as v from public.visits v where v.id = $1',
        [world.visits.pune],
      );
      const before = await auditedReads(client, world.users.admin);

      await asUser(client, world.users.admin);
      const raw = await list(client);
      const page = AdverseEventListSchema.parse(raw);
      const ids = page.data.map((r) => r.id);

      // The positive control first: A's reports ARE there, so B's absence means something.
      expect(ids).toEqual([detected, older]);
      expect(ids).not.toContain(theirs);
      expect(page.nextBeforeReceivedAt).toBeNull();
      expect(page.nextBeforeId).toBeNull();

      const filed = page.data.find((r) => r.id === older);
      expect(filed).toMatchObject({
        visitId: world.visits.pune,
        source: 'mr_reported',
        reportedByMrId: world.users.puneMr.id,
        reportedByName: world.users.puneMr.fullName,
        doctorId: world.doctors.pune,
        doctorName: 'Dr Pune Fixture',
        visitDate: expectedDay,
        overdue: false,
      });
      expect(filed?.hoursRemaining).toBeGreaterThan(14 * 24);
      // A detection is routed to the human too — and carries nobody's name.
      expect(page.data.find((r) => r.id === detected)).toMatchObject({
        source: 'transcript_detected',
        reportedByMrId: null,
        reportedByName: null,
      });

      // The rep's words are not in the list at all — not merely dropped by the schema.
      for (const row of (raw as { data: Record<string, unknown>[] }).data) {
        expect(row).not.toHaveProperty('reportedText');
      }

      // One audit row, with the reason, before anything was returned.
      expect(await auditedReads(client, world.users.admin)).toBe(before + 1);
      const audit = await client.query<{ reason: string; row_id: string | null; refused: boolean }>(
        'select reason, row_id, refused from public.audit_log where id = $1',
        [page.auditLogId],
      );
      expect(audit.rows[0]).toEqual({ reason: REASON, row_id: null, refused: false });

      // And the other side: B's admin sees B's report and none of A's.
      await asUser(client, world.users.rivalAdmin);
      const theirsPage = AdverseEventListSchema.parse(await list(client));
      expect(theirsPage.data.map((r) => r.id)).toEqual([theirs]);
    });
  });

  it('pages by the cursor it returns, without dropping or repeating a row', async () => {
    await inRolledBackTransaction(async (client) => {
      const filed: string[] = [];
      for (let i = 0; i < 3; i += 1)
        filed.push(await flag(client, world.visits.pune, world.users.puneMr));

      await asUser(client, world.users.admin);
      const first = AdverseEventListSchema.parse(await list(client, [REASON, 2]));
      expect(first.data.map((r) => r.id)).toEqual([filed[2], filed[1]]);
      expect(first.nextBeforeId).toBe(filed[1]);
      expect(first.nextBeforeReceivedAt).not.toBeNull();

      // The cursor goes back exactly as it came, microseconds and all.
      const second = AdverseEventListSchema.parse(
        await list(client, [REASON, 2, first.nextBeforeReceivedAt, first.nextBeforeId]),
      );
      expect(second.data.map((r) => r.id)).toEqual([filed[0]]);
      expect(second.nextBeforeId).toBeNull();
      expect(second.nextBeforeReceivedAt).toBeNull();
    });
  });

  it('bounds the page, and refuses half a cursor', async () => {
    await inRolledBackTransaction(async (client) => {
      await flag(client, world.visits.pune, world.users.puneMr);
      await flag(client, world.visits.pune, world.users.puneMr);
      await asUser(client, world.users.admin);

      expect(AdverseEventListSchema.parse(await list(client, [REASON, 0])).data).toHaveLength(1);
      const f = await failure(client, 'select public.list_adverse_events($1, 10, now(), null)', [
        REASON,
      ]);
      expect(f.code).toBe('22023');
      expect(f.message).toMatch(/cursor_incomplete/);
    });
  });

  it.each(['', '   ', null])('refuses an admin who gives no reason (%j)', async (reason) => {
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.admin);
      const f = await failure(client, 'select public.list_adverse_events($1)', [reason]);
      expect(f.code).toBe('22023');
      expect(f.message).toMatch(/requires a reason/);
    });
  });

  it.each(['westManager', 'puneMr'] as const)('refuses A’s %s with 42501', async (who) => {
    await inRolledBackTransaction(async (client) => {
      await flag(client, world.visits.pune, world.users.puneMr);
      await asUser(client, world.users[who]);
      const f = await failure(client, 'select public.list_adverse_events($1)', [REASON]);
      expect(f.code).toBe('42501');
      expect(f.message).toMatch(/only an admin may read adverse-event reports/);
    });
  });
});

// =============================================================================
// 3. One report, with the words, on purpose
// =============================================================================

describe.skipIf(!reachable)('read_adverse_event', () => {
  it('gives A’s admin the whole report and writes exactly one audit row with the reason', async () => {
    await inRolledBackTransaction(async (client) => {
      const id = await flag(client, world.visits.pune, world.users.puneMr);
      const before = await auditedReads(client, world.users.admin);

      await asUser(client, world.users.admin);
      const page = AdverseEventReadSchema.parse(await read(client, id));
      expect(page.data).toMatchObject({
        id,
        visitId: world.visits.pune,
        source: 'mr_reported',
        reportedText: SYNTHETIC,
        reportedByMrId: world.users.puneMr.id,
        reportedByName: world.users.puneMr.fullName,
        doctorName: 'Dr Pune Fixture',
        redactedTranscriptId: null,
        overdue: false,
      });

      expect(await auditedReads(client, world.users.admin)).toBe(before + 1);
      const audit = await client.query<{
        reason: string;
        row_id: string;
        refused: boolean;
        actor_role: string;
      }>('select reason, row_id, refused, actor_role from public.audit_log where id = $1', [
        page.auditLogId,
      ]);
      expect(audit.rows[0]).toEqual({
        reason: REASON,
        row_id: id,
        refused: false,
        actor_role: 'admin',
      });
    });
  });

  it('answers B’s report to A’s admin exactly as it answers an id that does not exist', async () => {
    await inRolledBackTransaction(async (client) => {
      const theirs = await flag(client, world.visits.rival, world.users.rivalMr);

      // Positive control: the report is real and its own admin reads it.
      await asUser(client, world.users.rivalAdmin);
      expect(AdverseEventReadSchema.parse(await read(client, theirs)).data?.reportedText).toBe(
        SYNTHETIC,
      );

      await asUser(client, world.users.admin);
      const foreign = AdverseEventReadSchema.parse(await read(client, theirs));
      const nowhere = AdverseEventReadSchema.parse(await read(client, randomUUID()));
      expect(foreign.data).toBeNull();
      expect(nowhere.data).toBeNull();
      expect(Object.keys(foreign).sort()).toEqual(Object.keys(nowhere).sort());
    });
  });

  it.each(['', '  ', null])('refuses an admin who gives no reason (%j)', async (reason) => {
    await inRolledBackTransaction(async (client) => {
      const id = await flag(client, world.visits.pune, world.users.puneMr);
      await asUser(client, world.users.admin);
      const f = await failure(client, 'select public.read_adverse_event($1, $2)', [id, reason]);
      expect(f.code).toBe('22023');
      expect(f.message).toMatch(/requires a reason/);
    });
  });

  it.each(['westManager', 'puneMr'] as const)(
    'refuses A’s %s with 42501, even for a report the rep filed',
    async (who) => {
      await inRolledBackTransaction(async (client) => {
        const id = await flag(client, world.visits.pune, world.users.puneMr);
        await asUser(client, world.users[who]);
        const f = await failure(client, 'select public.read_adverse_event($1, $2)', [id, REASON]);
        expect(f.code).toBe('42501');
        expect(f.message).toMatch(/only an admin may read an adverse-event report/);
      });
    },
  );

  it('leaves the rep’s own direct read exactly as it was', async () => {
    // BE-W7's policy is untouched: the rep still sees what they filed, and only that.
    await inRolledBackTransaction(async (client) => {
      const mine = await flag(client, world.visits.pune, world.users.puneMr);
      await asUser(client, world.users.puneMr);
      const { rows } = await client.query<{ id: string }>(
        'select id from public.adverse_event_reports where id = $1',
        [mine],
      );
      expect(rows.map((r) => r.id)).toEqual([mine]);
    });
  });
});

// =============================================================================
// 4. Over HTTP, a refusal is a 403 and is in the trail
// =============================================================================

describe.skipIf(!reachable)('a refused read over HTTP', () => {
  it('a rep asking for the clock gets 403 / 42501, and the attempt is recorded', async () => {
    // Not in a transaction: the property is that the audit row COMMITS while the caller is
    // refused (`refuse_read`, BE-W102). The row is real and is found again by the rep's id.
    const rep = world.users.puneMr;
    const count = () =>
      withClient(async (client) =>
        Number(
          await one<string>(
            client,
            `select count(*)::text as v from public.audit_log
              where actor_id = $1 and refused and table_name = 'adverse_event_reports'`,
            [rep.id],
          ),
        ),
      );
    const before = await count();

    const response = await fetch(`${API_URL}/rest/v1/rpc/adverse_event_clock_summary`, {
      method: 'POST',
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${mintAccessToken(rep)}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    const body = (await response.json()) as { code?: string; message?: string };

    expect(response.status).toBe(403);
    expect(body.code).toBe('42501');
    expect(body.message).toMatch(/only an admin may read the adverse-event clock/);
    expect(await count()).toBe(before + 1);
  });
});
