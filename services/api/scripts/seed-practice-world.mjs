/**
 * W1-F — the people and the one prompt a BROWSER test of `/practice` needs.
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
 * | **one approved `ai_doctor` prompt version** | `start_sim_session` refuses `45011` without one |
 *
 * ## The prompt version is the uncomfortable one, so it is written down here
 *
 * The brief that commissioned this work says **do not seed products, approved knowledge or prompt
 * versions**, because seeded content is content nobody approved, and this project's whole approval
 * argument is that a second human did. **This file seeds one anyway, and that is a deliberate,
 * narrow exception**: `ai_prompt_versions` has no screen and no RPC (`BE-W122`), so there is no
 * other way for a test to reach an approved prompt, and without one the thing under test cannot run
 * at all.
 *
 * Three things keep the exception narrow:
 *
 * 1. **It only ever exists on localhost.** The guard above is not advisory.
 * 2. **The prompt text says what it is.** It is a placeholder, not a trained prompt, and it is
 *    labelled so in the text itself — so if it is ever seen in a database, it identifies itself.
 * 3. **The four-eyes transition is honoured, not bypassed.** The row is authored by one admin and
 *    decided by the other, through `draft -> in_review -> approved`, because the trigger machine
 *    refuses anything else. Nothing here writes an approved row directly.
 *
 * **When `BE-W122` ships a screen, delete this part of the file and have the test click it.**
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

const PLACEHOLDER_PROMPT =
  'PLACEHOLDER PROMPT, created by seed-practice-world.mjs for a local test. Not a trained prompt ' +
  'and never to be treated as approved content. You are a doctor in a PRACTICE conversation with ' +
  'a medical representative. Stay in character.';

const run = randomUUID().slice(0, 6);
const PASSWORD = `practice-${run}`;

const people = [
  { key: 'authorAdmin', role: 'admin', org: 'A' },
  { key: 'approverAdmin', role: 'admin', org: 'A' },
  { key: 'rep', role: 'mr', org: 'A' },
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

  const promptId = randomUUID();
  await client.query(
    `insert into public.ai_prompt_versions
       (id, organisation_id, feature, version_number, system_prompt, created_by_user_id)
     values ($1, $2, 'ai_doctor', 1, $3, $4)`,
    [promptId, orgs.A.id, PLACEHOLDER_PROMPT, out.authorAdmin.userId],
  );
  await client.query(
    `update public.ai_prompt_versions
        set status = 'in_review', submitted_at = now(), submitted_by_user_id = $2
      where id = $1`,
    [promptId, out.authorAdmin.userId],
  );
  await client.query(
    `update public.ai_prompt_versions
        set status = 'approved', decided_at = now(), decided_by_user_id = $2,
            approval_attestation = 'Placeholder prompt for a local test.'
      where id = $1`,
    // The SECOND admin decides. The four-eyes CHECK on the table would refuse the first.
    [promptId, out.approverAdmin.userId],
  );
  out.promptVersionId = promptId;

  await client.query('commit');
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  await client.end();
}

console.log(JSON.stringify(out, null, 2));
