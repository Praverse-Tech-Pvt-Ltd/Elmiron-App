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

/**
 * A given local hour on a day, for `scheduled_for` and NOTHING ELSE.
 *
 * `validate_visit` deliberately leaves `scheduled_for` unbounded -- "a beat plan schedules
 * visits ahead of time, so a future value there is the feature rather than a defect".
 *
 * (`todayAt(hour)` stood here and is gone: with every row now naming its own day offset,
 * a today-only helper had no callers, and an unused helper is the thing this repository
 * keeps finding.)
 */
/**
 * A given local hour on a day OFFSET from today — MR-15 B3.
 *
 * **This exists because `seed:day` had the same blind spot as the mock it replaced.**
 * Every visit it created was today's, so the fixture held exactly ONE value of the date
 * dimension — and a fixture holding one value of a dimension cannot test any predicate on
 * that dimension. Nothing filtered visits by date anywhere in the app, and neither the
 * mock nor this seed could reveal it; it took running the app on a second day. The seed
 * written to unblock the read conversion could not surface the defect that conversion
 * exposed.
 *
 * `setDate` handles month and year ends: `new Date(2026, 0, 1).setDate(0)` is 31 December.
 */
const dayAt = (dayOffset, hour, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

/**
 * A moment in the past, measured from the clock rather than from the calendar.
 *
 * **`dayAt` must never be used for `started_at` or `completed_at`.** `validate_visit`
 * bounds both against `now()` plus the device-clock tolerance, so a fixed local hour is in
 * the FUTURE for every runner whose day has not reached it yet. It passed for weeks
 * because it was only ever run in the IST afternoon, where 09:30 is behind you.
 *
 * The comment that used to sit above `visitRows` already said `completed_at` is in the
 * past for both finished visits -- naming the requirement immediately above the code that
 * broke it. CI run `34326262244` failed with `45007`, `started_at 2026-09-09 09:30:00+00
 * is more than 120 seconds after the server clock 2026-09-09 07:56:43+00`. **A lesson in a
 * comment is not a control.** Deriving the value from `now` is the control, because there
 * is no longer an hour at which it can be wrong.
 */
const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

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
    consentTextVersion: randomUUID(),
    doctors: DOCTORS.map(() => randomUUID()),
    clinics: DOCTORS.map(() => randomUUID()),
    // [0] is yesterday's unplanned visit, made here; [1..4] are filled from the plans' visits.
    visits: [randomUUID(), null, null, null, null],
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

    // `BE-C78` (`20261009000200`). Today's and tomorrow's work comes from the MANAGER's plan --
    // `write_plan_version`, the one path `plan_mr_day` uses and the only one that may create a
    // planned visit. Written as the owner, because a seed is not a signed-in manager; the plan is
    // still the manager's (`planned_by_user_id`) and approved, as `plan_mr_day` writes it.
    //
    // THREE DAYS, NOT ONE -- MR-15 B3.
    //
    // Today is still what the screen is about: two visits behind the MR, one still to do.
    // Yesterday and tomorrow exist so that a missing or wrong date filter is VISIBLE ON
    // SCREEN rather than only in a test:
    //
    //   * yesterday's COMPLETED visit inflates "done" and makes the doctor list claim the
    //     MR saw that doctor today;
    //   * tomorrow's PLANNED visit becomes "Next visit" and puts a clinic a day early
    //     behind the screen's single primary action.
    //
    // Both are the failure MR-14 shipped and MR-15 fixed, and neither could be produced by
    // a seed that only ever wrote today.
    //
    // Every clock-bounded column is still placed RELATIVE TO NOW, not at a wall-clock
    // hour, because `visits_validate` bounds `started_at` and `completed_at` against the
    // server clock -- the defect that failed CI run 34326262244. `scheduled_for` is the
    // only column that carries the calendar day, and it is deliberately unbounded: "a beat
    // plan schedules visits ahead of time, so a future value there is the feature".
    const planDay = async (dayOffset, doctorIndexes) => {
      await client.query(
        `select public.write_plan_version(m, r, public.rep_today(r.id) + $3::int, $4::jsonb, null)
           from public.user_profiles m, public.user_profiles r
          where m.id = $1 and r.id = $2`,
        [
          managerId,
          mrId,
          dayOffset,
          JSON.stringify(
            doctorIndexes.map((i) => ({
              doctorId: ids.doctors[i],
              clinicAddressId: ids.clinics[i],
            })),
          ),
        ],
      );
    };
    const plannedVisit = async (dayOffset, doctorIndex) => {
      const result = await client.query(
        `select id from public.visits
          where mr_id = $1 and doctor_id = $2 and origin = 'planned' and status <> 'cancelled'
            and planned_date = public.rep_today($1) + $3::int`,
        [mrId, ids.doctors[doctorIndex], dayOffset],
      );
      return result.rows[0].id;
    };
    /** The plan made the visit; the day happened to it. Owner writes, as a finished day's sync would. */
    const happened = async (visitId, row) => {
      await client.query(
        `update public.visits
            set scheduled_for = $2, status = $3, started_at = $4, completed_at = $5
          where id = $1`,
        [visitId, dayAt(row.day, row.hour), row.status, row.started, row.completed],
      );
    };

    // Yesterday: a visit the MR made without a plan -- UNPLANNED, with its reason.
    await client.query(
      `insert into public.visits
         (id, mr_id, doctor_id, clinic_address_id, status, scheduled_for, started_at, completed_at,
          origin, unplanned_reason)
       values ($1, $2, $3, $4, 'completed', $5, $6, $7, 'unplanned', 'Doctor asked for a follow-up')`,
      [
        ids.visits[0],
        mrId,
        ids.doctors[0],
        ids.clinics[0],
        dayAt(-1, 11),
        minutesAgo(24 * 60 + 150),
        minutesAgo(24 * 60 + 105),
      ],
    );

    // Today: the plan of all three doctors, in route order; two done, one still to do.
    await planDay(
      0,
      DOCTORS.map((_, i) => i),
    );
    const today = [
      {
        doctor: 1,
        day: 0,
        hour: 9,
        status: 'completed',
        started: minutesAgo(150),
        completed: minutesAgo(105),
      },
      {
        doctor: 2,
        day: 0,
        hour: 11,
        status: 'completed',
        started: minutesAgo(90),
        completed: minutesAgo(50),
      },
      { doctor: 0, day: 0, hour: 13, status: 'planned', started: null, completed: null },
    ];
    for (const row of today) {
      const visitId = await plannedVisit(0, row.doctor);
      await happened(visitId, row);
      ids.visits[ids.visits.indexOf(null)] = visitId;
    }

    // Tomorrow: its own plan, so the visit a day early is a REAL planned visit.
    await planDay(1, [1]);
    const tomorrow = await plannedVisit(1, 1);
    await happened(tomorrow, {
      day: 1,
      hour: 10,
      status: 'planned',
      started: null,
      completed: null,
    });
    ids.visits[ids.visits.indexOf(null)] = tomorrow;

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
          `  ${String(result.doctorIds.length)} doctors, ${String(result.visitIds.length)} visits across THREE days -- 1 yesterday, 3 today, 1 tomorrow.
` +
          `  One consent notice.\n\n` +
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
