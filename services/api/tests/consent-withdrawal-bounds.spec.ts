import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asDatabaseRole, asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * MR-05 Part C — what bounds a consent WITHDRAWAL, and what does not.
 *
 * BE-W74 routed a consent CAPTURE through `capture_consent`, so the FIX-02 and FIX-12
 * bounds now apply whichever way a capture arrives. A withdrawal deliberately still
 * inserts directly, because `capture_consent` takes neither `supersedes_consent_record_id`
 * nor `is_withdrawal` and forcing it through would make the common path carry the rare one.
 *
 * **That is right about the routing and says nothing about the bounds.** A withdrawal is
 * DPDP s.6(4): its effective moment is what decides whether everything processed between
 * the original consent and the withdrawal was lawful. So this file establishes what
 * actually guards it — investigation, not repair.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

/** A granted consent to withdraw, created through the validated path. */
const grantedConsent = async (client: Client): Promise<{ id: string; language: string }> => {
  const language = `zz-${randomUUID().slice(0, 8)}`;
  const version = randomUUID();
  await client.query(
    `insert into public.consent_text_versions
       (id, version_label, language, full_text, effective_from)
     values ($1, $2, $3, 'The notice.', now() - interval '30 days')`,
    [version, `mr05-${randomUUID().slice(0, 8)}`, language],
  );
  await asUser(client, world.users.puneMr);
  const id = randomUUID();
  await client.query('select public.capture_consent($1, $2, $3, $4, $5)', [
    id,
    world.visits.pune,
    'consented',
    language,
    version,
  ]);
  return { id, language };
};

const insertWithdrawal = async (
  client: Client,
  args: { supersedes: string; language: string; doctorId: string; capturedAt: string },
): Promise<void> => {
  await client.query(
    `insert into public.consent_records
       (id, visit_id, doctor_id, captured_by_mr_id, outcome, consent_text_version_id,
        displayed_language, supersedes_consent_record_id, is_withdrawal, captured_at)
     select $1, $2, $3, $4, 'declined', c.consent_text_version_id, $5, $6, true, $7::timestamptz
       from public.consent_records c where c.id = $6`,
    [
      randomUUID(),
      world.visits.pune,
      args.doctorId,
      world.users.puneMr.id,
      args.language,
      args.supersedes,
      args.capturedAt,
    ],
  );
};

describe.skipIf(!reachable)('C1 — can a withdrawal be backdated?', () => {
  it('YES, arbitrarily. Nothing bounds a withdrawal timestamp in either direction', async () => {
    // **The finding.** `validate_consent_withdrawal` checks the original's existence, its
    // outcome, its doctor and that it is not itself a withdrawal -- and never looks at
    // `captured_at`. `consent_records.captured_at` is NOT NULL with no default and no
    // check constraint. So a withdrawal can be stamped at any moment its author chooses.
    //
    // For a capture that is now bounded three ways (45001, 45007, 45008). For the record
    // that decides whether everything processed since the original consent was lawful,
    // it is bounded not at all.
    await inRolledBackTransaction(async (client) => {
      const { id, language } = await grantedConsent(client);
      await client.query('set local role postgres');

      // Five years before the consent it supersedes.
      await insertWithdrawal(client, {
        supersedes: id,
        language,
        doctorId: world.doctors.pune,
        capturedAt: '2021-01-01T00:00:00Z',
      });
      // And a year into the future.
      await insertWithdrawal(client, {
        supersedes: id,
        language,
        doctorId: world.doctors.pune,
        capturedAt: '2027-09-08T00:00:00Z',
      });

      const rows = await client.query<{ n: string }>(
        `select count(*) as n from public.consent_records
          where supersedes_consent_record_id = $1`,
        [id],
      );
      expect(Number(rows.rows[0]?.n)).toBe(2);
    });
  });

  it('and a CAPTURE with the same timestamps is refused, which is the contrast', async () => {
    // The comparison that makes the finding a gap rather than a design. The same instant
    // that a withdrawal accepts without comment, a capture refuses with its own code.
    await inRolledBackTransaction(async (client) => {
      const language = `zz-${randomUUID().slice(0, 8)}`;
      const version = randomUUID();
      await client.query(
        `insert into public.consent_text_versions
           (id, version_label, language, full_text, effective_from)
         values ($1, $2, $3, 'The notice.', now() - interval '30 days')`,
        [version, `mr05-c-${randomUUID().slice(0, 8)}`, language],
      );
      await asUser(client, world.users.puneMr);
      await expect(
        client.query('select public.capture_consent($1, $2, $3, $4, $5, null, $6)', [
          randomUUID(),
          world.visits.pune,
          'consented',
          language,
          version,
          '2027-09-08T00:00:00Z',
        ]),
      ).rejects.toMatchObject({ code: '45007' });
    });
  });
});

