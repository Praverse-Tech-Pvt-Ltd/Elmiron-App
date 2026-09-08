import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import {
  createAuthUser,
  DEFAULT_API_URL,
  DEFAULT_DB_URL,
  DEFAULT_SERVICE_ROLE_KEY,
} from './seed-one-mr.mjs';

/**
 * A signable MR with a day in front of them, in one tenant. THE MISSING LINK.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS, AND WHY IT IS A NEW SCRIPT
 * ---------------------------------------------------------------------------
 *
 * Three seeds existed and none of them did this job:
 *
 *   `seed:mr`         a signable MR, and `doctors=0`. No territory content at all.
 *   `seed:synthetic`  100 MRs, 3,520 doctors, 208,800 visits -- and none of those
 *                     accounts can sign in, deliberately (BE-W17 mints profiles, not
 *                     identities).
 *   `seed:reference`  nothing. It refuses to invent content, correctly, and takes a data
 *                     file that does not exist in this repository.
 *
 * So there was no way to put a real doctor in front of a real signed-in MR, and MR-09
 * proved on the emulator what that costs: the Today screen renders visit
 * `66666666-...-601` from the mock while Supabase holds `doctors=0, visits=0`, and
 * `record_check_in` opens with *"the visit is yours"* or `42501`. **The write conversion
 * needs the read conversion, the read conversion needs data, and the data did not
 * exist.**
 *
 * **A NEW SCRIPT rather than growing `seed:mr`, and the reason is what each is for.**
 * `seed:mr` has one job and one output -- a credential -- and `seed-one-mr.spec.ts`
 * asserts exactly that shape. Growing it to build a territory tree, doctors, clinic
 * addresses, visits, a consent notice and two more roles would couple a credential helper
 * to a demo dataset, and every test of the former would start depending on the latter.
 * This is closer in kind to `seed-synthetic.mjs`: a dataset, obviously synthetic, safe to
 * delete. It reuses `seed:mr`'s `createAuthUser` because minting an identity by hand gets
 * the password hashing, the identity row and the confirmation state wrong in ways that
 * only appear as an unexplained "Invalid login credentials".
 *
 * ---------------------------------------------------------------------------
 * WHAT IT PRODUCES, AND THE THREE THINGS THE OBVIOUS LIST MISSES
 * ---------------------------------------------------------------------------
 *
 * One organisation, one territory subtree, three signable accounts (an MR, their
 * field_manager, an admin), doctors in the MR's territory, today's visits in a mix of
 * states, and a beat plan.
 *
 * Derived from what the screens and the server actually read, not from a wish list:
 *
 *   1. **CLINIC ADDRESSES.** `Doctor.clinicAddresses` is required by the contract, the
 *      doctors list renders `clinicAddresses[0].city`, and `visit/[id].tsx` matches
 *      `visit.clinicAddressId` against them. A doctor without one renders a blank card.
 *      `record_check_in` also measures the geofence from it.
 *
 *   2. **BEAT PLAN ENTRIES.** `BeatPlan` requires `entries` (see `sync/pull.ts`), and the
 *      doctors tab calls `listBeatPlans()`. A plan with no entries fails to parse.
 *
 *   3. **A CONSENT NOTICE FOR THIS ORGANISATION.** BE-W79 made notices tenant-scoped, so
 *      an MR whose organisation has no notice **cannot capture consent at all** --
 *      `capture_consent` raises `22023 no active consent text`. Without this the seed
 *      would unblock four screens and leave the fifth broken in a way that reads as a new
 *      defect. It is `effective_from` a month ago, because a notice effective *now* is not
 *      active for a capture stamped a moment earlier.
 *
 * And a **shift window covering the current time**, or `record_check_in` refuses `45003`
 * before anything else can be tested. It is deliberately wide (04:00-23:59, all seven
 * days) because this dataset exists to be worked on at whatever hour somebody is working.
 *
 * **What it deliberately does NOT create: a UCPMP sample cap.** The samples screen shows
 * "the app is not counting" while the cap is null, and that message is under test. Setting
 * one here would hide it and quietly change what the screen is supposed to prove.
 *
 * ---------------------------------------------------------------------------
 * SAFETY
 * ---------------------------------------------------------------------------
 *
 * Localhost only, refused before a connection is opened, the same rule as
 * `verify-rollbacks.mjs`. Every row is marked `DEMO` in its own name so it can never be
 * mistaken for reference data, and this is **not** `seed-reference-data.mjs`: nothing here
 * describes a real doctor, a real clinic or a real organisation, and none of it should
 * ever be used as if it did.
 *
 * Usage, from the repository root with the local stack up:
 *
 *   pnpm --filter @fieldforce/api seed:day
 *   pnpm --filter @fieldforce/api seed:day -- --email me@example.test --password whatever
 *   pnpm --filter @fieldforce/api seed:day -- --another   # a SECOND tenant, on purpose
 */

