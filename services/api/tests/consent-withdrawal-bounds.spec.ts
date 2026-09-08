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

describe.skipIf(!reachable)('C1 — a withdrawal is bounded in BOTH directions', () => {
  // **The tests below asserted the defect until MR-06, and the inversion is the fix.**
  // MR-05 recorded, correctly, that `validate_consent_withdrawal` never looked at
  // `captured_at` and that five years back and a year forward were both accepted. That
  // is BE-W77, and it is now closed in the TRIGGER rather than in `capture_consent` --
  // see the C1c case below for why that distinction is load-bearing.

  it('refuses a withdrawal dated beyond the future tolerance, with 45007', async () => {
    await inRolledBackTransaction(async (client) => {
      const { id, language } = await grantedConsent(client);
      await client.query('set local role postgres');

      await expect(
        insertWithdrawal(client, {
          supersedes: id,
          language,
          doctorId: world.doctors.pune,
          capturedAt: '2027-09-08T00:00:00Z',
        }),
      ).rejects.toMatchObject({ code: '45007' });
    });
  });

  it('refuses a withdrawal older than the maximum sync lag, with 45008', async () => {
    await inRolledBackTransaction(async (client) => {
      const { id, language } = await grantedConsent(client);
      await client.query('set local role postgres');

      // Five years before the consent it supersedes -- the case MR-05 showed accepted.
      await expect(
        insertWithdrawal(client, {
          supersedes: id,
          language,
          doctorId: world.doctors.pune,
          capturedAt: '2021-01-01T00:00:00Z',
        }),
      ).rejects.toMatchObject({ code: '45008' });
    });
  });

  it('refuses a withdrawal that predates the consent it supersedes, with 23514', async () => {
    // The bound with no counterpart on the capture side, and the sync lag does NOT cover
    // it: an hour-old consent withdrawn "two hours ago" is well inside 72 hours and still
    // describes a withdrawal that happened before there was anything to withdraw. It is
    // the cheapest form of the backdating attack.
    await inRolledBackTransaction(async (client) => {
      const { id, language } = await grantedConsent(client);
      await client.query('set local role postgres');

      const before = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      await expect(
        insertWithdrawal(client, {
          supersedes: id,
          language,
          doctorId: world.doctors.pune,
          capturedAt: before,
        }),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  it('THE POSITIVE CONTROL: an ordinary withdrawal is still accepted', async () => {
    // Without this, the three refusals above would also be produced by a trigger that
    // refuses EVERY withdrawal -- a worse defect than the one being fixed, because a
    // doctor unable to withdraw consent at all is the DPDP s.6(4) violation itself.
    await inRolledBackTransaction(async (client) => {
      const { id, language } = await grantedConsent(client);
      await client.query('set local role postgres');

      await insertWithdrawal(client, {
        supersedes: id,
        language,
        doctorId: world.doctors.pune,
        capturedAt: new Date().toISOString(),
      });

      const rows = await client.query<{ n: string }>(
        `select count(*) as n from public.consent_records
          where supersedes_consent_record_id = $1`,
        [id],
      );
      expect(Number(rows.rows[0]?.n)).toBe(1);
    });
  });

  it('a device a little fast is still accepted — the same tolerance a capture gets', async () => {
    // The same threshold, deliberately: two numbers for one question is two numbers to
    // keep in step, and they would drift. `consent_future_tolerance_seconds` is 120, so
    // two seconds ahead is a phone, not an attack.
    await inRolledBackTransaction(async (client) => {
      const { id, language } = await grantedConsent(client);
      await client.query('set local role postgres');

      await insertWithdrawal(client, {
        supersedes: id,
        language,
        doctorId: world.doctors.pune,
        capturedAt: new Date(Date.now() + 2_000).toISOString(),
      });

      const rows = await client.query<{ n: string }>(
        `select count(*) as n from public.consent_records
          where supersedes_consent_record_id = $1`,
        [id],
      );
      expect(Number(rows.rows[0]?.n)).toBe(1);
    });
  });

  it('C1c: a client cannot insert a withdrawal at all — and a GRANT is what stops it', async () => {
    // The first draft of this test asserted `45007` here and was wrong, which is worth
    // keeping because the real answer is better. `authenticated` never reaches the bound:
    // it is refused with `permission denied for table consent_records` before the
    // timestamp is looked at.
    //
    // The mechanism is not the one you would guess. `validate_consent_withdrawal` is a
    // plain trigger function -- NOT `SECURITY DEFINER` -- so it runs as the caller, and
    // its `select * from consent_records where id = supersedes...` needs a SELECT grant
    // the `authenticated` role does not have. The withdrawal path is closed to a REST
    // client by a missing grant, as a side effect of the validator reading the table.
    //
    // Recorded rather than relied upon. A guard that holds because of where a SELECT
    // happens to sit is a guard that moves the day somebody adds `security definer` to
    // make the validator work for a new caller. The timestamp bounds above are the
    // durable control; this is the reason nothing exercises them over REST today.
    await inRolledBackTransaction(async (client) => {
      const { id, language } = await grantedConsent(client);
      // NOT postgres: the ordinary authenticated role, on the ordinary REST path.
      await asUser(client, world.users.puneMr);

      await expect(
        insertWithdrawal(client, {
          supersedes: id,
          language,
          doctorId: world.doctors.pune,
          capturedAt: '2027-09-08T00:00:00Z',
        }),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('BE-W78: but a plain CAPTURE over the same path is unbounded, and is accepted', async () => {
    // **The defect this file found and did not fix.** A capture needs to read nothing, so
    // the grant that closes the withdrawal path does not close this one:
    //
    //   * `authenticated` holds a direct INSERT grant on `public.consent_records`;
    //   * `consent_records_insert_own` permits the row when the MR owns the visit;
    //   * so an insert over PostgREST never calls `capture_consent`;
    //   * and every bound that function carries -- 45001 notice-superseded, 45007 future,
    //     45008 sync lag -- is skipped with it.
    //
    // BE-W74 routed the SYNC path through `capture_consent`. The REST path was never
    // routed anywhere. A consent dated a YEAR IN THE FUTURE is accepted below, by an
    // ordinary MR, on the ordinary path the app is being converted to use.
    //
    // Not fixed here: the remedies are to move the bounds into a trigger or to revoke the
    // INSERT grant so `capture_consent` is the only door, and either has a blast radius
    // that deserves its own session rather than being bolted onto this one.
    await inRolledBackTransaction(async (client) => {
      await asUser(client, world.users.puneMr);

      await client.query(
        `insert into public.consent_records
           (id, visit_id, doctor_id, captured_by_mr_id, outcome, consent_text_version_id,
            displayed_language, captured_at)
         values ($1, $2, $3, $4, 'consented', $5, 'en-IN', now() + interval '1 year')`,
        [
          randomUUID(),
          world.visits.pune,
          world.doctors.pune,
          world.users.puneMr.id,
          world.consentTextVersionId,
        ],
      );

      // `authenticated` has INSERT but no SELECT, so the row is counted as the owner.
      // That asymmetry is itself the shape of the hole: a client may write a record it
      // cannot read back, so nothing it does will ever show it the row it just forged.
      await client.query('set local role postgres');
      const rows = await client.query<{ n: string }>(
        `select count(*) as n from public.consent_records
          where captured_at > now() + interval '300 days'`,
      );
      expect(
        Number(rows.rows[0]?.n),
        'BE-W78 still open: a future-dated consent was written over REST',
      ).toBe(1);
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
