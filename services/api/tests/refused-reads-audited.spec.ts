import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { ANON_KEY, API_URL, mintAccessToken } from './auth.js';
import { inRolledBackTransaction, requireDatabase, withClient } from './db.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * MR-54 `BE-W102` — a refused read reaches the trail.
 *
 * MR-40 B found that a read which refuses writes nothing: the refusal raises, the raise
 * aborts the transaction, and the audit row goes with it. **For an audit trail a failed
 * attempt is usually more interesting than a successful one** — a successful read is
 * somebody doing their job; a hundred refused ones is somebody finding out what they can
 * reach.
 *
 * **These tests go over real HTTP and are not in a rolled-back transaction**, because the
 * whole property is that the transaction COMMITS. A test inside `inRolledBackTransaction`
 * could not tell the fix from the defect: both would show an empty table at the end. The
 * rows they write are therefore real, and are found again by the actor id they were written
 * with.
 */
const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

interface Body {
  code?: string;
  message?: string;
  hint?: string;
  details?: unknown;
}

const callAs = async (
  user: FixtureUser,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ status: number; body: Body }> => {
  const token = mintAccessToken(user);
  const response = await fetch(`${API_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  return { status: response.status, body: (await response.json()) as Body };
};

interface AuditRow {
  refused: boolean;
  table_name: string;
  reason: string;
  actor_id: string;
}

const refusalsFor = async (client: Client, actorId: string): Promise<AuditRow[]> => {
  const { rows } = await client.query<AuditRow>(
    `select refused, table_name, reason, actor_id
       from public.audit_log
      where actor_id = $1 and refused
      order by id desc`,
    [actorId],
  );
  return rows;
};

describe.skipIf(!reachable)('BE-W102 — a refused read is recorded, and still refused', () => {
  it('an MR refused the audit log leaves a row naming them, and gets 403 with 42501', async () => {
    const mr = world.users.puneMr;
    const before = await withClient((client) => refusalsFor(client, mr.id));

    const { status, body } = await callAs(mr, 'list_audit_log', { p_reason: 'probing' });

    // Still refused — recording the attempt must not serve the data. A version that
    // audited and then returned the trail would be strictly worse than the defect.
    expect(status).toBe(403);
    expect(body.code).toBe('42501');
    expect(body.message).toMatch(/only an admin may read the audit log/u);
    // The envelope is PostgREST's own shape, reproduced: a client keying off `code` cannot
    // tell this from the raise it replaced.
    expect(Object.keys(body).sort()).toEqual(['code', 'details', 'hint', 'message']);

    const after = await withClient((client) => refusalsFor(client, mr.id));
    expect(after.length, 'the refusal must survive the refused request').toBe(before.length + 1);
    expect(after[0]?.refused).toBe(true);
    expect(after[0]?.table_name).toBe('audit_log');
    expect(after[0]?.reason).toMatch(/only an admin may read the audit log/u);
  });

  it('retention_status refuses an MR and records it against the recordings it protects', async () => {
    const mr = world.users.puneMr;
    const before = await withClient((client) => refusalsFor(client, mr.id));

    const { status, body } = await callAs(mr, 'retention_status', { p_reason: 'probing' });
    expect(status).toBe(403);
    expect(body.code).toBe('42501');

    const after = await withClient((client) => refusalsFor(client, mr.id));
    expect(after.length).toBe(before.length + 1);
    expect(after[0]?.table_name).toBe('recordings');
  });

  it('POSITIVE CONTROL: an admin is served, and their row is NOT marked refused', async () => {
    // Without this the tests above would pass against a function that refused everybody and
    // marked every row refused.
    const admin = world.users.admin;
    const { status } = await callAs(admin, 'list_audit_log', { p_reason: 'the weekly review' });
    expect(status).toBe(200);

    const rows = await withClient((client) =>
      client.query<{ refused: boolean }>(
        `select refused from public.audit_log
          where actor_id = $1 and table_name = 'audit_log' order by id desc limit 1`,
        [admin.id],
      ),
    );
    expect(rows.rows[0]?.refused).toBe(false);
  });
});

describe.skipIf(!reachable)('BE-W102 — the panel’s heading stays true', () => {
  it('refused rows are excluded from list_audit_log unless asked for', async () => {
    const admin = world.users.admin;
    // Make sure at least one refusal exists to be excluded.
    await callAs(world.users.puneMr, 'list_audit_log', { p_reason: 'probing' });

    const shown = await callAs(admin, 'list_audit_log', {
      p_reason: 'default page',
      p_limit: 500,
    });
    const rows = (shown.body as unknown as { data: { refused: boolean }[] }).data;
    expect(rows.length, 'the page must not be empty, or this proves nothing').toBeGreaterThan(0);
    expect(
      rows.some((row) => row.refused),
      'a refusal in the default page would make "Successful reads" a false heading',
    ).toBe(false);

    const withRefused = await callAs(admin, 'list_audit_log', {
      p_reason: 'including refusals',
      p_limit: 500,
      p_include_refused: true,
    });
    const all = (withRefused.body as unknown as { data: { refused: boolean }[] }).data;
    expect(
      all.some((row) => row.refused),
      'asking for them must return them',
    ).toBe(true);
  });
});

describe.skipIf(!reachable)('BE-W102 — what is deliberately NOT recorded', () => {
  it('an unauthenticated call writes nothing, so anon cannot grow an append-only table', async () => {
    const before = await withClient((client) =>
      client.query<{ count: string }>('select count(*)::text as count from public.audit_log'),
    );

    const response = await fetch(`${API_URL}/rest/v1/rpc/retention_status`, {
      method: 'POST',
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_reason: 'anonymous probe' }),
    });
    expect(response.ok).toBe(false);

    const after = await withClient((client) =>
      client.query<{ count: string }>('select count(*)::text as count from public.audit_log'),
    );
    // One row per anonymous request would be a write amplification vector on a table with a
    // rejection trigger and no delete path.
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it('an in-database caller still gets an exception, so nothing internal changed', async () => {
    // The reason no existing test or internal caller had to change: `request.method` is null
    // off the HTTP path, and `refuse_read` raises there exactly as the code it replaced did.
    await inRolledBackTransaction(async (client) => {
      await client.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({ sub: world.users.puneMr.id, role: 'authenticated', app_role: 'mr' }),
      ]);
      await client.query('set local role authenticated');
      await expect(
        client.query('select public.list_audit_log($1, $2, $3)', [10, null, 'probing']),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});
