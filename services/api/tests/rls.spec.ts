import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client, QueryResult } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import {
  ANON_KEY,
  SERVICE_ROLE_KEY,
  asDatabaseRole,
  asUser,
  buildAppClaims,
  mintAccessToken,
  rest,
  signIn,
} from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * Gate 0 — the adversarial suite.
 *
 * Pass criterion is docs/amendment-gate0-criterion.md, NOT the original
 * "permission denied, not an empty result" wording:
 *
 *   1. Every scope test goes direct to Postgres or PostgREST with the user's own
 *      identity. No application code in the path.
 *   2. The property is NON-DISCLOSURE and NON-MUTATION. 403, `200 []` and
 *      "0 rows affected" are all acceptable. A returned or changed out-of-scope row
 *      is not.
 *   3. Where there is no grant at all, it must error rather than return empty.
 *   4. No application-layer scope filtering may exist.
 *
 * The first describe block is aimed at this suite rather than at the policies. Both
 * defects found in the BE-W1 review were in the harness, and a green adversarial
 * suite that cannot fail is worth less than no suite.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

// --- helpers -----------------------------------------------------------------

/** Fast path: run SQL as a real user, subject to RLS, then roll everything back. */
const asUserQuery = async <T extends Record<string, unknown>>(
  user: FixtureUser,
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> =>
  inRolledBackTransaction(async (client) => {
    await asUser(client, user);
    return client.query<T>(sql, params);
  });

const asRoleQuery = async <T extends Record<string, unknown>>(
  role: 'authenticated' | 'anon' | 'service_role',
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> =>
  inRolledBackTransaction(async (client) => {
    await asDatabaseRole(client, role);
    return client.query<T>(sql, params);
  });

/** Faithful path: real PostgREST, real JWT verification. */
const asUserRest = async (
  user: FixtureUser,
  path: string,
  options: Parameters<typeof rest>[1] = {},
): ReturnType<typeof rest> => rest(path, { ...options, token: mintAccessToken(user) });

const rowCount = (result: QueryResult<Record<string, unknown>>): number => result.rows.length;

// =============================================================================
// 0. The suite's own guard rails
// =============================================================================

describe.skipIf(!reachable)('harness fidelity — can these tests fail?', () => {
  it('confirms the plain test connection DOES bypass RLS', async () => {
    // This is why asUser() exists. `postgres` is not a superuser in Supabase but it
    // holds BYPASSRLS, so RLS is never evaluated for it. Any scope assertion written
    // against this connection would pass regardless of the policies.
    const result = await inRolledBackTransaction((client: Client) =>
      client.query<{ rolbypassrls: boolean }>(
        `select rolbypassrls from pg_roles where rolname = current_user`,
      ),
    );
    expect(result.rows[0]?.rolbypassrls).toBe(true);
  });

  it('confirms SET ROLE authenticated genuinely subjects the session to RLS', async () => {
    const asPostgres = await inRolledBackTransaction((client: Client) =>
      client.query<{ id: string }>('select id from public.visits'),
    );
    const asMr = await asUserQuery(world.users.puneMr, 'select id from public.visits');

    // The whole fast path rests on this inequality. If these two ever match, every
    // scope assertion below is vacuous.
    expect(rowCount(asPostgres)).toBeGreaterThan(rowCount(asMr));
  });

  it('positive control — an MR can read their OWN visit', async () => {
    const result = await asUserQuery(
      world.users.puneMr,
      'select id from public.visits where id = $1',
      [world.visits.pune],
    );
    expect(rowCount(result)).toBe(1);
  });

  it('positive control — a minted JWT is accepted by PostgREST', async () => {
    const response = await asUserRest(world.users.puneMr, `/visits?id=eq.${world.visits.pune}`);
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
  });

  it('claims fidelity — real GoTrue claims match the ones the fast path builds', async () => {
    const user = world.users.puneMr;
    const { claims } = await signIn(user.email, user.password);
    const expected = buildAppClaims(user);

    // If the auth hook ever changes shape, this one test fails loudly rather than
    // the whole suite quietly proving a fiction it invented.
    expect({
      app_role: claims['app_role'],
      app_is_active: claims['app_is_active'],
      app_territory_id: claims['app_territory_id'],
    }).toEqual({
      app_role: expected.app_role,
      app_is_active: expected.app_is_active,
      app_territory_id: expected.app_territory_id,
    });
    expect(claims['sub']).toBe(user.id);
  });

  it('claims fidelity — a real GoTrue token and a minted token agree on scope', async () => {
    const user = world.users.puneMr;
    const { accessToken } = await signIn(user.email, user.password);

    const withRealToken = await rest('/visits?select=id', { token: accessToken });
    const withMintedToken = await asUserRest(user, '/visits?select=id');

    expect(withRealToken.status).toBe(200);
    expect(withMintedToken.status).toBe(200);
    expect(withRealToken.body).toEqual(withMintedToken.body);
  });
});

// =============================================================================
// 1. An MR reaching for another MR's data, five ways
// =============================================================================

describe.skipIf(!reachable)('mr -> another mr: visits', () => {
  it('path 1 — REST endpoint', async () => {
    const response = await asUserRest(
      world.users.puneMr,
      `/visits?id=eq.${world.visits.south}&select=id`,
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('path 2 — direct SQL with their own identity', async () => {
    const result = await asUserQuery(
      world.users.puneMr,
      'select id from public.visits where id = $1',
      [world.visits.south],
    );
    expect(rowCount(result)).toBe(0);
  });

  it('path 3 — joined from a table they legitimately can read', async () => {
    const result = await asUserQuery(
      world.users.puneMr,
      `select v.id
         from public.doctors d
         join public.visits v on v.doctor_id = d.id
        where v.mr_id = $1`,
      [world.users.southMr.id],
    );
    expect(rowCount(result)).toBe(0);
  });

  it('path 4 — through a Postgres function', async () => {
    const result = await asUserQuery<{ data: unknown }>(
      world.users.puneMr,
      `select public.list_analyses($1) -> 'data' as data`,
      [world.users.southMr.id],
    );
    expect(result.rows[0]?.data).toEqual([]);
  });

  it('path 5 — through the visit_summary view', async () => {
    const result = await asUserQuery(
      world.users.puneMr,
      'select visit_id from public.visit_summary where visit_id = $1',
      [world.visits.south],
    );
    expect(rowCount(result)).toBe(0);
  });

  it('and the view is not a hole in the other direction either', async () => {
    const own = await asUserQuery(
      world.users.puneMr,
      'select visit_id from public.visit_summary where visit_id = $1',
      [world.visits.pune],
    );
    expect(rowCount(own)).toBe(1);
  });
});

describe.skipIf(!reachable)('mr -> another mr: check-ins, call reports, samples', () => {
  it('cannot read another MR check-in over REST', async () => {
    const response = await asUserRest(
      world.users.puneMr,
      `/check_ins?id=eq.${world.checkIns.south}&select=id`,
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('cannot read another MR check-in in SQL', async () => {
    const result = await asUserQuery(
      world.users.puneMr,
      'select id from public.check_ins where id = $1',
      [world.checkIns.south],
    );
    expect(rowCount(result)).toBe(0);
  });

  it('cannot reach another MR check-in by joining through visits', async () => {
    const result = await asUserQuery(
      world.users.puneMr,
      `select c.id from public.check_ins c join public.visits v on v.id = c.visit_id
        where v.mr_id = $1`,
      [world.users.southMr.id],
    );
    expect(rowCount(result)).toBe(0);
  });

  it('cannot read another MR call report over REST', async () => {
    const response = await asUserRest(
      world.users.puneMr,
      `/call_reports?id=eq.${world.callReports.south}&select=id`,
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('cannot read another MR call report in SQL', async () => {
    const result = await asUserQuery(
      world.users.puneMr,
      'select id from public.call_reports where id = $1',
      [world.callReports.south],
    );
    expect(rowCount(result)).toBe(0);
  });

  it('cannot approve another MR call report through the approval function', async () => {
    await expect(
      asUserQuery(world.users.puneMr, 'select public.approve_call_report($1, true, $2)', [
        world.callReports.south,
        'attempted by an unrelated mr',
      ]),
    ).rejects.toThrow(/only a field_manager or admin/);
  });

  it('cannot approve their OWN call report even as a manager path', async () => {
    await expect(
      asUserQuery(world.users.westManager, 'select public.approve_call_report($1, true, $2)', [
        world.callReports.south,
        'outside my team',
      ]),
    ).rejects.toThrow(/not in your scope/);
  });

  it('positive control — an MR reads their own check-in and call report', async () => {
    const checkIn = await asUserQuery(
      world.users.puneMr,
      'select id from public.check_ins where id = $1',
      [world.checkIns.pune],
    );
    const callReport = await asUserQuery(
      world.users.puneMr,
      'select id from public.call_reports where id = $1',
      [world.callReports.pune],
    );
    expect(rowCount(checkIn)).toBe(1);
    expect(rowCount(callReport)).toBe(1);
  });
});

// =============================================================================
// 2. Analyses — no grant at all, so this must ERROR, not return empty
// =============================================================================

describe.skipIf(!reachable)('analyses are unreachable except through the logged read path', () => {
  it('direct SELECT on analyses is permission denied for an MR (criterion 3)', async () => {
    await expect(asUserQuery(world.users.puneMr, 'select id from public.analyses')).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('direct SELECT on analyses is permission denied for a manager', async () => {
    await expect(
      asUserQuery(world.users.westManager, 'select id from public.analyses'),
    ).rejects.toThrow(/permission denied/i);
  });

  it('direct SELECT on analyses is permission denied for an admin', async () => {
    await expect(asUserQuery(world.users.admin, 'select id from public.analyses')).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('REST exposes no analyses table to an MR', async () => {
    const response = await asUserRest(world.users.puneMr, '/analyses?select=id');
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('read_analysis discloses nothing for another MR analysis', async () => {
    const result = await asUserQuery<{ data: unknown }>(
      world.users.puneMr,
      `select public.read_analysis($1) -> 'data' as data`,
      [world.analyses.south],
    );
    expect(result.rows[0]?.data).toBeNull();
  });

  it('positive control — read_analysis returns the MR their own analysis', async () => {
    const result = await asUserQuery<{ id: string | null }>(
      world.users.puneMr,
      `select public.read_analysis($1) -> 'data' ->> 'id' as id`,
      [world.analyses.pune],
    );
    expect(result.rows[0]?.id).toBe(world.analyses.pune);
  });

  it('an MR cannot attach a response to somebody else analysis', async () => {
    await expect(
      asUserQuery(world.users.puneMr, 'select public.respond_to_analysis($1, $2)', [
        world.analyses.south,
        'not mine',
      ]),
    ).rejects.toThrow(/is not yours/);
  });
});

// =============================================================================
// 3. A field manager reaching outside their own team
// =============================================================================

describe.skipIf(!reachable)('field_manager -> outside their team', () => {
  it('positive control — sees both MRs inside their subtree', async () => {
    const result = await asUserQuery(
      world.users.westManager,
      'select id from public.visits where mr_id = $1',
      [world.users.puneMr.id],
    );
    expect(rowCount(result)).toBe(1);
  });

  it('cannot read a visit belonging to another manager team, over REST', async () => {
    const response = await asUserRest(
      world.users.westManager,
      `/visits?id=eq.${world.visits.south}&select=id`,
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('cannot read that visit in SQL', async () => {
    const result = await asUserQuery(
      world.users.westManager,
      'select id from public.visits where id = $1',
      [world.visits.south],
    );
    expect(rowCount(result)).toBe(0);
  });

  it('cannot reach it by joining from doctors', async () => {
    const result = await asUserQuery(
      world.users.westManager,
      `select v.id from public.doctors d join public.visits v on v.doctor_id = d.id
        where d.territory_id = $1`,
      [world.territories.south],
    );
    expect(rowCount(result)).toBe(0);
  });

  it('cannot reach it through the view', async () => {
    const result = await asUserQuery(
      world.users.westManager,
      'select visit_id from public.visit_summary where visit_id = $1',
      [world.visits.south],
    );
    expect(rowCount(result)).toBe(0);
  });

  it('cannot reach another team analyses through list_analyses', async () => {
    const result = await asUserQuery<{ data: unknown[] }>(
      world.users.westManager,
      `select public.list_analyses() -> 'data' as data`,
    );
    const ids = (result.rows[0]?.data ?? []).map((row) => (row as { id: string }).id);
    expect(ids).toContain(world.analyses.pune);
    expect(ids).not.toContain(world.analyses.south);
  });

  it('cannot read a consent record captured outside their team', async () => {
    const result = await asUserQuery<{ data: unknown }>(
      world.users.westManager,
      `select public.read_consent_record($1) -> 'data' as data`,
      [world.consentRecords.south],
    );
    expect(result.rows[0]?.data).toBeNull();
  });
});

// =============================================================================
// 4. Doctors outside the caller's territory
// =============================================================================

describe.skipIf(!reachable)('doctors are bounded by territory', () => {
  it('positive control — an MR reads a doctor in their own territory', async () => {
    const result = await asUserQuery(
      world.users.puneMr,
      'select id from public.doctors where id = $1',
      [world.doctors.pune],
    );
    expect(rowCount(result)).toBe(1);
  });

  it('an MR cannot read a doctor outside their territory, in SQL', async () => {
    const result = await asUserQuery(
      world.users.puneMr,
      'select id from public.doctors where id = $1',
      [world.doctors.south],
    );
    expect(rowCount(result)).toBe(0);
  });

  it('an MR cannot read that doctor over REST', async () => {
    const response = await asUserRest(
      world.users.puneMr,
      `/doctors?id=eq.${world.doctors.south}&select=id`,
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('an MR cannot read that doctor clinic addresses either', async () => {
    const result = await asUserQuery(
      world.users.puneMr,
      'select id from public.clinic_addresses where id = $1',
      [world.clinicAddresses.south],
    );
    expect(rowCount(result)).toBe(0);
  });

  it('a manager sees doctors across their whole subtree and no further', async () => {
    const inside = await asUserQuery(
      world.users.westManager,
      'select id from public.doctors where id = $1',
      [world.doctors.pune],
    );
    const outside = await asUserQuery(
      world.users.westManager,
      'select id from public.doctors where id = $1',
      [world.doctors.south],
    );
    expect(rowCount(inside)).toBe(1);
    expect(rowCount(outside)).toBe(0);
  });
});

// =============================================================================
// 5. The consent ledger is immutable, for everyone
// =============================================================================

describe.skipIf(!reachable)('consent_records is append-only', () => {
  it('rejects UPDATE from an authenticated MR', async () => {
    await expect(
      asUserQuery(world.users.puneMr, `update public.consent_records set outcome = 'declined'`),
    ).rejects.toThrow();
  });

  it('rejects UPDATE from an admin', async () => {
    await expect(
      asUserQuery(world.users.admin, `update public.consent_records set outcome = 'declined'`),
    ).rejects.toThrow();
  });

  // Two independent layers, tested separately so a regression in either is visible.
  //
  //   Layer 1 — grants. UPDATE/DELETE/TRUNCATE are revoked from service_role, so it
  //             never reaches the trigger.
  //   Layer 2 — the statement-level trigger. This is the layer that matters, because
  //             service_role and postgres both hold BYPASSRLS and RLS policies are
  //             never evaluated for them.

  it('layer 1 — service_role is stopped at the grant, before the trigger', async () => {
    await expect(
      asRoleQuery('service_role', `update public.consent_records set outcome = 'declined'`),
    ).rejects.toThrow(/permission denied/i);
  });

  it('layer 2 — the trigger still refuses service_role if the grant is restored', async () => {
    // Grant it the privilege inside the transaction, so the only thing left standing
    // between service_role and the ledger is the trigger. The grant is rolled back
    // with everything else.
    await expect(
      inRolledBackTransaction(async (client: Client) => {
        await client.query('grant update, delete on public.consent_records to service_role');
        await asDatabaseRole(client, 'service_role');
        return client.query(`update public.consent_records set outcome = 'declined'`);
      }),
    ).rejects.toThrow(/append-only/);
  });

  it('layer 2 — the trigger refuses the table owner, which holds BYPASSRLS', async () => {
    await expect(
      inRolledBackTransaction((client: Client) =>
        client.query(`update public.consent_records set outcome = 'declined'`),
      ),
    ).rejects.toThrow(/append-only/);
  });

  it('rejects an UPDATE that matches no rows — statement-level, not row-level', async () => {
    // A row-level trigger never fires for a zero-row UPDATE, so this would report
    // "0 rows affected" and read as success. That is the bug this test exists for.
    await expect(
      inRolledBackTransaction((client: Client) =>
        client.query(
          `update public.consent_records set outcome = 'declined'
            where id = '00000000-0000-4000-8000-0000000000ff'`,
        ),
      ),
    ).rejects.toThrow(/append-only/);
  });

  it('rejects DELETE from the owner and from service_role', async () => {
    await expect(
      inRolledBackTransaction((client: Client) =>
        client.query('delete from public.consent_records'),
      ),
    ).rejects.toThrow(/append-only/);
    await expect(asRoleQuery('service_role', 'delete from public.consent_records')).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('rejects TRUNCATE from the owner and from service_role', async () => {
    // Since BE-W6 `recordings` references this table, so the foreign key refuses
    // the truncate before the trigger is reached. Either refusal is the property.
    await expect(
      inRolledBackTransaction((client: Client) => client.query('truncate public.consent_records')),
    ).rejects.toThrow(/append-only|cannot truncate a table referenced/);
    await expect(asRoleQuery('service_role', 'truncate public.consent_records')).rejects.toThrow();
  });

  it('rejects rewriting the consent text a record points at', async () => {
    await expect(
      inRolledBackTransaction((client: Client) =>
        client.query(
          `update public.consent_text_versions set full_text = 'rewritten' where id = $1`,
          [world.consentTextVersionId],
        ),
      ),
    ).rejects.toThrow(/immutable/);
  });

  it('records a withdrawal as a new row and leaves the original untouched', async () => {
    await inRolledBackTransaction(async (client: Client) => {
      const withdrawalId = '00000000-0000-4000-8000-00000000dead';
      await client.query(
        `insert into public.consent_records
           (id, visit_id, doctor_id, captured_by_mr_id, outcome, consent_text_version_id,
            displayed_language, supersedes_consent_record_id, is_withdrawal, captured_at)
         values ($1, $2, $3, $4, 'declined', $5, 'en-IN', $6, true, now())`,
        [
          withdrawalId,
          world.visits.pune,
          world.doctors.pune,
          world.users.puneMr.id,
          world.consentTextVersionId,
          world.consentRecords.pune,
        ],
      );

      const original = await client.query<{ outcome: string }>(
        'select outcome from public.consent_records where id = $1',
        [world.consentRecords.pune],
      );
      expect(original.rows[0]?.outcome).toBe('consented');
    });
  });

  it('refuses a withdrawal of a consent that was never granted', async () => {
    await expect(
      inRolledBackTransaction(async (client: Client) => {
        const declinedId = '00000000-0000-4000-8000-00000000d001';
        await client.query(
          `insert into public.consent_records
             (id, visit_id, doctor_id, captured_by_mr_id, outcome, consent_text_version_id,
              displayed_language, captured_at)
           values ($1, $2, $3, $4, 'declined', $5, 'en-IN', now())`,
          [
            declinedId,
            world.visits.pune,
            world.doctors.pune,
            world.users.puneMr.id,
            world.consentTextVersionId,
          ],
        );
        await client.query(
          `insert into public.consent_records
             (id, visit_id, doctor_id, captured_by_mr_id, outcome, consent_text_version_id,
              displayed_language, supersedes_consent_record_id, is_withdrawal, captured_at)
           values ('00000000-0000-4000-8000-00000000d002', $1, $2, $3, 'declined', $4, 'en-IN', $5, true, now())`,
          [
            world.visits.pune,
            world.doctors.pune,
            world.users.puneMr.id,
            world.consentTextVersionId,
            declinedId,
          ],
        );
      }),
    ).rejects.toThrow(/only a granted consent can be withdrawn/);
  });

  it('carries no penalty, flag or score column', async () => {
    const result = await inRolledBackTransaction((client: Client) =>
      client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'consent_records'`,
      ),
    );
    const columns = result.rows.map((row) => row.column_name);
    for (const forbidden of ['penalty', 'flagged', 'score', 'rating', 'compliant', 'is_failure']) {
      expect(columns).not.toContain(forbidden);
    }
  });
});

// =============================================================================
// 6. The audit log is append-only, for everyone
// =============================================================================

describe.skipIf(!reachable)('audit_log is append-only', () => {
  it('layer 1 — service_role is stopped at the grant', async () => {
    await expect(
      asRoleQuery('service_role', `update public.audit_log set reason = 'tampered'`),
    ).rejects.toThrow(/permission denied/i);
    await expect(asRoleQuery('service_role', 'delete from public.audit_log')).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('layer 2 — the trigger still refuses service_role if the grant is restored', async () => {
    await expect(
      inRolledBackTransaction(async (client: Client) => {
        await client.query('grant update, delete on public.audit_log to service_role');
        await asDatabaseRole(client, 'service_role');
        return client.query(`update public.audit_log set reason = 'tampered'`);
      }),
    ).rejects.toThrow(/append-only/);
  });

  it('layer 2 — the trigger refuses the owning role, which holds BYPASSRLS', async () => {
    await expect(
      inRolledBackTransaction((client: Client) =>
        client.query(`update public.audit_log set reason = 'tampered'`),
      ),
    ).rejects.toThrow(/append-only/);
  });

  it('rejects DELETE from the owning role', async () => {
    await expect(
      inRolledBackTransaction((client: Client) => client.query('delete from public.audit_log')),
    ).rejects.toThrow(/append-only/);
  });

  it('rejects a zero-row UPDATE as well', async () => {
    await expect(
      inRolledBackTransaction((client: Client) =>
        client.query(`update public.audit_log set reason = 'x' where id = -1`),
      ),
    ).rejects.toThrow(/append-only/);
  });

  it('is not readable or writable by authenticated at all', async () => {
    await expect(asUserQuery(world.users.admin, 'select id from public.audit_log')).rejects.toThrow(
      /permission denied/i,
    );
    await expect(
      asUserQuery(
        world.users.admin,
        `insert into public.audit_log (action, table_name) values ('select','x')`,
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('is written by a trigger, not by the caller', async () => {
    await inRolledBackTransaction(async (client: Client) => {
      // Scoped to THIS row rather than counting every audited visit.
      //
      // A global count is a cross-file race: other spec files commit visits, and one
      // landing between the two counts breaks this with an off-by-one that looks
      // like a trigger bug. It was latent from BE-W2 and became roughly a one-in-ten
      // failure when BE-W7 added three more spec files that commit visits.
      const visitId = randomUUID();
      const auditedRows = async (): Promise<number> => {
        const result = await client.query<{ count: string }>(
          `select count(*) as count from public.audit_log
            where table_name = 'visits' and row_id = $1`,
          [visitId],
        );
        return Number(result.rows[0]?.count);
      };

      expect(await auditedRows()).toBe(0);
      await client.query(
        `insert into public.visits (id, mr_id, doctor_id, status) values ($1, $2, $3, 'planned')`,
        [visitId, world.users.puneMr.id, world.doctors.pune],
      );
      expect(await auditedRows()).toBe(1);
    });
  });
});

// =============================================================================
// 7. Admin reads of an analysis are logged BEFORE the data is returned
// =============================================================================

describe.skipIf(!reachable)('admin analysis access is audited before disclosure', () => {
  it('requires a reason', async () => {
    await expect(
      asUserQuery(world.users.admin, 'select public.read_analysis($1)', [world.analyses.pune]),
    ).rejects.toThrow(/requires a reason/);
  });

  it('writes the audit row before the data is returned — measured, not assumed', async () => {
    await inRolledBackTransaction(async (client: Client) => {
      await asUser(client, world.users.admin);

      const call = await client.query<{
        payload: { readAt: string; auditLogId: number; data: unknown };
      }>('select public.read_analysis($1, $2) as payload', [
        world.analyses.pune,
        'gate 0 verification',
      ]);
      const payload = call.rows[0]?.payload;
      expect(payload).toBeDefined();
      expect(payload?.data).not.toBeNull();

      // Back to a role that can read audit_log.
      await client.query('reset role');
      const audit = await client.query<{ occurred_at: string; action: string; reason: string }>(
        'select occurred_at, action, reason from public.audit_log where id = $1',
        [payload?.auditLogId],
      );

      const auditAt = new Date(audit.rows[0]?.occurred_at ?? 0).getTime();
      const readAt = new Date(payload?.readAt ?? 0).getTime();

      expect(audit.rows[0]?.action).toBe('select');
      expect(audit.rows[0]?.reason).toBe('gate 0 verification');
      expect(auditAt).toBeLessThanOrEqual(readAt);
    });
  });

  it('logs the read even when the analysis is out of the caller scope', async () => {
    await inRolledBackTransaction(async (client: Client) => {
      await asUser(client, world.users.puneMr);
      const call = await client.query<{ payload: { auditLogId: number; data: unknown } }>(
        'select public.read_analysis($1) as payload',
        [world.analyses.south],
      );
      expect(call.rows[0]?.payload.data).toBeNull();

      await client.query('reset role');
      const audit = await client.query<{ row_id: string; actor_id: string }>(
        'select row_id, actor_id from public.audit_log where id = $1',
        [call.rows[0]?.payload.auditLogId],
      );
      // An attempt is worth logging. This is the row that shows someone went looking.
      expect(audit.rows[0]?.row_id).toBe(world.analyses.south);
      expect(audit.rows[0]?.actor_id).toBe(world.users.puneMr.id);
    });
  });

  it('discloses nothing if the audit insert cannot happen', async () => {
    // Structural, not incidental: the audit insert is the first statement in the
    // function, so an exception there aborts before any row is fetched. A missing
    // reason is the reachable way to prove it — the function raises and returns
    // nothing at all rather than returning data with no audit row.
    await expect(
      asUserQuery(world.users.admin, 'select public.read_analysis($1) as payload', [
        world.analyses.south,
      ]),
    ).rejects.toThrow(/requires a reason/);
  });
});

// =============================================================================
// 8. Structural invariants — the next table cannot quietly skip the boundary
// =============================================================================

describe.skipIf(!reachable)('structural invariants', () => {
  it('every table in public has RLS enabled AND forced', async () => {
    const result = await inRolledBackTransaction((client: Client) =>
      client.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `select c.relname, c.relrowsecurity, c.relforcerowsecurity
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'
            and (c.relrowsecurity = false or c.relforcerowsecurity = false)`,
      ),
    );
    expect(result.rows.map((row) => row.relname)).toEqual([]);
  });

  it('every view in public is security_invoker', async () => {
    // A view without this runs as its owner, which holds BYPASSRLS, and hands out
    // every row in the tables beneath it.
    const result = await inRolledBackTransaction((client: Client) =>
      client.query<{ relname: string }>(
        `select c.relname
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'v'
            and coalesce(
                  (select option_value from pg_options_to_table(c.reloptions)
                    where option_name = 'security_invoker'), 'false') <> 'true'`,
      ),
    );
    expect(result.rows.map((row) => row.relname)).toEqual([]);
  });

  it('every table carrying an mr_id has a SELECT policy bounded by visible_user_ids', async () => {
    // This is criterion 4 made mechanical: scope lives in policy, and a new table
    // with an owner column cannot ship without one.
    const result = await inRolledBackTransaction((client: Client) =>
      client.query<{ table_name: string }>(
        `select c.table_name
           from information_schema.columns c
           join information_schema.tables t
             on t.table_schema = c.table_schema and t.table_name = c.table_name
          where c.table_schema = 'public' and c.column_name = 'mr_id'
            -- Base tables only. Views carry mr_id too and are covered by the
            -- security_invoker invariant above, which is their equivalent.
            and t.table_type = 'BASE TABLE'
            and not exists (
              select 1 from pg_policies p
               where p.schemaname = 'public'
                 and p.tablename = c.table_name
                 and p.cmd in ('SELECT', 'ALL')
                 -- Either bound is scope-in-policy. The auth.uid() form is the
                 -- stricter of the two: upload_grants is an ephemeral capability
                 -- that not even a manager needs to see.
                 and (p.qual like '%visible_user_ids%' or p.qual like '%auth.uid()%')
            )
            -- analyses is exempt: it has no SELECT grant at all, so direct access
            -- is a permission denied and every read goes through a logged RPC.
            and c.table_name <> 'analyses'`,
      ),
    );
    expect(result.rows.map((row) => row.table_name)).toEqual([]);
  });

  it('grants no write privilege on any append-only table to authenticated', async () => {
    const result = await inRolledBackTransaction((client: Client) =>
      client.query<{ table_name: string; privilege_type: string }>(
        `select table_name, privilege_type from information_schema.role_table_grants
          where grantee in ('authenticated', 'anon')
            and table_schema = 'public'
            and table_name in ('audit_log', 'consent_records', 'consent_text_versions')
            and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')`,
      ),
    );
    expect(result.rows).toEqual([]);
  });

  it('leaves anon with nothing at all', async () => {
    const result = await inRolledBackTransaction((client: Client) =>
      client.query<{ table_name: string; privilege_type: string }>(
        `select table_name, privilege_type from information_schema.role_table_grants
          where grantee = 'anon' and table_schema = 'public'`,
      ),
    );
    expect(result.rows).toEqual([]);
  });

  it('an anonymous REST caller reads nothing', async () => {
    const response = await rest('/visits?select=id', { token: ANON_KEY });
    if (response.status === 200) {
      expect(response.body).toEqual([]);
    } else {
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
  });

  it('service_role over REST cannot mutate the ledger', async () => {
    // The grant layer answers first here, with 42501. The trigger behind it is
    // proved separately, with the grant restored, in the consent_records block.
    const response = await rest(`/consent_records?id=eq.${world.consentRecords.pune}`, {
      token: SERVICE_ROLE_KEY,
      method: 'PATCH',
      body: { outcome: 'declined' },
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.text).toMatch(/permission denied|append-only/);

    // And the row is untouched.
    const after = await inRolledBackTransaction((client: Client) =>
      client.query<{ outcome: string }>(
        'select outcome from public.consent_records where id = $1',
        [world.consentRecords.pune],
      ),
    );
    expect(after.rows[0]?.outcome).toBe('consented');
  });
});

// =============================================================================
// 9. Deactivation takes effect immediately, not at the next token refresh
// =============================================================================

describe.skipIf(!reachable)('deactivation is enforced by the profile, not the claim', () => {
  it('collapses scope the moment is_active flips, even with a valid token', async () => {
    await inRolledBackTransaction(async (client: Client) => {
      await client.query('update public.user_profiles set is_active = false where id = $1', [
        world.users.puneMr.id,
      ]);
      // The claims still say active: this is exactly the stale-token window.
      await asUser(client, world.users.puneMr);
      const result = await client.query<{ id: string }>('select id from public.visits');
      expect(rowCount(result)).toBe(0);
    });
  });
});
