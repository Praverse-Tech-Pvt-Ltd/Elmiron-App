import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  fromCheckInRow,
  fromMileageRow,
  fromVisitRow,
  refusalForSqlState,
  toCreateVisitBody,
} from '@fieldforce/core';
import { requireDatabase, withClient } from './db.js';
import { mintAccessToken, rest } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * FE-W15 — the first write in this product's history that reaches a real server.
 *
 * Every other write in `apps/field` goes to `services/mock`, which answers `201` and
 * forgets it. This exercises the whole chain over HTTP: a real token through Kong, the
 * `record_check_in` RPC, the server-side work-hours refusal, and a row that is still
 * there afterwards.
 *
 * The client half — mapping the row and the refusal into something an MR can act on —
 * is covered in `apps/field/src/capture/check-in.test.ts`. The two meet at
 * `fromCheckInRow` and `refusalForSqlState`, both exercised here against the real
 * payloads rather than fixtures of them.
 *
 * A Monday at noon IST, fixed rather than "now": the national window is 09:00-19:00,
 * Mon-Sat, so a test that used the wall clock would fail on a Sunday and at 8pm.
 */
const INSIDE_THE_WINDOW = '2026-09-07T12:00:00+05:30';
const OUTSIDE_THE_WINDOW = '2026-09-07T22:00:00+05:30';

const reachable = await requireDatabase();
let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
});

describe.skipIf(!reachable)('a check-in reaches the database and stays there', () => {
  it('persists, and the row can be read back by id', async () => {
    const id = randomUUID();
    const response = await rest('/rpc/record_check_in', {
      method: 'POST',
      token: mintAccessToken(world.users.puneMr),
      body: {
        p_id: id,
        p_visit_id: world.visits.pune,
        p_latitude: 18.52,
        p_longitude: 73.85,
        p_occurred_at: INSIDE_THE_WINDOW,
      },
    });

    expect(response.status).toBe(200);

    // Read it back from the database, not from the response. A server that echoes its
    // input proves nothing about persistence.
    const stored = await withClient((client) =>
      client.query<{ id: string; mr_id: string }>(
        'select id, mr_id from public.check_ins where id = $1',
        [id],
      ),
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]?.mr_id).toBe(world.users.puneMr.id);
  });

  it('stamps received_at from the SERVER clock, not the device', async () => {
    // The compliance rule this product runs on. `occurred_at` is what the handset
    // claimed; `received_at` is when the server took delivery. A device that lies about
    // its clock must not be able to move the second one.
    const id = randomUUID();
    await rest('/rpc/record_check_in', {
      method: 'POST',
      token: mintAccessToken(world.users.puneMr),
      body: {
        p_id: id,
        p_visit_id: world.visits.pune,
        p_latitude: 18.52,
        p_longitude: 73.85,
        p_occurred_at: INSIDE_THE_WINDOW,
      },
    });

    const stored = await withClient((client) =>
      client.query<{ occurred_at: string; received_at: string; drift_seconds: string }>(
        `select occurred_at, received_at,
                extract(epoch from (received_at - occurred_at))::text as drift_seconds
           from public.check_ins where id = $1`,
        [id],
      ),
    );
    const row = stored.rows[0];
    expect(row).toBeDefined();
    // The device claimed a fixed date in the past; the server stamped now. If these were
    // equal the server would be trusting the handset's clock.
    expect(row?.occurred_at).not.toBe(row?.received_at);
    expect(Math.abs(Number(row?.drift_seconds))).toBeGreaterThan(0);
  });

  it('the response row maps cleanly through the shared contract mapper', async () => {
    const id = randomUUID();
    const response = await rest('/rpc/record_check_in', {
      method: 'POST',
      token: mintAccessToken(world.users.puneMr),
      body: {
        p_id: id,
        p_visit_id: world.visits.pune,
        p_latitude: 18.52,
        p_longitude: 73.85,
        p_occurred_at: INSIDE_THE_WINDOW,
      },
    });

    // `fromCheckInRow` is the same function `apps/field` uses. If PostgREST's shape ever
    // drifts from the contract, this throws here rather than on a screen.
    const checkIn = fromCheckInRow(response.body);
    expect(checkIn.id).toBe(id);
    expect(checkIn.coordinates.latitude).toBeCloseTo(18.52);
    expect(checkIn.visitId).toBe(world.visits.pune);
  });
});

