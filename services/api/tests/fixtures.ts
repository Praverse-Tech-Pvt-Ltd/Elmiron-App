import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { createAuthUser } from './auth.js';
import type { AppRole, ProfileLike } from './auth.js';
import { withClient } from './db.js';

/**
 * A committed fixture world.
 *
 * Committed, not seeded inside a rolled-back transaction, because the PostgREST
 * and GoTrue paths run over HTTP on their own connections and cannot see
 * uncommitted rows. A suite that only seeds in-transaction can never exercise the
 * faithful path at all.
 *
 * Nothing is torn down, and that is deliberate: `consent_records` and `audit_log`
 * are append-only by trigger, so a teardown would either fail or have to disable
 * the very guard under test. Instead every run mints fresh UUIDs and fresh emails,
 * so runs never collide. `pnpm db:reset` clears the accumulation; CI resets before
 * every run anyway.
 *
 * Shape of the world:
 *
 *   National
 *   ├── West           westManager (field_manager)
 *   │   ├── Pune       puneMr
 *   │   └── Nagpur     nagpurMr
 *   └── South          southManager (field_manager), southMr
 *
 * puneMr and southMr are the adversarial pair: same schema, no shared scope.
 * westManager sees Pune and Nagpur and must not see South.
 *
 * And a SECOND, entirely separate organisation:
 *
 *   Rival Pharma
 *   └── Rival territory   rivalMr (mr), rivalAdmin (admin)
 *                         Dr Rival Fixture, one clinic, one visit
 *
 * **MR-06. This is the fixture that did not exist for twenty sessions.** Until it did,
 * `seedFixtures()` built exactly ONE organisation, so every isolation test ever written
 * compared two subtrees INSIDE a tenant and none compared two tenants. A boundary with
 * one instance in the fixtures cannot fail a test: it proves nothing, and it looks green.
 * BE-W76 -- an admin of one pharmaceutical company reading another's data through all
 * five paths -- survived that long for no other reason.
 *
 * It is deliberately small: one territory, one MR, one admin, one doctor, one visit. It
 * is not a second world to test against, it is the OTHER SIDE of a boundary, and every
 * row in it exists so that some cell of G-RLS-C has something real to be refused.
 *
 * `rivalAdmin` earns its place separately. It is the positive control for the admin row
 * of the matrix: without it, an admin being refused the rival doctor is indistinguishable
 * from that doctor not being readable by anyone. With it, the same query by the tenant's
 * OWN admin returns the row.
 */

export interface FixtureUser extends ProfileLike {
  email: string;
  password: string;
  fullName: string;
}

export interface FixtureWorld {
  runId: string;
  organisationId: string;
  /** The second tenant. Everything under `rival*` belongs to it and to nothing else. */
  rivalOrganisationId: string;
  territories: {
    national: string;
    west: string;
    pune: string;
    nagpur: string;
    south: string;
    rival: string;
  };
  users: {
    admin: FixtureUser;
    westManager: FixtureUser;
    southManager: FixtureUser;
    puneMr: FixtureUser;
    nagpurMr: FixtureUser;
    southMr: FixtureUser;
    rivalMr: FixtureUser;
    rivalAdmin: FixtureUser;
  };
  doctors: { pune: string; south: string; rival: string };
  clinicAddresses: { pune: string; south: string; rival: string };
  visits: { pune: string; south: string; rival: string };
  checkIns: { pune: string; south: string };
  checkOuts: { pune: string };
  callReports: { pune: string; south: string };
  samples: { pune: string };
  consentTextVersionId: string;
  /**
   * MR-16 B1 — a SECOND language for the SAME tenant, purely as a test dimension.
   *
   * `active_consent_text_at` selects with `and v.language = p_language`, and every fixture
   * in this repository held `en-IN` and nothing else. Deleting that clause from the live
   * function left the whole consent suite green: the predicate could not fail, so it
   * proved nothing.
   *
   * `consent-notice-tenancy.spec.ts` already mints a `freshLanguage()` per test, which
   * makes languages unique across the RUN but still leaves exactly one language per
   * TENANT — and the predicate also filters on `organisation_id`, so a single language per
   * tenant is enough to hide it.
   *
   * This notice is **deliberately NEWER** than the `en-IN` one. `active_consent_text_at`
   * orders by `effective_from desc`, so without the language clause an `en-IN` capture
   * would resolve THIS row. That is what makes the clause load-bearing rather than
   * decorative.
   *
   * `hi-IN` rather than `mr-IN`: `mr` is a ROLE in this codebase and a language code `mr`
   * beside it would cost somebody an afternoon. Which languages the product actually
   * ships is a separate client question and is NOT answered here.
   */
  hindiConsentTextVersionId: string;
  consentRecords: { pune: string; south: string };
  analyses: { pune: string; south: string };
  beatPlans: { pune: string };
}

