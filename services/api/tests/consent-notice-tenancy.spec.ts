import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asOwner, asUser } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * MR-07 Part C — BE-W79. A consent notice belongs to a tenant.
 *
 * `consent_text_versions` had no organisation column and `active_consent_text_at`
 * returned the newest notice for a language across EVERY tenant. MR-06 found the denial
 * of service; MR-07 C1 traced the read path and found it is also a DISCLOSURE, confirmed
 * three ways against the live database:
 *
 *   (a) tenant A's MR could read tenant B's notice text in full — the select policy was
 *       `using (true)`;
 *   (b) `active_consent_text(language)`, the call behind the consent screen, returned
 *       TENANT B's notice to tenant A's MR, so the app would have displayed another
 *       company's legal document to a doctor;
 *   (c) a capture against it SUCCEEDED, writing a consent record that attests a doctor
 *       agreed to a document the capturing tenant never wrote.
 *
 * Every test below is the fixture that demonstrated one of those, inverted.
 *
 * **The positive controls are load-bearing here more than usual.** "Tenant B's notice has
 * no effect on tenant A" is also what you get from a database where nothing resolves a
 * notice at all, and that failure would present as a clean green run and a consent screen
 * that cannot open. So each tenant is asserted to see its OWN notice in the same breath
 * as not seeing the other's.
 */

const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

/** A language nothing else in the run uses, so the only rows in it are this test's. */
const freshLanguage = (): string => `zz-${randomUUID().slice(0, 8)}`;

const publishNotice = async (
  client: Client,
  args: { language: string; organisationId: string; body: string; effectiveFrom: string },
): Promise<string> => {
  const id = randomUUID();
  await asOwner(client, () =>
    client.query(
      `insert into public.consent_text_versions
         (id, version_label, language, full_text, effective_from, organisation_id)
       values ($1, $2, $3, $4, now() - $5::interval, $6)`,
      [
        id,
        `mr07-${randomUUID().slice(0, 8)}`,
        args.language,
        args.body,
        args.effectiveFrom,
        args.organisationId,
      ],
    ),
  );
  return id;
};

/** A fresh visit for tenant A's MR, because a capture needs one it owns. */
const freshVisitForPuneMr = async (client: Client): Promise<string> => {
  const visitId = randomUUID();
  await asOwner(client, () =>
    client.query(
      `insert into public.visits (id, mr_id, doctor_id, clinic_address_id, status, started_at)
       values ($1, $2, $3, $4, 'in_progress', now())`,
      [visitId, world.users.puneMr.id, world.doctors.pune, world.clinicAddresses.pune],
    ),
  );
  return visitId;
};

