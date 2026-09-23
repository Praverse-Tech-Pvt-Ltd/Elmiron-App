import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { requireDatabase, withClient } from './db.js';
import { rest, signIn } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * MR-51 C1 — the 19 tables a signed-in user can read directly, probed across the tenant boundary.
 *
 * MR-50 C4 measured them from the catalogue: SELECT granted to `authenticated`, RLS forced, and only
 * PERMISSIVE policies — scoped by `visible_user_ids()` or `auth.uid()`, not by organisation. Whether
 * that scoping happens to stop at the tenant is a behaviour, so this asks the server: one row per
 * table belonging to the RIVAL organisation, read over real HTTP (PostgREST, a GoTrue password
 * sign-in, no `set local role`) by an MR and by an admin of the FIRST organisation. The positive
 * control is the row's own tenant reading the same row through the same request — without it, a
 * zero is indistinguishable from a row nobody can see.
 *
 * **How the rival rows are made.** As the owner with `session_replication_role = replica`, which
 * skips triggers and foreign-key checks. The probe is about the READ path: every policy here reads
 * only ownership columns (`mr_id`, `visit_id`, `reported_by_mr_id`, …) and parent rows this file
 * also creates, so validation triggers would add setup, not evidence. Two references dangle on
 * purpose and no policy reads them: `recordings.consent_record_id` and
 * `visit_audio_quarantine.finding_id`. The rows are committed (HTTP cannot see an open transaction)
 * and several tables are append-only, so they stay, keyed by a fresh id.
 */
const reachable = await requireDatabase();

let world: FixtureWorld;
const tokens = new Map<string, string>();
/** table -> [filter column, value] identifying the rival row. */
const rival = new Map<string, readonly [string, string]>();

const token = async (user: FixtureUser): Promise<string> => {
  const cached = tokens.get(user.id);
  if (cached !== undefined) return cached;
  const { accessToken } = await signIn(user.email, user.password);
  tokens.set(user.id, accessToken);
  return accessToken;
};

