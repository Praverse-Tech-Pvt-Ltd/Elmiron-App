import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

/**
 * BE-W17 — synthetic volume for performance work. **Not reference data.**
 *
 * This exists to answer two questions nobody can answer on an empty stack: whether
 * `visible_territory_ids` — a recursive CTE — still returns a doctor search in under
 * three seconds at pilot scale, and what `sync_push` does at real concurrency. Neither
 * shows up until there is a year of history behind a hundred MRs.
 *
 * **This is not `seed-reference-data.mjs` and must never be mistaken for it.** That
 * script seeds the real organisations, territories, doctors and consent text a pilot
 * runs on, and it is blocked on the client supplying them (B11). This one invents
 * everything, labels all of it `SYNTHETIC`, and would be actively harmful in a real
 * database: an MR would see doctors who do not exist, and a territory tree nobody
 * agreed to.
 *
 * **The accounts it creates cannot sign in.** `auth.users` rows are inserted directly
 * with no password hash, because a hundred round trips through GoTrue's admin API to
 * produce logins nobody will use is a slow way to build a fixture. If you want a user
 * you can actually sign in as, that is `seed:mr`, which exists for exactly that and
 * gets the hashing, the identity row and the confirmation state right.
 *
 * Localhost only, enforced in code with no escape hatch, for the same reason
 * `verify:rollbacks` is: a rule a human has to remember is not a control. There is no
 * `--force`.
 *
 * Usage, from the repository root with the local stack up:
 *
 *   pnpm --filter @fieldforce/api seed:synthetic
 *   pnpm --filter @fieldforce/api seed:synthetic --mrs 100 --history 1y
 *   pnpm --filter @fieldforce/api seed:synthetic --mrs 10 --history 30d
 *
 * Re-running refuses rather than doubling the dataset. `pnpm db:reset` clears it.
 */

export const DEFAULT_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** Everything this script creates carries this marker, so it can be recognised. */
export const SYNTHETIC_MARKER = 'SYNTHETIC';

const LOCALHOST_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * Refuses before a connection is opened if the target is not local.
 *
 * @param {string} dbUrl
 */
export const assertLocalhostOnly = (dbUrl) => {
  let host;
  try {
    host = new URL(dbUrl).hostname.replace(/^\[|\]$/g, '');
  } catch {
    throw new Error(`seed:synthetic refuses to run: could not parse database URL "${dbUrl}".`);
  }
  if (!LOCALHOST_HOSTS.has(host)) {
    throw new Error(
      `seed:synthetic refuses to run against host "${host}". ` +
        'It writes hundreds of thousands of invented rows — doctors who do not exist, ' +
        'territories nobody agreed to — and is only ever allowed against 127.0.0.1, ::1 ' +
        'or localhost. This is not reference data. There is no --force.',
    );
  }
};

/**
 * `1y`, `180d`, `52w`. Returns whole days.
 *
 * @param {string} value
 * @returns {number}
 */
export const parseHistoryDays = (value) => {
  const m = /^(\d+)([dwy])$/.exec(value.trim());
  if (m === null) {
    throw new Error(`--history must look like 1y, 26w or 180d. Got: ${value}`);
  }
  const n = Number(m[1]);
  if (n <= 0) throw new Error('--history must be positive.');
  return m[2] === 'y' ? n * 365 : m[2] === 'w' ? n * 7 : n;
};