export const DEMO_MARKER = 'DEMO';

const LOCALHOST_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * Pure, so the refusal is testable without a remote database.
 *
 * This writes a fabricated organisation, fabricated doctors and fabricated visits. Against
 * a real deployment that is contamination of exactly the kind `seed-reference-data.mjs`
 * refuses to risk, and a rule for a human to follow is not a guard.
 */
export const assertLocalhostOnly = (dbUrl) => {
  let host;
  try {
    host = new URL(dbUrl).hostname.replace(/^\[|\]$/g, '');
  } catch {
    throw new Error(`seed:day refuses to run: could not parse database URL "${dbUrl}".`);
  }
  if (!LOCALHOST_HOSTS.has(host)) {
    throw new Error(
      `seed:day refuses to run against host "${host}". It writes fabricated doctors, ` +
        'clinics and visits, which must never reach a deployment. Only 127.0.0.1, ::1 or ' +
        'localhost are allowed.',
    );
  }
};

/** Today at a given local hour, as a timestamptz the server will accept. */
const todayAt = (hour, minute = 0) => {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

const DOCTORS = [
  { name: 'Dr Asha Deshpande', spec: 'Urology', city: 'Pune', line1: '12 FC Road', pin: '411004' },
  { name: 'Dr Vikram Rao', spec: 'Nephrology', city: 'Pune', line1: '48 JM Road', pin: '411005' },
  { name: 'Dr Meera Iyer', spec: 'Urology', city: 'Pune', line1: '3 Baner Road', pin: '411045' },
];

export const seedDay = async (options = {}) => {
  const runId = randomUUID().slice(0, 8);
  const apiUrl = options.apiUrl ?? process.env.SUPABASE_URL ?? DEFAULT_API_URL;
  const dbUrl = options.dbUrl ?? process.env.SUPABASE_DB_URL ?? DEFAULT_DB_URL;
  const serviceRoleKey =
    options.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? DEFAULT_SERVICE_ROLE_KEY;

  assertLocalhostOnly(dbUrl);

  const email = options.email ?? `demo-${runId}-mr@example.test`;
  const password = options.password ?? `demo-password-${runId}`;
  const managerEmail = `demo-${runId}-manager@example.test`;
  const adminEmail = `demo-${runId}-admin@example.test`;

  const probe = new Client({ connectionString: dbUrl });
  await probe.connect();
  try {
    // Checked BEFORE any identity is minted. The first version connected after
    // `createAuthUser`, so a refused run still left three orphan auth users behind --
    // a refusal that costs something is not a clean refusal.
    const probe = new Client({ connectionString: dbUrl });
    await probe.connect();
    try {
      // **B3. A second run REFUSES rather than quietly building a second tenant.**
      //
      // Not idempotent, and it cannot be: each run mints fresh auth identities, and there is
      // no "the demo MR" to converge on. So the choice is between accumulating silently and
      // saying so, and accumulating silently is how a database ends up with five demo
      // organisations, fifteen demo doctors and no way to tell which MR belongs to which day.
      //
      // `--another` is the escape hatch, because a second tenant is exactly what you want
      // when testing the organisation boundary MR-06 built.
      if (!options.another) {
        const existing = await probe.query(
          `select o.name, p.id
           from public.organisations o
           left join public.user_profiles p
           on p.organisation_id = o.id and p.role = 'mr'
          where o.name like $1
          order by o.name`,
          [`${DEMO_MARKER}%`],
        );
        if (existing.rows.length > 0) {
          const names = existing.rows.map((r) => `  ${r.name}`).join('\n');
          throw new Error(
            `seed:day has already run against this database.\n\n` +
              `  Existing demo organisations:\n${names}\n\n` +
              `  Running again would add another tenant and leave no way to tell which MR\n` +
              `  belongs to which day. Choose one:\n\n` +
              `  pnpm db:reset && pnpm --filter @fieldforce/api seed:day   # start clean\n` +
              `  pnpm --filter @fieldforce/api seed:day -- --another     # a SECOND tenant,\n` +
              `                                # on purpose\n`,
          );
        }
      }
    } finally {
      await probe.end();
    }
  } finally {
    await probe.end();
  }

  // Identities first: user_profiles has an FK onto auth.users. Sequentially, because a
  // burst of concurrent GoTrue admin calls exhausts the local Postgres connection pool --
  // the failure MR-07 spent a while diagnosing as "Database error creating new user".
  const mrId = await createAuthUser(email, password, { apiUrl, serviceRoleKey });
  const managerId = await createAuthUser(managerEmail, password, { apiUrl, serviceRoleKey });
  const adminId = await createAuthUser(adminEmail, password, { apiUrl, serviceRoleKey });

  const ids = {
    organisation: randomUUID(),
    regionTerritory: randomUUID(),
    areaTerritory: randomUUID(),
    beatPlan: randomUUID(),
    consentTextVersion: randomUUID(),
    doctors: DOCTORS.map(() => randomUUID()),
    clinics: DOCTORS.map(() => randomUUID()),
    visits: DOCTORS.map(() => randomUUID()),
  };

  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    await client.query('begin');

    await client.query('insert into public.organisations (id, name) values ($1, $2)', [
      ids.organisation,
      `${DEMO_MARKER} Pharma ${runId}`,
    ]);

    // A subtree rather than a single territory, so a field_manager has something to
    // manage and the console has a shape to render.
    await client.query(
      `insert into public.territories (id, name, code, parent_id, organisation_id) values
         ($1, $3, $5, null, $7),
         ($2, $4, $6, $1,  $7)`,
      [
        ids.regionTerritory,
        ids.areaTerritory,
        `${DEMO_MARKER} West`,
        `${DEMO_MARKER} Pune`,
        `DEMO-W-${runId}`,
        `DEMO-W-PUN-${runId}`,
        ids.organisation,
      ],
    );

    // The admin has no territory, so it must name its organisation -- MR-06 made that
    // explicit rather than leaving an administrator with no tenant.
    await client.query(
      `insert into public.user_profiles (id, full_name, role, territory_id, organisation_id)
       values ($1, $2, 'admin', null, $3)`,
      [adminId, `${DEMO_MARKER} Admin`, ids.organisation],
    );
    await client.query(
      `insert into public.user_profiles (id, full_name, role, territory_id)
       values ($1, $2, 'field_manager', $3)`,
      [managerId, `${DEMO_MARKER} Manager`, ids.regionTerritory],
    );
    await client.query(
      `insert into public.user_profiles (id, full_name, role, territory_id, reporting_manager_id)
       values ($1, $2, 'mr', $3, $4)`,
      [mrId, `${DEMO_MARKER} MR`, ids.areaTerritory, managerId],
    );

    // Wide on purpose: this dataset exists to be worked on at whatever hour somebody is
    // working, and a check-in refused 45003 blocks every write path behind it.
    await client.query(
      `insert into public.territory_shift_windows
         (territory_id, shift_start, shift_end, timezone, grace_minutes, active_weekdays)
       values ($1, '04:00', '23:59', 'Asia/Kolkata', 30, '{1,2,3,4,5,6,7}')`,
      [ids.regionTerritory],
    );

    // BE-W79: tenant-scoped. Without this the MR cannot capture consent at all.
    // `effective_from` a month back, because a notice effective *now* is not active for a
    // capture stamped a moment earlier.
    await client.query(
      `insert into public.consent_text_versions
         (id, version_label, language, full_text, effective_from, organisation_id)
       values ($1, $2, 'en-IN', $3, now() - interval '30 days', $4)`,
      [
        ids.consentTextVersion,
        `${DEMO_MARKER} v1 ${runId}`,
        'I agree to this conversation being recorded so that the representative’s team can ' +
          'review how they presented. The recording is kept for 90 days and then deleted. ' +
          'I may withdraw at any time by telling the representative.',
        ids.organisation,
      ],
    );

    for (const [i, doctor] of DOCTORS.entries()) {
      await client.query(
        `insert into public.doctors
           (id, organisation_id, full_name, registration_number, specialty, qualification,
            territory_id, assigned_mr_id)
         values ($1, $2, $3, $4, $5, 'MBBS, MS', $6, $7)`,
        [
          ids.doctors[i],
          ids.organisation,
          `${doctor.name} (${DEMO_MARKER})`,
          `DEMO-${runId}-${String(i + 1).padStart(3, '0')}`,
          doctor.spec,
          ids.areaTerritory,
          mrId,
        ],
      );
      await client.query(
        `insert into public.clinic_addresses
           (id, doctor_id, label, line1, city, state, postal_code, latitude, longitude)
         values ($1, $2, 'Main clinic', $3, $4, 'Maharashtra', $5, 18.5204, 73.8567)`,
        [ids.clinics[i], ids.doctors[i], doctor.line1, doctor.city, doctor.pin],
      );
    }

    await client.query(
      `insert into public.beat_plans (id, mr_id, territory_id, plan_date, status)
       values ($1, $2, $3, current_date, 'submitted')`,
      [ids.beatPlan, mrId, ids.areaTerritory],
    );
    for (const [i] of DOCTORS.entries()) {
      await client.query(
        `insert into public.beat_plan_entries
           (id, beat_plan_id, doctor_id, clinic_address_id, planned_sequence)
         values ($1, $2, $3, $4, $5)`,
        [randomUUID(), ids.beatPlan, ids.doctors[i], ids.clinics[i], i + 1],
      );
    }

    // A mix the Today screen can actually render: two behind them, one still to do.
    // `completed_at` is in the past for both finished visits, which the new `visits_validate`
    // trigger requires -- a visit cannot have been completed in the future.
    const visitRows = [
      { status: 'completed', started: todayAt(9, 30), completed: todayAt(10, 15) },
      { status: 'completed', started: todayAt(11, 0), completed: todayAt(11, 40) },
      { status: 'planned', started: null, completed: null },
    ];
    for (const [i, row] of visitRows.entries()) {
      await client.query(
        `insert into public.visits
           (id, mr_id, doctor_id, beat_plan_id, clinic_address_id, status, scheduled_for,
            started_at, completed_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          ids.visits[i],
          mrId,
          ids.doctors[i],
          ids.beatPlan,
          ids.clinics[i],
          row.status,
          todayAt(9 + i * 2),
          row.started,
          row.completed,
        ],
      );
    }

    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }

  return {
    runId,
    email,
    password,
    managerEmail,
    adminEmail,
    organisationId: ids.organisation,
    territoryId: ids.areaTerritory,
    doctorIds: ids.doctors,
    visitIds: ids.visits,
    consentTextVersionId: ids.consentTextVersion,
  };
};

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());

if (isMain) {
  const args = process.argv.slice(2);
  const valueOf = (flag) => {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
  };
  const options = {};
  const email = valueOf('--email');
  const password = valueOf('--password');
  if (email !== undefined) options.email = email;
  if (password !== undefined) options.password = password;
  if (args.includes('--another')) options.another = true;

  seedDay(options)
    .then((result) => {
      process.stdout.write(
        `\n  A DEMO day, in Supabase. Not reference data, and not for a pilot.\n\n` +
          `  MR:       ${result.email}\n` +
          `  Password: ${result.password}\n` +
          `  Manager:  ${result.managerEmail}\n` +
          `  Admin:    ${result.adminEmail}\n\n` +
          `  Organisation ${result.organisationId}\n` +
          `  ${String(result.doctorIds.length)} doctors, ${String(result.visitIds.length)} visits today, one consent notice.\n\n` +
          `  Every run mints fresh accounts and a fresh organisation; nothing is torn\n` +
          `  down, because consent_records and audit_log are append-only by trigger.\n` +
          `  \`pnpm db:reset\` clears the accumulation.\n\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(
        `seed:day failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
