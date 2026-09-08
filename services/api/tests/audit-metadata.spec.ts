import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { requireDatabase, withClient } from './db.js';
import { mintAccessToken, rest } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * MR-02 A3 — can a caller control their own audit metadata?
 *
 * MR-01 A4 established that `current_request_id()` and `current_client_ip()` swallow
 * exceptions while populating `audit_log.request_id` and `ip_address`, and that the audit
 * row is written regardless. The follow-up question is the one that matters: **headers are
 * caller-controlled**, so can a caller make those two columns say what they want?
 *
 * Done over real HTTP through Kong and PostgREST, because the header bag only exists on
 * that path — the direct-Postgres connection the rest of this suite uses has no
 * `request.headers` GUC at all, so a test on the fast path would answer a different
 * question and answer it reassuringly.
 *
 * Not fixed here. The prompt says register at the right severity, and the right severity
 * depends on what the experiment says rather than on what the source suggests.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

const tokenForMr = (): string =>
  mintAccessToken({
    id: world.users.puneMr.id,
    role: world.users.puneMr.role,
    territoryId: world.users.puneMr.territoryId,
    isActive: true,
  });

interface AuditRow {
  actor_id: string | null;
  request_id: string | null;
  ip_address: string | null;
  action: string;
  table_name: string;
}

/** The audit row for one visit id. `audit_log` is read as owner: RLS forced, no policies. */
const auditFor = async (rowId: string): Promise<AuditRow[]> =>
  withClient(async (client) => {
    const result = await client.query<AuditRow>(
      `select actor_id, request_id, host(ip_address) as ip_address, action::text as action,
              table_name
         from public.audit_log
        where table_name = 'visits' and row_id = $1
        order by occurred_at desc`,
      [rowId],
    );
    return result.rows;
  });

/** Creates a visit over HTTP with the given headers, returning its id. */
const createVisitWithHeaders = async (
  headers: Record<string, string>,
): Promise<{ status: number; id: string }> => {
  const id = randomUUID();
  const response = await rest('/visits', {
    method: 'POST',
    token: tokenForMr(),
    headers,
    body: { id, doctor_id: world.doctors.pune },
  });
  return { status: response.status, id };
};

describe.skipIf(!reachable)('audit metadata under caller-controlled headers', () => {
  it('a normal request records an actor and an address', async () => {
    // The baseline, and the positive control for everything below: without it, a later
    // "the address was not blank" would also be true of a test that audited nothing.
    const { status, id } = await createVisitWithHeaders({});
    expect(status).toBeLessThan(300);

    const rows = await auditFor(id);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.actor_id).toBe(world.users.puneMr.id);
    expect(rows[0]?.ip_address).not.toBeNull();
  }, 30_000);

  it('a MALFORMED x-forwarded-for does NOT blank the address', async () => {
    // The question as posed. `current_client_ip()` catches `when others` and returns
    // `inet_client_addr()`, so a value that fails the `::inet` cast falls back to the
    // connection address -- which is STRONGER evidence than the header, not weaker.
    const { status, id } = await createVisitWithHeaders({
      'x-forwarded-for': 'not-an-ip-address-at-all',
    });
    expect(status).toBeLessThan(300);

    const rows = await auditFor(id);
    expect(rows[0]?.ip_address).not.toBeNull();
  }, 30_000);

  it('THE REAL VECTOR: a WELL-FORMED x-forwarded-for is recorded verbatim', async () => {
    // Not nulling -- spoofing. `current_client_ip()` takes `split_part(…, ',', 1)`, the
    // FIRST entry, which is the one the client supplies; a proxy appends rather than
    // prepends. So a caller who sends a plausible address has it written into the audit
    // log as the address they came from.
    //
    // 203.0.113.0/24 is TEST-NET-3, reserved for documentation, so it cannot collide with
    // a real address anybody might be investigating.
    const spoofed = '203.0.113.9';
    const { status, id } = await createVisitWithHeaders({ 'x-forwarded-for': spoofed });
    expect(status).toBeLessThan(300);

    const rows = await auditFor(id);
    expect(rows[0]?.ip_address).toBe(spoofed);
  }, 30_000);

  it('and x-request-id is written verbatim too', async () => {
    const forged = `forged-${randomUUID()}`;
    const { status, id } = await createVisitWithHeaders({ 'x-request-id': forged });
    expect(status).toBeLessThan(300);

    const rows = await auditFor(id);
    expect(rows[0]?.request_id).toBe(forged);
  }, 30_000);

  it('but the columns that say WHO and WHAT are not caller-controlled', async () => {
    // The bound that decides the severity. `actor_id` comes from `auth.uid()`, which comes
    // from the verified JWT, and `action`/`table_name` come from `tg_op` and
    // `tg_table_name`. No header reaches any of them, so a spoofed address sits beside a
    // correct identity rather than replacing it.
    const { id } = await createVisitWithHeaders({
      'x-forwarded-for': '203.0.113.200',
      'x-request-id': 'forged-identity-attempt',
    });
    const rows = await auditFor(id);
    expect(rows[0]?.actor_id).toBe(world.users.puneMr.id);
    expect(rows[0]?.action).toBe('insert');
    expect(rows[0]?.table_name).toBe('visits');
  }, 30_000);
});