describe.skipIf(!reachable)('C4 — another tenant publishing a notice has no effect', () => {
  it('tenant A captures against its own notice, before and after tenant B publishes', async () => {
    // **The exact fixture from MR-06 that demonstrated the defect.** It ran:
    //
    //     BEFORE: active for the language -> A v1   -> A captures, accepted
    //     tenant B inserts a notice in the SAME language, touching nothing of A's
    //     AFTER:  active for the language -> B v1   -> A's capture REFUSED 45001
    //
    // The "after" line is the whole of BE-W79's denial-of-service half. It must now be
    // indistinguishable from the "before" line.
    await inRolledBackTransaction(async (client) => {
      const language = freshLanguage();
      const aNotice = await publishNotice(client, {
        language,
        organisationId: world.organisationId,
        body: 'TENANT A NOTICE',
        effectiveFrom: '7 days',
      });

      // BEFORE.
      const firstVisit = await freshVisitForPuneMr(client);
      await asUser(client, world.users.puneMr);
      await client.query('select public.capture_consent($1, $2, $3, $4, $5)', [
        randomUUID(),
        firstVisit,
        'consented',
        language,
        aNotice,
      ]);

      // Tenant B publishes a LATER notice in the same language. It touches nothing of A's.
      await publishNotice(client, {
        language,
        organisationId: world.rivalOrganisationId,
        body: 'TENANT B CONFIDENTIAL NOTICE',
        effectiveFrom: '1 minute',
      });

      // AFTER. Same capture, same notice, and it must still be accepted.
      const secondVisit = await freshVisitForPuneMr(client);
      await asUser(client, world.users.puneMr);
      await client.query('select public.capture_consent($1, $2, $3, $4, $5)', [
        randomUUID(),
        secondVisit,
        'consented',
        language,
        aNotice,
      ]);

      await asOwner(client, async () => {
        const rows = await client.query<{ n: string }>(
          `select count(*) as n from public.consent_records
            where visit_id in ($1, $2)`,
          [firstVisit, secondVisit],
        );
        expect(Number(rows.rows[0]?.n), 'both captures must have been written').toBe(2);
      });
    });
  });

  it('C1(a) closed: tenant A cannot read tenant B notice text at all', async () => {
    // The disclosure half. `consent_text_versions_select_authenticated` was `using (true)`
    // and returned `TENANT B CONFIDENTIAL NOTICE` in full to tenant A's MR.
    await inRolledBackTransaction(async (client) => {
      const language = freshLanguage();
      const aNotice = await publishNotice(client, {
        language,
        organisationId: world.organisationId,
        body: 'TENANT A NOTICE',
        effectiveFrom: '7 days',
      });
      const bNotice = await publishNotice(client, {
        language,
        organisationId: world.rivalOrganisationId,
        body: 'TENANT B CONFIDENTIAL NOTICE',
        effectiveFrom: '1 minute',
      });

      await asUser(client, world.users.puneMr);
      const visible = await client.query<{ id: string }>(
        'select id from public.consent_text_versions where language = $1',
        [language],
      );
      const ids = visible.rows.map((r) => r.id);

      expect(ids, "tenant B's notice must not be readable").not.toContain(bNotice);
      // THE POSITIVE CONTROL. Without it this passes against a policy that hides
      // everything, which would break the language picker for every tenant equally.
      expect(ids, 'tenant A must still see its OWN notice').toContain(aNotice);
    });
  });

  it('C1(b) closed: the consent screen resolves the CALLER tenant notice', async () => {
    // `active_consent_text` is what sits behind `/consent-text-versions/active`. It
    // returned tenant B's notice to tenant A's MR, which is the app displaying another
    // company's legal document to a doctor.
    await inRolledBackTransaction(async (client) => {
      const language = freshLanguage();
      const aNotice = await publishNotice(client, {
        language,
        organisationId: world.organisationId,
        body: 'TENANT A NOTICE',
        effectiveFrom: '7 days',
      });
      const bNotice = await publishNotice(client, {
        language,
        organisationId: world.rivalOrganisationId,
        body: 'TENANT B CONFIDENTIAL NOTICE',
        effectiveFrom: '1 minute',
      });

      await asUser(client, world.users.puneMr);
      const forA = await client.query<{ id: string }>(
        'select id from public.active_consent_text($1)',
        [language],
      );
      expect(forA.rows[0]?.id).toBe(aNotice);

      // And the mirror, which is the positive control on the whole mechanism: tenant B's
      // own MR gets tenant B's notice. A resolver that returned nothing to everybody
      // would satisfy the assertion above and leave both tenants unable to ask anybody.
      await asUser(client, world.users.rivalMr);
      const forB = await client.query<{ id: string }>(
        'select id from public.active_consent_text($1)',
        [language],
      );
      expect(forB.rows[0]?.id).toBe(bNotice);
    });
  });

  it('C1(c) closed: capturing against another tenant notice is refused 45001', async () => {
    // The worst branch. It SUCCEEDED before, because tenant B's notice genuinely was the
    // active one — so tenant A ended up holding a consent record naming a document it had
    // never written, and tenant B was named in a consent it never issued.
    await inRolledBackTransaction(async (client) => {
      const language = freshLanguage();
      await publishNotice(client, {
        language,
        organisationId: world.organisationId,
        body: 'TENANT A NOTICE',
        effectiveFrom: '7 days',
      });
      const bNotice = await publishNotice(client, {
        language,
        organisationId: world.rivalOrganisationId,
        body: 'TENANT B CONFIDENTIAL NOTICE',
        effectiveFrom: '1 minute',
      });

      const visitId = await freshVisitForPuneMr(client);
      await asUser(client, world.users.puneMr);
      await expect(
        client.query('select public.capture_consent($1, $2, $3, $4, $5)', [
          randomUUID(),
          visitId,
          'consented',
          language,
          bNotice,
        ]),
      ).rejects.toMatchObject({ code: '45001' });
    });
  });

  it('the two tenants may now use the same version label, which they could not before', async () => {
    // A quieter cross-tenant coupling on the same table:
    // `UNIQUE (version_label, language)` meant tenant B could not publish a notice
    // labelled `v1` in `en-IN` because tenant A already had one. It would have surfaced
    // as an inexplicable 23505 on a customer's first day.
    await inRolledBackTransaction(async (client) => {
      const language = freshLanguage();
      const label = `shared-${randomUUID().slice(0, 8)}`;
      await asOwner(client, async () => {
        for (const org of [world.organisationId, world.rivalOrganisationId]) {
          await client.query(
            `insert into public.consent_text_versions
               (id, version_label, language, full_text, effective_from, organisation_id)
             values ($1, $2, $3, 'Same label, different company.', now() - interval '1 day', $4)`,
            [randomUUID(), label, language, org],
          );
        }
        const rows = await client.query<{ n: string }>(
          'select count(*) as n from public.consent_text_versions where version_label = $1',
          [label],
        );
        expect(Number(rows.rows[0]?.n)).toBe(2);
      });
    });
  });
});