const seedRivalRows = async (): Promise<void> => {
  const mr = world.users.rivalMr.id;
  const admin = world.users.rivalAdmin.id;
  const visit = world.visits.rival;
  const doctor = world.doctors.rival;
  const territory = world.territories.rival;
  const id = {
    aer: randomUUID(),
    plan: randomUUID(),
    entry: randomUUID(),
    report: randomUUID(),
    approval: randomUUID(),
    checkIn: randomUUID(),
    checkOut: randomUUID(),
    recording: randomUUID(),
    sample: randomUUID(),
    batch: randomUUID(),
    event: randomUUID(),
    item: randomUUID(),
    reinstatement: randomUUID(),
    grant: randomUUID(),
    clearance: randomUUID(),
    note: randomUUID(),
    threshold: randomUUID(),
    quarantineVisit: randomUUID(),
  };

  await withClient(async (db) => {
    await db.query('begin');
    await db.query('set local session_replication_role = replica');
    const q = (sql: string, params: unknown[]) => db.query(sql, params);
    await q(
      // `statutory_due_at` is set explicitly because the trigger that would set it does not run
      // under `replica`. Left to default it equals `received_at`, so the row is born overdue --
      // and `adverse_event_clock_summary()` counts EVERY row in the database, so a probe row with
      // a wrong deadline fails an unrelated suite. A committed fixture must look like a real row
      // in any column another suite aggregates.
      `insert into public.adverse_event_reports
         (id, visit_id, source, reported_by_mr_id, reported_text, statutory_due_at)
       values ($1, $2, 'mr_reported', $3, 'MR-51 probe', now() + interval '15 days')`,
      [id.aer, visit, mr],
    );
    await q(
      `insert into public.app_thresholds (id, key, value, scope, territory_id, set_by_user_id)
       values ($1, $2, '42'::jsonb, 'territory', $3, $4)`,
      [id.threshold, `mr51_probe_${id.threshold}`, territory, admin],
    );
    await q(
      `insert into public.beat_plans (id, mr_id, territory_id, plan_date)
       values ($1, $2, $3, current_date + 400)`,
      [id.plan, mr, territory],
    );
    await q(
      `insert into public.beat_plan_entries (id, beat_plan_id, doctor_id, planned_sequence)
       values ($1, $2, $3, 1)`,
      [id.entry, id.plan, doctor],
    );
    await q(`insert into public.call_reports (id, visit_id, mr_id) values ($1, $2, $3)`, [
      id.report,
      visit,
      mr,
    ]);
    await q(
      `insert into public.call_report_approvals (id, call_report_id, decided_by_user_id, approved)
       values ($1, $2, $3, true)`,
      [id.approval, id.report, admin],
    );
    for (const [table, rowId] of [
      ['check_ins', id.checkIn],
      ['check_outs', id.checkOut],
    ] as const) {
      await q(
        `insert into public.${table}
           (id, visit_id, mr_id, latitude, longitude, geofence_status, source, occurred_at)
         values ($1, $2, $3, 18.52, 73.85, 'inside', 'manual', now())`,
        [rowId, visit, mr],
      );
    }
    await q(
      `insert into public.recordings
         (id, visit_id, mr_id, consent_record_id, bitrate_kbps, duration_seconds, size_bytes,
          recorded_at, purge_after)
       values ($1, $2, $3, $4, 32, 60, 1000, now(), now() + interval '30 days')`,
      [id.recording, visit, mr, randomUUID()],
    );
    await q(
      `insert into public.samples_and_inputs
         (id, visit_id, mr_id, doctor_id, kind, item_name, quantity, occurred_at)
       values ($1, $2, $3, $4, 'sample', 'MR-51 probe', 1, now())`,
      [id.sample, visit, mr, doctor],
    );
    await q(
      `insert into public.sync_batches (id, mr_id, item_count, submitted_at)
       values ($1, $2, 1, now())`,
      [id.batch, mr],
    );
    await q(
      `insert into public.sync_items
         (id, batch_id, mr_id, entity, operation, entity_id, payload, status, client_created_at)
       values ($1, $2, $3, 'visit', 'create', $4, '{}'::jsonb, 'accepted', now())`,
      [id.item, id.batch, mr, visit],
    );
    await q(
      `insert into public.sync_item_reinstatements
         (id, sync_item_id, reinstated_by_user_id, reason, attempts_at_reinstatement)
       values ($1, $2, $3, 'MR-51 probe', 1)`,
      [id.reinstatement, id.item, admin],
    );
    await q(
      `insert into public.sync_events (id, entity, entity_id, reason, former_mr_id)
       values ($1, 'visit', $2, 'deleted', $3)`,
      [id.event, visit, mr],
    );
    await q(
      `insert into public.upload_grants
         (id, visit_id, mr_id, kind, storage_key, max_bytes, max_duration_seconds, expires_at,
          hard_expires_at)
       values ($1, $2, $3, 'voice_note', $4, 1000, 60, now() + interval '15 minutes',
               now() + interval '1 hour')`,
      [id.grant, visit, mr, `probe/${id.grant}`],
    );
    // The quarantine's key is the visit, so it takes a rival visit of its own.
    await q(`insert into public.visits (id, doctor_id, mr_id) values ($1, $2, $3)`, [
      id.quarantineVisit,
      doctor,
      mr,
    ]);
    await q(
      `insert into public.visit_audio_quarantine (visit_id, finding_id, reason)
       values ($1, 1, 'MR-51 probe')`,
      [id.quarantineVisit],
    );
    await q(
      `insert into public.visit_audio_quarantine_clearances (id, visit_id, cleared_by_user_id, reason)
       values ($1, $2, $3, 'MR-51 probe')`,
      [id.clearance, id.quarantineVisit, admin],
    );
    await q(
      `insert into public.voice_notes
         (id, visit_id, mr_id, duration_seconds, size_bytes, recorded_at, purge_after)
       values ($1, $2, $3, 30, 1000, now(), now() + interval '30 days')`,
      [id.note, visit, mr],
    );
    await db.query('commit');
  });

  const byId: [string, string][] = [
    ['adverse_event_reports', id.aer],
    ['app_thresholds', id.threshold],
    ['beat_plan_entries', id.entry],
    ['beat_plans', id.plan],
    ['call_report_approvals', id.approval],
    ['call_reports', id.report],
    ['check_ins', id.checkIn],
    ['check_outs', id.checkOut],
    ['recordings', id.recording],
    ['samples_and_inputs', id.sample],
    ['sync_batches', id.batch],
    ['sync_events', id.event],
    ['sync_item_reinstatements', id.reinstatement],
    ['sync_items', id.item],
    ['upload_grants', id.grant],
    ['visit_audio_quarantine_clearances', id.clearance],
    ['visits', visit],
    ['voice_notes', id.note],
  ];
  for (const [table, rowId] of byId) rival.set(table, ['id', rowId]);
  rival.set('visit_audio_quarantine', ['visit_id', id.quarantineVisit]);
};

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
  await seedRivalRows();
}, 120_000);

