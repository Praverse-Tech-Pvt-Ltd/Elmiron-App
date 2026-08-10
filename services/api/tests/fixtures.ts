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
 */

export interface FixtureUser extends ProfileLike {
  email: string;
  password: string;
  fullName: string;
}

export interface FixtureWorld {
  runId: string;
  organisationId: string;
  territories: {
    national: string;
    west: string;
    pune: string;
    nagpur: string;
    south: string;
  };
  users: {
    admin: FixtureUser;
    westManager: FixtureUser;
    southManager: FixtureUser;
    puneMr: FixtureUser;
    nagpurMr: FixtureUser;
    southMr: FixtureUser;
  };
  doctors: { pune: string; south: string };
  clinicAddresses: { pune: string; south: string };
  visits: { pune: string; south: string };
  checkIns: { pune: string; south: string };
  checkOuts: { pune: string };
  callReports: { pune: string; south: string };
  samples: { pune: string };
  consentTextVersionId: string;
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
  };

  const organisationId = randomUUID();

  // Auth users first: user_profiles has an FK onto auth.users.
  const [admin, westManager, southManager, puneMr, nagpurMr, southMr] = await Promise.all([
    makeUser(runId, 'admin', 'admin', null),
    makeUser(runId, 'west-manager', 'field_manager', territories.west),
    makeUser(runId, 'south-manager', 'field_manager', territories.south),
    makeUser(runId, 'pune-mr', 'mr', territories.pune),
    makeUser(runId, 'nagpur-mr', 'mr', territories.nagpur),
    makeUser(runId, 'south-mr', 'mr', territories.south),
  ]);

  const world: FixtureWorld = {
    runId,
    organisationId,
    territories,
    users: { admin, westManager, southManager, puneMr, nagpurMr, southMr },
    doctors: { pune: randomUUID(), south: randomUUID() },
    clinicAddresses: { pune: randomUUID(), south: randomUUID() },
    visits: { pune: randomUUID(), south: randomUUID() },
    checkIns: { pune: randomUUID(), south: randomUUID() },
    checkOuts: { pune: randomUUID() },
    callReports: { pune: randomUUID(), south: randomUUID() },
    samples: { pune: randomUUID() },
    consentTextVersionId: randomUUID(),
    consentRecords: { pune: randomUUID(), south: randomUUID() },
    analyses: { pune: randomUUID(), south: randomUUID() },
    beatPlans: { pune: randomUUID() },
  };

  await withClient(async (client: Client) => {
    await client.query('begin');

    await client.query(`insert into public.organisations (id, name) values ($1, $2)`, [
      organisationId,
      `Gate0 Pharma ${runId}`,
    ]);

    await client.query(
      `insert into public.territories (id, name, code, parent_id, organisation_id) values
         ($1, 'National', $6,  null, $11),
         ($2, 'West',     $7,  $1,   $11),
         ($3, 'Pune',     $8,  $2,   $11),
         ($4, 'Nagpur',   $9,  $2,   $11),
         ($5, 'South',    $10, $1,   $11)`,
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
      ],
    );

    // Managers before their reports: validate_reporting_manager checks the target.
    for (const user of [admin, westManager, southManager]) {
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
      `insert into public.doctors (id, organisation_id, full_name, registration_number, specialty,
                                   qualification, territory_id, assigned_mr_id) values
         ($1, $3, 'Dr Pune Fixture',  'MH-1001', 'Urology',    'MBBS, MS', $4, $6),
         ($2, $3, 'Dr South Fixture', 'KA-2002', 'Nephrology', 'MBBS, MD', $5, $7)`,
      [
        world.doctors.pune,
        world.doctors.south,
        organisationId,
        territories.pune,
        territories.south,
        puneMr.id,
        southMr.id,
      ],
    );

    await client.query(
      `insert into public.clinic_addresses
         (id, doctor_id, label, line1, city, state, postal_code, latitude, longitude) values
         ($1, $3, 'Main clinic', '12 FC Road',   'Pune',      'Maharashtra', '411004', 18.5204, 73.8567),
         ($2, $4, 'Main clinic', '9 MG Road',    'Bengaluru', 'Karnataka',   '560001', 12.9716, 77.5946)`,
      [
        world.clinicAddresses.pune,
        world.clinicAddresses.south,
        world.doctors.pune,
        world.doctors.south,
      ],
    );

    await client.query(
      `insert into public.beat_plans (id, mr_id, territory_id, plan_date, status)
       values ($1, $2, $3, current_date, 'submitted')`,
      [world.beatPlans.pune, puneMr.id, territories.pune],
    );

    await client.query(
      `insert into public.visits (id, mr_id, doctor_id, clinic_address_id, status, started_at, completed_at) values
         ($1, $3, $5, $7, 'completed', now() - interval '2 hours', now() - interval '1 hour'),
         ($2, $4, $6, $8, 'completed', now() - interval '2 hours', now() - interval '1 hour')`,
      [
        world.visits.pune,
        world.visits.south,
        puneMr.id,
        southMr.id,
        world.doctors.pune,
        world.doctors.south,
        world.clinicAddresses.pune,
        world.clinicAddresses.south,
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
      `insert into public.consent_text_versions (id, version_label, language, full_text)
       values ($1, $2, 'en-IN', 'I agree to this conversation being recorded for coaching purposes.')`,
      [world.consentTextVersionId, `v1-${runId}`],
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
