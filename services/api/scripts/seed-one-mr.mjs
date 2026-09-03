import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

/**
 * Mints one signed-in-able MR against a local Supabase stack, and prints the
 * credentials.
 *
 * **Why this is self-contained rather than a two-line call into the test
 * fixtures.** It used to be exactly that — `import { seedFixtures } from
 * '../tests/fixtures.js'` — and it had never run. `fixtures.ts` is TypeScript
 * written for NodeNext, so its own imports carry `.js` specifiers that only the
 * compiler rewrites; Node strips the types but resolves `./auth.js` literally,
 * finds nothing, and dies with ERR_MODULE_NOT_FOUND before touching the database.
 * There is no build step for `tests/`, no TS loader in this workspace, and no
 * package script pointing at the file. Adding a loader to make one script work
 * would be a dependency the repo does not otherwise need, so the script joins its
 * five siblings instead: plain `.mjs`, `pg`, and `fetch`.
 *
 * **What it deliberately does not reproduce.** `seedFixtures` builds a five-
 * territory world with two managers, doctors, visits, consent records and
 * analyses, because the RLS suite needs an adversarial pair to test against. None
 * of that is reachable from the app: `apps/field` reads its data from the mock API
 * on :4010 and talks to Supabase for authentication only. So this creates the
 * minimum the schema will accept — an organisation, one territory, one auth user,
 * one profile — and nothing that would rot.
 *
 * A territory is not optional padding: `user_profiles_field_roles_require_territory`
 * rejects an `mr` without one, on the stated grounds that a field role with no
 * scope silently means "sees nothing" and reads as a bug.
 *
 * **Every run mints a fresh email**, matching the fixtures' own rule: nothing is
 * torn down, because `consent_records` and `audit_log` are append-only by trigger,
 * so re-runs must not collide. `pnpm db:reset` clears the accumulation.
 *
 * Usage, from the repository root with the local stack up:
 *
 *   pnpm --filter @fieldforce/api seed:mr
 *   pnpm --filter @fieldforce/api seed:mr -- --email me@example.test --password whatever
 *
 * `--email` exists because an unguessable address is the whole reason this script
 * is reached for: somebody wants to sign in on an emulator and type it by hand.
 */

export const DEFAULT_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
export const DEFAULT_API_URL = 'http://127.0.0.1:54321';

/**
 * The local stack's well-known service-role key.
 *
 * Fixed and published by every local Supabase install, not a secret, and it can
 * never reach a deployed environment — `SUPABASE_SERVICE_ROLE_KEY` overrides it,
 * and a remote stack will reject this one outright. `tests/auth.ts` carries the
 * same default for the same reason.
 */
export const DEFAULT_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const ROLES = new Set(['mr', 'field_manager', 'admin']);