/** Rows of `table` matching the rival row, as `user` sees them over HTTP. */
const seen = async (table: string, user: FixtureUser): Promise<number> => {
  const [column, value] = rival.get(table) ?? ['', ''];
  const response = await rest(`/${table}?select=*&${column}=eq.${value}`, {
    token: await token(user),
  });
  expect(response.status, `${table}: ${response.text}`).toBe(200);
  return (response.body as unknown[]).length;
};

/**
 * 18 of the 19 from MR-50 C4's catalogue measurement (`app_thresholds` is below, on its own), with the rival user who legitimately sees the row:
 * the MR for the two own-row-only tables, otherwise the rival admin.
 */
const TABLES: readonly (readonly [string, 'rivalMr' | 'rivalAdmin'])[] = [
  ['adverse_event_reports', 'rivalMr'],
  ['beat_plan_entries', 'rivalAdmin'],
  ['beat_plans', 'rivalAdmin'],
  ['call_report_approvals', 'rivalAdmin'],
  ['call_reports', 'rivalAdmin'],
  ['check_ins', 'rivalAdmin'],
  ['check_outs', 'rivalAdmin'],
  ['recordings', 'rivalAdmin'],
  ['samples_and_inputs', 'rivalAdmin'],
  ['sync_batches', 'rivalAdmin'],
  ['sync_events', 'rivalAdmin'],
  ['sync_item_reinstatements', 'rivalAdmin'],
  ['sync_items', 'rivalAdmin'],
  ['upload_grants', 'rivalMr'],
  ['visit_audio_quarantine', 'rivalAdmin'],
  ['visit_audio_quarantine_clearances', 'rivalAdmin'],
  ['visits', 'rivalAdmin'],
  ['voice_notes', 'rivalAdmin'],
];

describe.skipIf(!reachable)('C1 — a row of another organisation, read directly', () => {
  it.each(TABLES)('%s: the other tenant reads 0; its own tenant reads 1', async (table, owner) => {
    const own = await seen(table, world.users[owner]);
    const mr = await seen(table, world.users.puneMr);
    const admin = await seen(table, world.users.admin);
    console.log(
      `C1 ${table} | A-MR ${String(mr)} | A-admin ${String(admin)} | B-${owner} ${String(own)}`,
    );
    expect(own, 'positive control: the owning tenant sees its row').toBe(1);
    expect(mr, 'an MR of another organisation').toBe(0);
    expect(admin, 'an admin of another organisation').toBe(0);
  });

  /**
   * The one that leaks, measured in C1 and left open by the operator (`C13`): it is `BE-W106`, a
   * settings-model decision (`blocked-on-you` 2.7). Asserted AS it is, so the day it is fixed this
   * fails and the register gets updated with it -- not quietly skipped, not written as if fixed.
   */
  it('app_thresholds -- BE-W106, OPEN: another organisation reads a territory setting', async () => {
    const own = await seen('app_thresholds', world.users.rivalAdmin);
    const mr = await seen('app_thresholds', world.users.puneMr);
    const admin = await seen('app_thresholds', world.users.admin);
    console.log(
      `C1 app_thresholds | A-MR ${String(mr)} | A-admin ${String(admin)} | B-rivalAdmin ${String(own)}`,
    );
    expect(own).toBe(1);
    expect(mr, 'BE-W106: an MR of another organisation reads it').toBe(1);
    expect(admin, 'BE-W106: an admin of another organisation reads it').toBe(1);
  });
});
