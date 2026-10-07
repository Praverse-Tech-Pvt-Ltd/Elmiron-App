/**
 * W1-F/W1-G — the people a BROWSER test of `/practice` and `/prompts` needs.
 *
 * **This is a TEST FIXTURE, not a seeder anybody should run against anything real.** It refuses any
 * target that is not localhost, on both URLs and before either is touched — the same guard
 * `seed-one-mr.mjs` carries and for the same reason (`MR-37 C3`): it mints auth identities and
 * inserts organisations, and a fabricated person inside a real tenant is what `BE-W76` turned out
 * to be.
 *
 * ## What it creates, and why each one is necessary rather than convenient
 *
 * | | Why |
 * | --- | --- |
 * | **two admins in ONE organisation** | four eyes. The database refuses an approval by the author or the submitter, so one admin cannot prove the flow |
 * | **one MR** | only a rep starts a practice session; an admin calling `start_sim_session` proves nothing about the rep's path |
 * | **one admin in a SECOND organisation** | the cross-tenant check. A tenancy assertion with only one tenant in the database is not an assertion |
 * | **one field manager**, in the rep's territory (W2-G B) | `assign_course` admits an admin OR a field manager, each only for people they can see; the manager's half is not proved by an admin |
 * | **a published course and a draft-only course** (W2-G B) | no screen authors courses, so like identities they are what only this script can make; the draft one is what `assign_course` refuses (`22023`) |
 *
 * ## It no longer seeds a prompt, and that is the point of `BE-W122`
 *
 * It used to write an approved `ai_doctor` prompt with three raw SQL statements, because
 * `ai_prompt_versions` had no screen and a test could reach an approved prompt no other way. The
 * file's header apologised for it at length.
 *
 * **W1-G E1 built the screen, so the exception is deleted rather than explained.** The browser
 * suite now creates and approves its prompt the way an operator does — through `/prompts`, as two
 * different admins — which means the fixture and the documented path cannot drift apart.
 *
 * **What is left here is only what no screen can do:** create auth identities and organisations —
 * and, since W2-G, courses, because no screen authors one. Minting a user is a GoTrue admin-API
 * operation and is correctly not exposed to any console.
 *
 * Every run mints a fresh organisation and fresh emails; nothing is torn down, because several of
 * the tables involved are append-only by trigger. `pnpm db:reset` clears the accumulation.
 *
 *   node services/api/scripts/seed-practice-world.mjs > world.json
 */
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import {
  assertLocalhostOnly,
  createAuthUser,
  DEFAULT_API_URL,
  DEFAULT_DB_URL,
  DEFAULT_SERVICE_ROLE_KEY,
} from './seed-one-mr.mjs';

const API = process.env.SUPABASE_URL ?? DEFAULT_API_URL;
const DB = process.env.SUPABASE_DB_URL ?? DEFAULT_DB_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? DEFAULT_SERVICE_ROLE_KEY;

assertLocalhostOnly('API URL', API);
assertLocalhostOnly('database URL', DB);

const run = randomUUID().slice(0, 6);
const PASSWORD = `practice-${run}`;

const people = [
  { key: 'authorAdmin', role: 'admin', org: 'A' },
  { key: 'approverAdmin', role: 'admin', org: 'A' },
  { key: 'rep', role: 'mr', org: 'A' },
  { key: 'manager', role: 'field_manager', org: 'A' },
  { key: 'otherOrgAdmin', role: 'admin', org: 'B' },
];

const client = new Client({ connectionString: DB, connectionTimeoutMillis: 5000 });
await client.connect();

const out = { password: PASSWORD, run };
try {
  await client.query('begin');

  const orgs = {};
  for (const name of ['A', 'B']) {
    const id = randomUUID();
    await client.query('insert into public.organisations (id, name) values ($1, $2)', [
      id,
      `Practice Org ${name} ${run}`,
    ]);
    const territoryId = randomUUID();
    await client.query(
      `insert into public.territories (id, name, code, parent_id, organisation_id)
       values ($1, $2, $3, null, $4)`,
      [territoryId, `Practice T ${name} ${run}`, `PRC-${name}-${run}`, id],
    );
    orgs[name] = { id, territoryId };
  }

  for (const person of people) {
    const email = `${person.key.toLowerCase()}-${run}@example.test`;
    // Through GoTrue's admin API, never a hand-written `auth.users` row: the password hash, the
    // identity row and the confirmation state are what a hand-written row gets wrong, and the only
    // symptom is an unexplained "Invalid login credentials" at the sign-in screen.
    const userId = await createAuthUser(email, PASSWORD, { apiUrl: API, serviceRoleKey: KEY });
    await client.query(
      `insert into public.user_profiles (id, full_name, role, territory_id, organisation_id)
       values ($1, $2, $3, $4, $5)`,
      // An admin legitimately has no territory and must therefore name its organisation; every
      // other role is refused without one (`user_profiles_field_roles_require_territory`).
      [
        userId,
        `${person.key} ${run}`,
        person.role,
        person.role === 'admin' ? null : orgs[person.org].territoryId,
        orgs[person.org].id,
      ],
    );
    out[person.key] = { email, userId, organisationId: orgs[person.org].id };
  }

  // W2-G B — two courses: one published (assignable), one with only a draft (refused by
  // `assign_course` with 22023). Written as rows, as an admin would today (no authoring screen), and
  // published through `publish_course_version` AS the author admin, so the RPC's own rules apply.
  const course = async (title, publish) => {
    const courseId = randomUUID();
    const versionId = randomUUID();
    const moduleId = randomUUID();
    const org = orgs.A.id;
    await client.query(
      'insert into public.courses (id, organisation_id, title) values ($1, $2, $3)',
      [courseId, org, title],
    );
    await client.query(
      'insert into public.course_versions (id, course_id, organisation_id, title) values ($1, $2, $3, $4)',
      [versionId, courseId, org, title],
    );
    await client.query(
      `insert into public.course_modules (id, course_version_id, organisation_id, position, title)
       values ($1, $2, $3, 1, 'Keeping stock')`,
      [moduleId, versionId, org],
    );
    for (const [i, lesson] of ['Cold chain', 'Shelf life'].entries()) {
      await client.query(
        `insert into public.lessons
           (id, module_id, course_version_id, organisation_id, position, title, body, estimated_minutes)
         values ($1, $2, $3, $4, $5, $6, $7, 5)`,
        [
          randomUUID(),
          moduleId,
          versionId,
          org,
          i + 1,
          `${lesson} ${run}`,
          `Synthetic training text about ${lesson.toLowerCase()} for run ${run}. Describes nobody.`,
        ],
      );
    }
    if (publish) {
      await client.query('savepoint publish');
      await client.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({
          sub: out.authorAdmin.userId,
          role: 'authenticated',
          app_role: 'admin',
          app_is_active: true,
        }),
      ]);
      await client.query('set local role authenticated');
      await client.query('select public.publish_course_version($1)', [versionId]);
      await client.query('reset role');
      await client.query('release savepoint publish');
    }
    return { id: courseId, title };
  };
  out.publishedCourse = await course(`Storage basics ${run}`, true);
  out.draftCourse = await course(`Draft only ${run}`, false);

  await client.query('commit');
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  await client.end();
}

console.log(JSON.stringify(out, null, 2));