describe.skipIf(!reachable)('the refusal path is a refusal, not a silent success', () => {
  it('refuses a check-in outside the shift window, with SQLSTATE 45003', async () => {
    const id = randomUUID();
    const response = await rest('/rpc/record_check_in', {
      method: 'POST',
      token: mintAccessToken(world.users.puneMr),
      body: {
        p_id: id,
        p_visit_id: world.visits.pune,
        p_latitude: 18.52,
        p_longitude: 73.85,
        p_occurred_at: OUTSIDE_THE_WINDOW,
      },
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = response.body as { code?: string };
    expect(body.code).toBe('45003');

    // And it reaches the client as something the MR can act on.
    const refusal = refusalForSqlState(body.code);
    expect(refusal.code).toBe('outside_shift_window');
    expect(refusal.actionable).toBe(true);

    // The refusal wrote nothing. A refusal that leaves a row behind is worse than one
    // that fails loudly, because the row looks like a successful capture afterwards.
    const stored = await withClient((client) =>
      client.query('select 1 from public.check_ins where id = $1', [id]),
    );
    expect(stored.rows).toHaveLength(0);
  });

  it('refuses a visit that belongs to another MR', async () => {
    const response = await rest('/rpc/record_check_in', {
      method: 'POST',
      token: mintAccessToken(world.users.puneMr),
      body: {
        p_id: randomUUID(),
        p_visit_id: world.visits.south,
        p_latitude: 18.52,
        p_longitude: 73.85,
        p_occurred_at: INSIDE_THE_WINDOW,
      },
    });

    const body = response.body as { code?: string };
    expect(body.code).toBe('42501');
    expect(refusalForSqlState(body.code).code).toBe('not_permitted');
  });

  it('refuses an unauthenticated caller', async () => {
    const response = await rest('/rpc/record_check_in', {
      method: 'POST',
      body: {
        p_id: randomUUID(),
        p_visit_id: world.visits.pune,
        p_latitude: 18.52,
        p_longitude: 73.85,
        p_occurred_at: INSIDE_THE_WINDOW,
      },
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});

describe.skipIf(!reachable)('a visit is written to the table, not through an RPC', () => {
  it('creates a visit WITHOUT sending mr_id, and the server fills it', async () => {
    // The contract's CreateVisitRequest has never declared mrId, and the insert policy
    // requires mr_id = auth.uid(). Migration 20260907000600 makes that satisfiable by
    // defaulting the column, so the caller cannot assert an identity at all.
    const id = randomUUID();
    const body = toCreateVisitBody({ id, doctorId: world.doctors.pune });
    expect(Object.keys(body)).not.toContain('mr_id');

    const response = await rest('/visits', {
      method: 'POST',
      token: mintAccessToken(world.users.puneMr),
      body,
      headers: { Prefer: 'return=representation' },
    });
    expect(response.status).toBe(201);

    const stored = await withClient((client) =>
      client.query<{ mr_id: string }>('select mr_id from public.visits where id = $1', [id]),
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]?.mr_id).toBe(world.users.puneMr.id);
  });

  it('the created row maps cleanly through the shared contract mapper', async () => {
    const id = randomUUID();
    const response = await rest('/visits', {
      method: 'POST',
      token: mintAccessToken(world.users.puneMr),
      body: toCreateVisitBody({ id, doctorId: world.doctors.pune }),
      headers: { Prefer: 'return=representation' },
    });
    // PostgREST answers a table insert with an ARRAY even for one row; supabase-js
    // unwraps it with .single(). The mapper takes the object, so the test does too.
    const rows = response.body as unknown[];
    const visit = fromVisitRow(rows[0]);
    expect(visit.id).toBe(id);
    expect(visit.mrId).toBe(world.users.puneMr.id);
    expect(visit.status).toBe('planned');
  });

  it('updates a visit the MR owns', async () => {
    const id = randomUUID();
    await rest('/visits', {
      method: 'POST',
      token: mintAccessToken(world.users.puneMr),
      body: toCreateVisitBody({ id, doctorId: world.doctors.pune }),
      headers: { Prefer: 'return=representation' },
    });

    await rest(`/visits?id=eq.${id}`, {
      method: 'PATCH',
      token: mintAccessToken(world.users.puneMr),
      body: { status: 'in_progress', started_at: '2026-09-07T12:00:00+05:30' },
      headers: { Prefer: 'return=representation' },
    });

    const stored = await withClient((client) =>
      client.query<{ status: string }>('select status from public.visits where id = $1', [id]),
    );
    expect(stored.rows[0]?.status).toBe('in_progress');
  });

  it('refuses a doctor outside the MR territory, and writes nothing', async () => {
    const id = randomUUID();
    const response = await rest('/visits', {
      method: 'POST',
      token: mintAccessToken(world.users.puneMr),
      body: toCreateVisitBody({ id, doctorId: world.doctors.south }),
      headers: { Prefer: 'return=representation' },
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = response.body as { code?: string };
    expect(refusalForSqlState(body.code).code).toBe('not_permitted');

    const stored = await withClient((client) =>
      client.query('select 1 from public.visits where id = $1', [id]),
    );
    expect(stored.rows).toHaveLength(0);
  });

  it("refuses to update another MR's visit", async () => {
    const response = await rest(`/visits?id=eq.${world.visits.south}`, {
      method: 'PATCH',
      token: mintAccessToken(world.users.puneMr),
      body: { status: 'in_progress' },
      headers: { Prefer: 'return=representation' },
    });
    // The update policy filters rather than raising, so the honest assertion is that
    // nothing changed -- non-mutation, which is the amended Gate 0 criterion.
    const stored = await withClient((client) =>
      client.query<{ status: string }>('select status from public.visits where id = $1', [
        world.visits.south,
      ]),
    );
    expect(stored.rows[0]?.status).not.toBe('in_progress');
    expect([200, 204, 403, 404]).toContain(response.status);
  });
});

describe.skipIf(!reachable)('mileage comes from the server, never from the device', () => {
  it('returns the MR own days through daily_mileage', async () => {
    const response = await rest('/rpc/daily_mileage', {
      method: 'POST',
      token: mintAccessToken(world.users.puneMr),
      body: { p_from: '2026-01-01', p_to: '2026-12-31' },
    });
    expect(response.status).toBe(200);
    const rows = response.body as unknown[];
    expect(Array.isArray(rows)).toBe(true);
    // The fixtures give puneMr check-ins, so this is a positive control rather than a
    // vacuous pass: an empty array here would mean the scoping or the join is broken.
    expect(rows.length).toBeGreaterThan(0);
    const day = fromMileageRow(rows[0]);
    expect(day.mrId).toBe(world.users.puneMr.id);
    expect(day.distanceMetres).toBeGreaterThanOrEqual(0);
  });

  it('discloses nothing about another MR', async () => {
    const response = await rest('/rpc/daily_mileage', {
      method: 'POST',
      token: mintAccessToken(world.users.puneMr),
      body: { p_from: '2026-01-01', p_to: '2026-12-31', p_mr_id: world.users.southMr.id },
    });
    const rows = response.body as unknown[];
    expect(rows).toHaveLength(0);
  });
});
