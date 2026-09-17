import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * MR-40 A3 — does `list_consent_records`' admin escape cross the tenant boundary?
 *
 * **Why this was not already answered.** `BE-W76` scoped two things: `visible_user_ids()`, and
 * the six `*_admin_all` RLS policies. A function body whose admin branch bypasses
 * `visible_user_ids()` **entirely** is covered by neither —
 *
 * ```sql
 * where (v_role = 'admin' or c.captured_by_mr_id in (select public.visible_user_ids()))
 * ```
 *
 * — because the `or` short-circuits before the scoped half is evaluated, and `SECURITY DEFINER`
 * means no policy runs afterwards to catch it. `consent_records` is one of the nine tables with
 * RLS **forced and no policy**, so if the escape is open there is nothing behind it.
 *
 * `FIX-04`'s matrix did test this function — **before `BE-W76`**, when an admin's emptiness came
 * from territory scoping incidentally rather than from a tenant boundary deliberately. A test
 * that passed for a reason that has since been removed is not a test that still passes.
 *
 * So: measured directly, with a positive control, rather than reasoned about from the `where`
 * clause.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
});

const asUserTx = async <T>(user: FixtureUser, fn: (client: Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await asUser(client, user);
    return fn(client);
  });

/**
 * A consent record belonging to the RIVAL organisation, captured by its own MR.
 *
 * The rival tenant needs its OWN notice first. `seedFixtures` seeds `consent_text_versions`
 * only for the main organisation, and MR-07 / `BE-W79` made a notice belong to a tenant — so
 * capturing against the main org's notice raises *"no active consent text for language
 * en-IN"*. That refusal is the tenancy boundary working on the WRITE path, which is worth
 * noting before asking whether it holds on the read path.
 */
const rivalConsentRecord = async (client: Client, id: string): Promise<void> => {
  await client.query('reset role');
  const notice = randomUUID();
  await client.query(
    `insert into public.consent_text_versions
       (id, version_label, language, full_text, effective_from, organisation_id)
     values ($1, $2, 'en-IN', 'Rival tenant notice.', now() - interval '30 days', $3)`,
    [notice, `mr40-${notice.slice(0, 8)}`, world.rivalOrganisationId],
  );
  await client.query(
    `insert into public.consent_records
       (id, visit_id, doctor_id, captured_by_mr_id, outcome, consent_text_version_id,
        displayed_language, is_withdrawal, captured_at)
     values ($1, $2, $3, $4, 'consented', $5, 'en-IN', false, now())`,
    [id, world.visits.rival, world.doctors.rival, world.users.rivalMr.id, notice],
  );
};

const readConsent = async (client: Client): Promise<{ id: string }[]> => {
  const { rows } = await client.query<{ page: { data: { id: string }[] } }>(
    'select public.list_consent_records($1, $2) as page',
    [null, 'MR-40 A3 — tenant boundary probe'],
  );
  return rows[0]?.page.data ?? [];
};

describe.skipIf(!reachable)('MR-40 A3 — the admin escape in list_consent_records', () => {
  it('the rival record IS visible to the rival admin — the positive control', async () => {
    // Without this, the assertion below could pass because the row was never created, or
    // because the function returns nothing to anybody. This proves the target is reachable.
    await asUserTx(world.users.rivalAdmin, async (client) => {
      const id = randomUUID();
      await rivalConsentRecord(client, id);
      await asUser(client, world.users.rivalAdmin);

      const rows = await readConsent(client);
      expect(rows.some((row) => row.id === id)).toBe(true);
    });
  });

  // **These two were `it.fails` from MR-40 until MR-42 closed the escape, and the mechanism
  // worked exactly as designed.**
  //
  // They always stated the CORRECT property. `it.fails` recorded that it did not yet hold —
  // rather than `expect(...).toBe(theWrongThing)`, which reads as approval of the defect and
  // would have made the eventual fixer delete an assertion that looked deliberate. CI stayed
  // green on a known-open defect without hiding it, and the moment the function was fixed
  // these turned RED, because `it.fails` fails when the test passes. That red is what forced
  // this deliberate update.
  //
  // `BE-W101` is CLOSED by `20260917000100_close_the_admin_escape.sql`. They are ordinary
  // assertions now. Do not weaken them: they are the two sites that were proven open.
  it('read_consent_record: an admin of A must NOT read B’s record by id', async () => {
    // The single-row sibling, tested to establish whether the shape generalises rather than
    // inferring it from seven identical `where` clauses. Grep locates; it does not decide.
    await asUserTx(world.users.admin, async (client) => {
      const id = randomUUID();
      await rivalConsentRecord(client, id);
      await asUser(client, world.users.admin);

      const { rows } = await client.query<{ page: { data: { id: string } | null } }>(
        'select public.read_consent_record($1, $2) as page',
        [id, 'MR-40 A3 — tenant boundary probe'],
      );
      expect(rows[0]?.page.data).toBeNull();
    });
  });

  it('an admin of organisation A must NOT see organisation B’s consent record', async () => {
    await asUserTx(world.users.admin, async (client) => {
      const id = randomUUID();
      await rivalConsentRecord(client, id);
      await asUser(client, world.users.admin);

      const rows = await readConsent(client);
      // And the page is not simply empty — an absence means nothing if nothing was returned.
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((row) => row.id === id)).toBe(false);
    });
  });
});

/**
 * MR-42 A2/A5 — the boundary asserted over the whole POPULATION, not over a sample.
 *
 * The eight sites were found by matching one string. A ninth path — `approve_call_reports_bulk`
 * — carries no scoping of its own at all and never matched it; it is safe only because it
 * delegates per id to `approve_call_report`. **A string match cannot find the function nobody
 * has written yet**, which is the failure mode G-RLS-C had: its `function` path tested
 * `search_doctors` and nothing else, a sample of one where the catalogue holds 83.
 *
 * So this asks the catalogue instead, and it is the same assertion the migration makes about
 * itself at deploy time. Duplicated on purpose: the migration guard fails a DEPLOY, this fails
 * a BUILD, and the two catch the regression at different moments.
 */
describe.skipIf(!reachable)(
  'MR-42 — no SECURITY DEFINER body short-circuits the tenant scope',
  () => {
    const OFFENDERS = `select coalesce(string_agg(p.proname, ', ' order by p.proname), '') as offenders
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prosecdef
        and pg_get_functiondef(p.oid) like '%v_role = ''admin'' or%'`;

    it('finds none, across every SECURITY DEFINER function in public', async () => {
      await inRolledBackTransaction(async (client) => {
        const { rows } = await client.query<{ offenders: string }>(OFFENDERS);
        expect(rows[0]?.offenders).toBe('');
      });
    });

    it('and the query can SEE one — the positive control', async () => {
      // Without this, an empty result is indistinguishable from a query that matches nothing
      // ever: a typo in the LIKE pattern would make the assertion above pass for all time.
      // `visible_user_ids` uses `if v_role = 'admin' then`, which deliberately does NOT match,
      // so this control also proves the pattern is narrow enough to leave those two alone.
      await inRolledBackTransaction(async (client) => {
        await client.query('reset role');
        await client.query(`create function public.mr42_escape_probe() returns int
         language plpgsql security definer as $probe$
         declare v_role text; v_x boolean;
         begin v_x := (v_role = 'admin' or 1 = 1); return 1; end; $probe$`);

        const { rows } = await client.query<{ offenders: string }>(OFFENDERS);
        expect(rows[0]?.offenders).toContain('mr42_escape_probe');
        expect(rows[0]?.offenders).not.toContain('visible_user_ids');
      });
    });
  },
);