export const parseSeedSyntheticArgs = (argv) => {
  const args = { mrs: 100, history: '1y', dbUrl: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--mrs' || flag === '--history' || flag === '--db-url') {
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${flag} needs a value.`);
      }
      i += 1;
      if (flag === '--mrs') args.mrs = Number(value);
      if (flag === '--history') args.history = value;
      if (flag === '--db-url') args.dbUrl = value;
      continue;
    }
    throw new Error(`Unrecognised argument: ${String(flag)}`);
  }
  if (!Number.isInteger(args.mrs) || args.mrs <= 0) {
    throw new Error(`--mrs must be a positive integer. Got: ${String(args.mrs)}`);
  }
  parseHistoryDays(args.history);
  return args;
};

/**
 * Roles seeded, and why there are three rather than the nine a pilot will need.
 *
 * `app_role` has exactly three values today — `mr`, `field_manager`, `admin`. The
 * clinical roles (urologist, gynaecologist, patient, pv_officer) and `marketing` do
 * not exist in the schema because S6 and S7 are blocked on the data-controller model.
 * Seeding users of roles the enum does not have is not possible, and pretending
 * otherwise would produce a fixture that lies about what the system can express.
 */
export const SEEDED_ROLES = ['mr', 'field_manager', 'admin'];

const sql = String.raw;

/**
 * @param {import('pg').Client} client
 * @returns {Promise<boolean>}
 */
export const alreadySeeded = async (client) => {
  const { rows } = await client.query(
    `select count(*)::int as n from public.organisations where name like $1`,
    [`${SYNTHETIC_MARKER}%`],
  );
  return (rows[0]?.n ?? 0) > 0;
};

export const seedSynthetic = async (options = {}) => {
  const mrs = options.mrs ?? 100;
  const historyDays = parseHistoryDays(options.history ?? '1y');
  const dbUrl = options.dbUrl ?? process.env.SUPABASE_DB_URL ?? DEFAULT_DB_URL;

  assertLocalhostOnly(dbUrl);

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  try {
    if (await alreadySeeded(client)) {
      throw new Error(
        'seed:synthetic refuses: this database already contains a SYNTHETIC organisation. ' +
          'Running again would double the dataset and quietly invalidate any measurement ' +
          'taken against it. Run `pnpm db:reset` first.',
      );
    }

    const runId = randomUUID().slice(0, 8);
    const orgId = randomUUID();
    const managersPerRegion = 1;
    const regions = Math.max(1, Math.ceil(mrs / 25));
    const areasPerRegion = 5;

    await client.query('begin');

    // --- organisation and a three-level territory tree ------------------------
    await client.query(`insert into public.organisations (id, name) values ($1, $2)`, [
      orgId,
      `${SYNTHETIC_MARKER} Fixture Org ${runId}`,
    ]);

    const rootId = randomUUID();
    await client.query(
      `insert into public.territories (id, name, code, organisation_id) values ($1,$2,$3,$4)`,
      [rootId, `${SYNTHETIC_MARKER} National`, `SYN-${runId}-NAT`, orgId],
    );

    await client.query(
      sql`insert into public.territories (id, name, code, organisation_id, parent_id)
          select gen_random_uuid(),
                 $1 || ' Region ' || g,
                 'SYN-' || $2 || '-R' || g,
                 $3, $4
            from generate_series(1, $5) g`,
      [SYNTHETIC_MARKER, runId, orgId, rootId, regions],
    );

    await client.query(
      sql`insert into public.territories (id, name, code, organisation_id, parent_id)
          select gen_random_uuid(),
                 t.name || ' Area ' || a,
                 t.code || '-A' || a,
                 $1, t.id
            from public.territories t
            cross join generate_series(1, $2) a
           where t.parent_id = $3`,
      [orgId, areasPerRegion, rootId],
    );

    // Shift windows on regions. Areas inherit by walking up the tree, which is the
    // path `effective_shift_window` actually takes and therefore the one worth
    // measuring.
    await client.query(
      sql`insert into public.territory_shift_windows (territory_id, shift_start, shift_end)
          select t.id, time '09:00', time '18:00'
            from public.territories t where t.parent_id = $1`,
      [rootId],
    );

    // --- users ---------------------------------------------------------------
    // auth.users first: user_profiles.id references it. Only `id` is required.
    await client.query(
      sql`insert into auth.users (id, email)
          select gen_random_uuid(), 'synthetic-' || $1 || '-' || g || '@example.test'
            from generate_series(1, $2) g`,
      [runId, mrs + regions * managersPerRegion + 1],
    );

    const { rows: authRows } = await client.query(
      `select id from auth.users where email like $1 order by email`,
      [`synthetic-${runId}-%`],
    );
    const ids = authRows.map((r) => r.id);

    const { rows: areaRows } = await client.query(
      sql`select t.id from public.territories t
            join public.territories r on r.id = t.parent_id
           where r.parent_id = $1 order by t.code`,
      [rootId],
    );
    const areaIds = areaRows.map((r) => r.id);

    const adminId = ids[0];
    const managerIds = ids.slice(1, 1 + regions * managersPerRegion);
    const mrIds = ids.slice(1 + managerIds.length);

    await client.query(
      `insert into public.user_profiles (id, full_name, role, territory_id) values ($1,$2,'admin',$3)`,
      [adminId, `${SYNTHETIC_MARKER} Admin`, rootId],
    );

    const { rows: regionRows } = await client.query(
      `select id from public.territories where parent_id = $1 order by code`,
      [rootId],
    );
    for (const [i, id] of managerIds.entries()) {
      await client.query(
        `insert into public.user_profiles (id, full_name, role, territory_id)
         values ($1,$2,'field_manager',$3)`,
        [
          id,
          `${SYNTHETIC_MARKER} Manager ${String(i + 1).padStart(3, '0')}`,
          regionRows[i % regionRows.length].id,
        ],
      );
    }

    for (const [i, id] of mrIds.entries()) {
      await client.query(
        `insert into public.user_profiles (id, full_name, role, territory_id, reporting_manager_id)
         values ($1,$2,'mr',$3,$4)`,
        [
          id,
          `${SYNTHETIC_MARKER} MR ${String(i + 1).padStart(4, '0')}`,
          areaIds[i % areaIds.length],
          managerIds[i % managerIds.length],
        ],
      );
    }

    // --- doctors, five per area ----------------------------------------------
    await client.query(
      sql`insert into public.doctors (id, organisation_id, full_name, territory_id)
          select gen_random_uuid(), $1,
                 $2 || ' Doctor ' || t.code || '-' || d,
                 t.id
            from public.territories t
            join public.territories r on r.id = t.parent_id
            cross join generate_series(1, 5) d
           where r.parent_id = $3`,
      [orgId, SYNTHETIC_MARKER, rootId],
    );

    // --- a year of visits and check-ins --------------------------------------
    // Generated set-wise rather than row-by-row: a hundred MRs over a year is
    // hundreds of thousands of rows, and a round trip each would take hours.
    // Weekdays only, eight visits a day, which is the pilot shape BE-W8 sized for:
    // 100 MRs x 8 visits x 22 days a month is the figure the retention design uses.
    await client.query(
      sql`insert into public.visits (id, mr_id, doctor_id)
          select gen_random_uuid(), p.id, d.id
            from public.user_profiles p
            join public.doctors d on d.territory_id = p.territory_id
            cross join generate_series(0, $1 - 1) day_offset
            cross join generate_series(1, 8) slot
           where p.role = 'mr'
             and p.full_name like $2
             and extract(isodow from (current_date - day_offset)) < 6
             and d.id = (
               select d2.id from public.doctors d2
                where d2.territory_id = p.territory_id
                order by d2.id
                offset ((day_offset * 8 + slot) % 5) limit 1)`,
      [historyDays, `${SYNTHETIC_MARKER}%`],
    );

    await client.query(
      sql`insert into public.check_ins
            (id, visit_id, mr_id, latitude, longitude, geofence_status, source, occurred_at)
          select gen_random_uuid(), v.id, v.mr_id,
                 18.5 + (random() / 100), 73.8 + (random() / 100),
                 'inside', 'automatic',
                 v.created_at
            from public.visits v
            join public.user_profiles p on p.id = v.mr_id
           where p.full_name like $1`,
      [`${SYNTHETIC_MARKER}%`],
    );

    // --- beat plans, one per MR per working day ------------------------------
    await client.query(
      sql`insert into public.beat_plans (mr_id, territory_id, plan_date)
          select p.id, p.territory_id, (current_date - g)
            from public.user_profiles p
            cross join generate_series(0, $1 - 1) g
           where p.role = 'mr' and p.full_name like $2
             and extract(isodow from (current_date - g)) < 6`,
      [historyDays, `${SYNTHETIC_MARKER}%`],
    );

    await client.query('commit');

    const counts = {};
    for (const t of [
      'organisations',
      'territories',
      'territory_shift_windows',
      'user_profiles',
      'doctors',
      'visits',
      'check_ins',
      'beat_plans',
    ]) {
      const { rows } = await client.query(`select count(*)::int as n from public.${t}`);
      counts[t] = rows[0].n;
    }

    return { runId, mrs, historyDays, counts };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
};

const isMain = process.argv[1] !== undefined && import.meta.url.endsWith('seed-synthetic.mjs');

if (isMain) {
  try {
    const args = parseSeedSyntheticArgs(process.argv.slice(2));
    const result = await seedSynthetic(args);
    process.stdout.write(
      `\n  ${SYNTHETIC_MARKER} volume seeded — run ${result.runId}\n` +
        `  ${String(result.mrs)} MRs, ${String(result.historyDays)} days of history\n\n` +
        Object.entries(result.counts)
          .map(([t, n]) => `    ${t.padEnd(26)} ${String(n)}`)
          .join('\n') +
        '\n\n  These accounts cannot sign in. Use `seed:mr` for one that can.\n' +
        '  `pnpm db:reset` clears everything above.\n\n',
    );
  } catch (error) {
    process.stderr.write(`\n  ${error instanceof Error ? error.message : String(error)}\n\n`);
    process.exitCode = 1;
  }
}