export const parseSeedMrArgs = (argv) => {
  const args = { email: undefined, password: undefined, role: 'mr', dbUrl: undefined };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--email' || flag === '--password' || flag === '--role' || flag === '--db-url') {
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${flag} needs a value.`);
      }
      index += 1;
      if (flag === '--email') args.email = value;
      if (flag === '--password') args.password = value;
      if (flag === '--role') args.role = value;
      if (flag === '--db-url') args.dbUrl = value;
      continue;
    }
    throw new Error(`Unrecognised argument: ${String(flag)}`);
  }

  if (!ROLES.has(args.role)) {
    throw new Error(`--role must be one of ${[...ROLES].join(', ')}. Got: ${args.role}`);
  }
  return args;
};

/**
 * Creates the auth user through GoTrue's admin API rather than inserting into
 * `auth.users` directly.
 *
 * A hand-written row gets the password hashing, the identity row and the
 * confirmation state wrong in ways that only show up as an unexplained
 * "Invalid login credentials" at the sign-in screen. `email_confirm: true` because
 * a local stack has no mail delivery and an unconfirmed user cannot sign in.
 */
export const createAuthUser = async (email, password, { apiUrl, serviceRoleKey }) => {
  const response = await fetch(`${apiUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const payload = await response.json();
  if (!response.ok || typeof payload?.id !== 'string') {
    throw new Error(
      `admin create user failed (${String(response.status)}): ${JSON.stringify(payload)}`,
    );
  }
  return payload.id;
};

export const seedOneMr = async (options = {}) => {
  const runId = randomUUID().slice(0, 8);
  const role = options.role ?? 'mr';
  const email = options.email ?? `seed-${runId}-${role.replace('_', '-')}@example.test`;
  const password = options.password ?? `seed-password-${runId}`;
  const apiUrl = options.apiUrl ?? process.env.SUPABASE_URL ?? DEFAULT_API_URL;
  const dbUrl = options.dbUrl ?? process.env.SUPABASE_DB_URL ?? DEFAULT_DB_URL;
  const serviceRoleKey =
    options.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? DEFAULT_SERVICE_ROLE_KEY;

  // The auth user first: user_profiles has an FK onto auth.users, so the profile
  // cannot exist before the identity it belongs to.
  const userId = await createAuthUser(email, password, { apiUrl, serviceRoleKey });

  const organisationId = randomUUID();
  const territoryId = randomUUID();

  const client = new Client({ connectionString: dbUrl, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    await client.query('begin');
    await client.query('insert into public.organisations (id, name) values ($1, $2)', [
      organisationId,
      `Seed Pharma ${runId}`,
    ]);
    await client.query(
      `insert into public.territories (id, name, code, parent_id, organisation_id)
       values ($1, $2, $3, null, $4)`,
      [territoryId, `Seed Territory ${runId}`, `SEED-${runId}`, organisationId],
    );
    await client.query(
      `insert into public.user_profiles (id, full_name, role, territory_id)
       values ($1, $2, $3, $4)`,
      // An admin legitimately has no territory; the check constraint requires one
      // for every other role.
      [userId, `Seed ${role} ${runId}`, role, role === 'admin' ? null : territoryId],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }

  return { runId, userId, email, password, role, organisationId, territoryId };
};

/**
 * Proves the credential before printing it.
 *
 * The failure this catches is the one worth catching: a profile row that violates
 * nothing, an auth user that exists, and a sign-in that still fails because the
 * access-token hook could not build claims. Printing an address that does not work
 * sends whoever ran this to debug the app instead of the seed.
 */
export const verifySignIn = async (email, password, { apiUrl, serviceRoleKey }) => {
  const response = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: serviceRoleKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const payload = await response.json();
  if (!response.ok || typeof payload?.access_token !== 'string') {
    throw new Error(
      `sign-in check failed (${String(response.status)}): ${JSON.stringify(payload)}`,
    );
  }
  return payload.access_token;
};

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('seed-one-mr.mjs')
) {
  let args;
  try {
    args = parseSeedMrArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const apiUrl = process.env.SUPABASE_URL ?? DEFAULT_API_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? DEFAULT_SERVICE_ROLE_KEY;

  try {
    const seeded = await seedOneMr({
      ...(args.email === undefined ? {} : { email: args.email }),
      ...(args.password === undefined ? {} : { password: args.password }),
      ...(args.dbUrl === undefined ? {} : { dbUrl: args.dbUrl }),
      role: args.role,
      apiUrl,
      serviceRoleKey,
    });

    await verifySignIn(seeded.email, seeded.password, { apiUrl, serviceRoleKey });

    console.log(
      [
        '',
        `  Email:    ${seeded.email}`,
        `  Password: ${seeded.password}`,
        `  Role:     ${seeded.role}`,
        '',
        '  Sign-in verified against GoTrue. Nothing is torn down — `pnpm db:reset`',
        '  clears accumulated seeds.',
        '',
      ].join('\n'),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error('\nIs the local stack up? `pnpm db:start` from the repository root.');
    process.exit(1);
  }
}
