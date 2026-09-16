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

  // `it.fails` states the CORRECT property and records that it does not currently hold.
  //
  // Not `expect(...).toBe(theWrongThing)`: a characterisation test that asserts the defect
  // reads as approval of it, and the next person to fix the function would have to delete an
  // assertion that looks deliberate. This way the property is written down as it should be,
  // CI stays green on a known-open defect, and **the moment somebody closes the escape these
  // two turn red** — because `it.fails` fails when the test passes — which forces the fixer
  // to come here and invert them on purpose.
  //
  // REGISTERED AS `BE-W101`. Do not "fix" these tests; fix the function.
  it.fails('read_consent_record: an admin of A must NOT read B’s record by id', async () => {
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

  it.fails('an admin of organisation A must NOT see organisation B’s consent record', async () => {
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