const FIXTURE_PASSWORD = 'gate0-fixture-password-9f2b';

const makeUser = async (
  runId: string,
  key: string,
  role: AppRole,
  territoryId: string | null,
): Promise<FixtureUser> => {
  const email = `gate0-${runId}-${key}@example.test`;
  const id = await createAuthUser(email, FIXTURE_PASSWORD);
  return {
    id,
    role,
    territoryId,
    isActive: true,
    email,
    password: FIXTURE_PASSWORD,
    fullName: `Gate0 ${key}`,
  };
};

export const seedFixtures = async (): Promise<FixtureWorld> => {
  const runId = randomUUID().slice(0, 8);

  const territories = {
    national: randomUUID(),
    west: randomUUID(),
    pune: randomUUID(),
    nagpur: randomUUID(),
    south: randomUUID(),
    rival: randomUUID(),
  };

  const organisationId = randomUUID();
  const rivalOrganisationId = randomUUID();

  // Auth users first: user_profiles has an FK onto auth.users.
  //
  // **Created SEQUENTIALLY, and that is not a style choice.** These were a `Promise.all`
  // of six until MR-06 added the rival organisation, and eight concurrent `POST
  // /admin/users` per suite -- across a dozen suites vitest runs in parallel, with no
  // concurrency cap -- exhausted the local Postgres. GoTrue could not get a connection
  // (`remaining connection slots are reserved for roles with the SUPERUSER attribute`,
  // `sorry, too many clients already`) and returned a 500 that surfaced as
  // "Database error creating new user", failing eight suites at the `beforeAll`.
  //
  // `max_connections` is 100. Raising it would hide the burst rather than remove it, and
  // capping vitest's concurrency would slow every suite to fix one. Serialising here
  // costs a few hundred milliseconds per suite and cuts the peak by a factor of eight.
  const users: FixtureUser[] = [];
  for (const [key, role, territoryId] of [
    ['admin', 'admin', null],
    ['west-manager', 'field_manager', territories.west],
    ['south-manager', 'field_manager', territories.south],
    ['pune-mr', 'mr', territories.pune],
    ['nagpur-mr', 'mr', territories.nagpur],
    ['south-mr', 'mr', territories.south],
    ['rival-mr', 'mr', territories.rival],
    ['rival-admin', 'admin', null],
  ] as ReadonlyArray<readonly [string, AppRole, string | null]>) {
    users.push(await makeUser(runId, key, role, territoryId));
  }
  const [admin, westManager, southManager, puneMr, nagpurMr, southMr, rivalMr, rivalAdmin] =
    users as [
      FixtureUser,
      FixtureUser,
      FixtureUser,
      FixtureUser,
      FixtureUser,
      FixtureUser,
      FixtureUser,
      FixtureUser,
    ];

  const world: FixtureWorld = {
    runId,
    organisationId,
    rivalOrganisationId,
    territories,
    users: { admin, westManager, southManager, puneMr, nagpurMr, southMr, rivalMr, rivalAdmin },
    doctors: { pune: randomUUID(), south: randomUUID(), rival: randomUUID() },
    clinicAddresses: { pune: randomUUID(), south: randomUUID(), rival: randomUUID() },
    visits: { pune: randomUUID(), south: randomUUID(), rival: randomUUID() },
    checkIns: { pune: randomUUID(), south: randomUUID() },
    checkOuts: { pune: randomUUID() },
    callReports: { pune: randomUUID(), south: randomUUID() },
    samples: { pune: randomUUID() },
    consentTextVersionId: randomUUID(),
    hindiConsentTextVersionId: randomUUID(),
    consentRecords: { pune: randomUUID(), south: randomUUID() },
    analyses: { pune: randomUUID(), south: randomUUID() },
    beatPlans: { pune: randomUUID() },
  };

  await withClient(async (client: Client) => {
    await client.query('begin');

    await client.query(`insert into public.organisations (id, name) values ($1, $2), ($3, $4)`, [
      organisationId,
      `Gate0 Pharma ${runId}`,
      rivalOrganisationId,
      `Rival Pharma ${runId}`,
    ]);

    await client.query(
      `insert into public.territories (id, name, code, parent_id, organisation_id) values
         ($1, 'National', $6,  null, $11),
         ($2, 'West',     $7,  $1,   $11),
         ($3, 'Pune',     $8,  $2,   $11),
         ($4, 'Nagpur',   $9,  $2,   $11),
         ($5, 'South',    $10, $1,   $11),
         ($12, 'Rival',   $13, null, $14)`,
      [
        territories.national,
        territories.west,
        territories.pune,
        territories.nagpur,
        territories.south,
        `IN-${runId}`,
        `IN-W-${runId}`,
        `IN-W-PUN-${runId}`,
        `IN-W-NAG-${runId}`,
        `IN-S-${runId}`,
        organisationId,
        territories.rival,
        `RV-${runId}`,
        rivalOrganisationId,
      ],
    );

    // Managers before their reports: validate_reporting_manager checks the target.
    //
    // MR-06: an admin has no territory -- `user_profiles_field_roles_require_territory`
    // permits exactly that -- so it has no territory to derive an organisation from and
    // must name one. That is the whole shape of BE-W76 in one argument: the role the
    // schema exempted from territory scoping was the role with no tenant at all.
    for (const [user, org] of [
      [admin, organisationId],
      [rivalAdmin, rivalOrganisationId],
    ] as const) {
      await client.query(
        `insert into public.user_profiles (id, full_name, role, territory_id, organisation_id)
         values ($1, $2, $3, null, $4)`,
        [user.id, user.fullName, user.role, org],
      );
    }
    // Field roles derive their organisation from their territory, so these are unchanged.
    for (const user of [westManager, southManager]) {
      await client.query(
        `insert into public.user_profiles (id, full_name, role, territory_id) values ($1, $2, $3, $4)`,
        [user.id, user.fullName, user.role, user.territoryId],
      );
    }
    for (const [user, manager] of [
      [puneMr, westManager],
      [nagpurMr, westManager],
      [southMr, southManager],
    ] as const) {
      await client.query(
        `insert into public.user_profiles (id, full_name, role, territory_id, reporting_manager_id)
         values ($1, $2, $3, $4, $5)`,
        [user.id, user.fullName, user.role, user.territoryId, manager.id],
      );
    }
    await client.query(
      `insert into public.user_profiles (id, full_name, role, territory_id) values ($1, $2, $3, $4)`,
      [rivalMr.id, rivalMr.fullName, rivalMr.role, rivalMr.territoryId],
    );

    await client.query(
      `insert into public.doctors (id, organisation_id, full_name, registration_number, specialty,
                                   qualification, territory_id, assigned_mr_id) values
         ($1, $3, 'Dr Pune Fixture',  'MH-1001', 'Urology',    'MBBS, MS', $4, $6),
         ($2, $3, 'Dr South Fixture', 'KA-2002', 'Nephrology', 'MBBS, MD', $5, $7),
         ($8, $9, 'Dr Rival Fixture', 'DL-3003', 'Urology',    'MBBS, MS', $10, $11)`,
      [
        world.doctors.pune,
        world.doctors.south,
        organisationId,
        territories.pune,
        territories.south,
        puneMr.id,
        southMr.id,
        world.doctors.rival,
        rivalOrganisationId,
        territories.rival,
        rivalMr.id,
      ],
    );

    await client.query(
      `insert into public.clinic_addresses
         (id, doctor_id, label, line1, city, state, postal_code, latitude, longitude) values
         ($1, $3, 'Main clinic', '12 FC Road',   'Pune',      'Maharashtra', '411004', 18.5204, 73.8567),
         ($2, $4, 'Main clinic', '9 MG Road',    'Bengaluru', 'Karnataka',   '560001', 12.9716, 77.5946),
         ($5, $6, 'Main clinic', '3 Nehru Place','New Delhi', 'Delhi',       '110019', 28.5494, 77.2501)`,
      [
        world.clinicAddresses.pune,
        world.clinicAddresses.south,
        world.doctors.pune,
        world.doctors.south,
        world.clinicAddresses.rival,
        world.doctors.rival,
      ],
    );

    await client.query(
      `insert into public.beat_plans (id, mr_id, territory_id, plan_date, status)
       values ($1, $2, $3, current_date, 'submitted')`,
      [world.beatPlans.pune, puneMr.id, territories.pune],
    );

    // BE-W3. One window on the root, inherited by every territory beneath it, and
    // one override on Nagpur so the inheritance walk has something to stop at.
    await client.query(
      `insert into public.territory_shift_windows
         (territory_id, shift_start, shift_end, timezone, grace_minutes, active_weekdays) values
         ($1, '09:00', '19:00', 'Asia/Kolkata', 15, '{1,2,3,4,5,6}'),
         ($2, '06:00', '10:00', 'Asia/Kolkata', 0,  '{1,2,3,4,5}'),
         -- MR-25 C2. A window whose END PLUS GRACE CROSSES MIDNIGHT: 23:59 + 30 minutes.
         --
         -- The dimension is_within_shift actually turns on, which no fixture held. The two
         -- windows above end at 19:00 and 10:00 and neither wraps, so the wrapping branch did
         -- not exist as far as any test could tell -- while seed-day.mjs seeded exactly
         -- 23:59/30, putting the DEMO data in the failing configuration and leaving the suite
         -- green. MR-24 found it on an emulator: time '23:59' + 30 minutes is 00:29, so
         -- the predicate became ">= 03:30 AND <= 00:29" and no time of day satisfied it.
         -- Every check-in and check-out was refused, all day.
         --
         -- On rival, deliberately: it belongs to the second organisation and no capture test
         -- runs against it, so adding this cannot change what any existing case asserts. It is
         -- here so the VALUE EXISTS in the fixtures and dimension-coverage.spec.ts can hold
         -- it, which is what stops the dimension quietly collapsing back to one value.
         ($3, '04:00', '23:59', 'Asia/Kolkata', 30, '{1,2,3,4,5,6,7}')`,
      [territories.national, territories.nagpur, territories.rival],
    );

    await client.query(
      `insert into public.visits (id, mr_id, doctor_id, clinic_address_id, status, started_at, completed_at) values
         ($1, $3, $5, $7, 'completed', now() - interval '2 hours', now() - interval '1 hour'),
         ($2, $4, $6, $8, 'completed', now() - interval '2 hours', now() - interval '1 hour'),
         ($9, $10, $11, $12, 'completed', now() - interval '2 hours', now() - interval '1 hour')`,
      [
        world.visits.pune,
        world.visits.south,
        puneMr.id,
        southMr.id,
        world.doctors.pune,
        world.doctors.south,
        world.clinicAddresses.pune,
        world.clinicAddresses.south,
        world.visits.rival,
        rivalMr.id,
        world.doctors.rival,
        world.clinicAddresses.rival,
      ],
    );

    await client.query(
      `insert into public.check_ins
         (id, visit_id, mr_id, latitude, longitude, geofence_status, source, occurred_at) values
         ($1, $3, $5, 18.5204, 73.8567, 'inside', 'automatic', now() - interval '2 hours'),
         ($2, $4, $6, 12.9716, 77.5946, 'inside', 'automatic', now() - interval '2 hours')`,
      [
        world.checkIns.pune,
        world.checkIns.south,
        world.visits.pune,
        world.visits.south,
        puneMr.id,
        southMr.id,
      ],
    );

    await client.query(
      `insert into public.check_outs
         (id, visit_id, mr_id, latitude, longitude, geofence_status, source, occurred_at)
       values ($1, $2, $3, 18.5204, 73.8567, 'inside', 'automatic', now() - interval '1 hour')`,
      [world.checkOuts.pune, world.visits.pune, puneMr.id],
    );

    await client.query(
      `insert into public.call_reports (id, visit_id, mr_id, summary, status) values
         ($1, $3, $5, 'Discussed the Pune formulary position.', 'submitted'),
         ($2, $4, $6, 'Discussed the South formulary position.', 'submitted')`,
      [
        world.callReports.pune,
        world.callReports.south,
        world.visits.pune,
        world.visits.south,
        puneMr.id,
        southMr.id,
      ],
    );

    await client.query(
      `insert into public.samples_and_inputs
         (id, visit_id, mr_id, doctor_id, kind, item_name, quantity, declared_value_inr, occurred_at)
       values ($1, $2, $3, $4, 'sample', 'Elmiron 100mg', 4, 0, now() - interval '90 minutes')`,
      [world.samples.pune, world.visits.pune, puneMr.id, world.doctors.pune],
    );

    await client.query(
      // MR-07: `effective_from` is explicit and in the PAST, and it has to be.
      //
      // It defaulted to `now()` while the consent records below are stamped
      // `now() - interval '2 hours'` -- so this fixture asserted a doctor was shown a
      // notice two hours before the notice existed. Nothing checked it until BE-W78 put
      // the capture bounds in a trigger, and then sixteen suites failed at once with
      // "no active consent text for language en-IN at <2 hours ago>".
      //
      // The trigger was right and the fixture was fabricated data. Same family as
      // `sizeBytes: 1`: a value that satisfied every shape and described something that
      // had not happened.
      // MR-07 / BE-W79: a notice belongs to a tenant. Before that column existed every
      // suite's `en-IN` version competed to be "the active one" globally, so whichever
      // suite seeded last silently invalidated the others' consent records.
      `insert into public.consent_text_versions
         (id, version_label, language, full_text, effective_from, organisation_id)
       values ($1, $2, 'en-IN', 'I agree to this conversation being recorded for coaching purposes.',
               now() - interval '30 days', $3)`,
      [world.consentTextVersionId, `v1-${runId}`, organisationId],
    );

    // MR-16 B1. The second language, NEWER than the first, for the SAME tenant. See
    // `hindiConsentTextVersionId` above for why newer is the point.
    await client.query(
      `insert into public.consent_text_versions
         (id, version_label, language, full_text, effective_from, organisation_id)
       values ($1, $2, 'hi-IN', 'मैं इस बातचीत को कोचिंग के लिए रिकॉर्ड करने से सहमत हूँ।',
               now() - interval '1 day', $3)`,
      [world.hindiConsentTextVersionId, `v1-hi-${runId}`, organisationId],
    );

    await client.query(
      `insert into public.consent_records
         (id, visit_id, doctor_id, captured_by_mr_id, outcome, consent_text_version_id,
          displayed_language, captured_at) values
         ($1, $3, $5, $7, 'consented', $9, 'en-IN', now() - interval '2 hours'),
         ($2, $4, $6, $8, 'consented', $9, 'en-IN', now() - interval '2 hours')`,
      [
        world.consentRecords.pune,
        world.consentRecords.south,
        world.visits.pune,
        world.visits.south,
        world.doctors.pune,
        world.doctors.south,
        puneMr.id,
        southMr.id,
        world.consentTextVersionId,
      ],
    );

    await client.query(
      `insert into public.analyses
         (id, visit_id, mr_id, status, rubric_version, model_provider, model_version, generated_at) values
         ($1, $3, $5, 'completed', 'rubric-w2', 'fixture', 'v0', now()),
         ($2, $4, $6, 'completed', 'rubric-w2', 'fixture', 'v0', now())`,
      [
        world.analyses.pune,
        world.analyses.south,
        world.visits.pune,
        world.visits.south,
        puneMr.id,
        southMr.id,
      ],
    );

    await client.query('commit');
  });

  return world;
};