describe.skipIf(!reachable)(
  'C2 — can a client forge a withdrawal for a doctor it does not hold?',
  () => {
    it('NO. The doctor is pinned to the record being superseded', async () => {
      // `validate_consent_withdrawal` compares `new.doctor_id` against the original's, so a
      // withdrawal cannot be aimed at a doctor other than the one who granted the consent.
      // This is the bound that BE-W74 had to add by hand on the capture side, and here it
      // already existed.
      await inRolledBackTransaction(async (client) => {
        const { id, language } = await grantedConsent(client);
        await client.query('set local role postgres');
        await expect(
          insertWithdrawal(client, {
            supersedes: id,
            language,
            doctorId: world.doctors.south,
            capturedAt: new Date().toISOString(),
          }),
        ).rejects.toMatchObject({ code: '23514' });
      });
    });

    it('NO. A withdrawal naming a record that does not exist is refused', async () => {
      // Written with explicit VALUES rather than through `insertWithdrawal`, and the reason
      // is worth keeping: that helper is an `insert ... select ... where c.id = $n`, so a
      // missing original makes it insert NOTHING and raise nothing. A first pass asserted a
      // rejection there and failed -- it was testing the helper's SQL, not the schema.
      await inRolledBackTransaction(async (client) => {
        await client.query('set local role postgres');
        await expect(
          client.query(
            `insert into public.consent_records
             (id, visit_id, doctor_id, captured_by_mr_id, outcome, consent_text_version_id,
              displayed_language, supersedes_consent_record_id, is_withdrawal, captured_at)
           values ($1, $2, $3, $4, 'declined', $5, 'en-IN', $6, true, now())`,
            [
              randomUUID(),
              world.visits.pune,
              world.doctors.pune,
              world.users.puneMr.id,
              world.consentTextVersionId,
              randomUUID(),
            ],
          ),
        ).rejects.toThrow();
      });
    });

    it('and the helper writes nothing when the original is missing, which is not a bound', async () => {
      // Recorded because it is the kind of silence that reads as safety. An INSERT ... SELECT
      // whose source is empty succeeds and writes no row: no error to see, no withdrawal
      // recorded. Safe here, and it is the shape that hides a lost write elsewhere.
      await inRolledBackTransaction(async (client) => {
        await client.query('set local role postgres');
        const missing = randomUUID();
        await insertWithdrawal(client, {
          supersedes: missing,
          language: 'en-IN',
          doctorId: world.doctors.pune,
          capturedAt: new Date().toISOString(),
        });
        // Scoped to THIS supersedes id. `seedFixtures` already contains withdrawals, so an
        // unscoped `where is_withdrawal` counts those too -- which is how the first pass at
        // this assertion read 2 where it expected 0.
        const rows = await client.query(
          'select 1 from public.consent_records where supersedes_consent_record_id = $1',
          [missing],
        );
        expect(rows.rowCount).toBe(0);
      });
    });
  },
);

describe.skipIf(!reachable)('C3 — is a withdrawal append-only?', () => {
  const roles = ['authenticated', 'anon', 'service_role'] as const;

  it.each(roles)('YES. %s cannot UPDATE a withdrawal', async (role) => {
    await inRolledBackTransaction(async (client) => {
      const { id, language } = await grantedConsent(client);
      await client.query('set local role postgres');
      await insertWithdrawal(client, {
        supersedes: id,
        language,
        doctorId: world.doctors.pune,
        capturedAt: new Date().toISOString(),
      });
      await asDatabaseRole(client, role);
      await expect(
        client.query('update public.consent_records set is_withdrawal = false where id = $1', [id]),
      ).rejects.toThrow();
    });
  });

  it.each(roles)('YES. %s cannot DELETE a withdrawal', async (role) => {
    await inRolledBackTransaction(async (client) => {
      const { id, language } = await grantedConsent(client);
      await client.query('set local role postgres');
      await insertWithdrawal(client, {
        supersedes: id,
        language,
        doctorId: world.doctors.pune,
        capturedAt: new Date().toISOString(),
      });
      await asDatabaseRole(client, role);
      await expect(
        client.query('delete from public.consent_records where supersedes_consent_record_id = $1', [
          id,
        ]),
      ).rejects.toThrow();
    });
  });

  it('YES, and the OWNER is caught too — the case a policy would have missed', async () => {
    // `consent_records_reject_mutation` is a STATEMENT-level trigger, so it fires for
    // `postgres` and `service_role` as well. A policy would have protected the row from
    // everyone except the two roles most able to rewrite history.
    await inRolledBackTransaction(async (client) => {
      const { id, language } = await grantedConsent(client);
      await client.query('set local role postgres');
      await insertWithdrawal(client, {
        supersedes: id,
        language,
        doctorId: world.doctors.pune,
        capturedAt: new Date().toISOString(),
      });
      await expect(
        client.query('delete from public.consent_records where id = $1', [id]),
      ).rejects.toMatchObject({ code: '23001' });
    });
  });
});
