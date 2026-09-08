import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase, withClient } from './db.js';
import { asDatabaseRole, asUser, mintAccessToken, rest } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * G-RLS-C — the commercial isolation gate, run as a COMPLETE matrix for the first time.
 *
 * The gate has been claimed since BE-W2 and has never been run whole. Before this file,
 * **no test in this repository created a second organisation at all**: `seedFixtures()`
 * builds one org with a territory tree inside it, so every isolation test ever written
 * checked a subtree boundary and none checked an org boundary.
 *
 * Four roles x two boundaries x five paths. **Every cell is stated as a REFUSAL or an
 * ABSENCE**, never left ambiguous, because the two mean different things to a client:
 * a refusal says "not yours", an absence says "nothing there", and a client that renders
 * the second for the first is the filter-in-the-client defect this project already
 * forbids.
 *
 * A cell returning DATA across a boundary is a compliance-boundary defect. This file
 * fails the build for one.
 *
 * **The second organisation is the SYNTHETIC one.** `seed:synthetic` builds its own org
 * with a hundred MRs and a three-level tree, so the two seeds together give a genuine
 * cross-org pair without inventing a third fixture path that would then need its own
 * cleanup. This suite therefore requires the synthetic seed to have been run:
 *
 *     pnpm --filter @fieldforce/api seed:synthetic --mrs 100 --history 1y
 *     pnpm --filter @fieldforce/api test -- g-rls-c
 *
 * **G-RLS-X is not tested here and is ABSENT rather than passing.** The
 * commercial/clinical boundary needs a clinical schema and clinical roles, and neither
 * exists — S6 and S7 are cut under the default scope option. A gate with nothing to
 * separate is not a gate that passed.
 */

const reachable = await requireDatabase();

/** What a single attempt produced. Never "empty or refused" — one or the other. */
type Cell = 'REFUSAL' | 'ABSENCE' | 'DATA';

interface Target {
  readonly label: string;
  readonly doctorId: string;
  readonly doctorName: string;
  readonly visitId: string | null;
  readonly mrId: string;
}

let world: FixtureWorld;
let otherOrg: Target | null = null;
let otherSubtree: Target | null = null;
let seeded = false;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();

  await withClient(async (client) => {
    // The SYNTHETIC org, from `seed:synthetic`. Its absence is reported rather than
    // skipped over: a matrix that silently tested nothing is worse than one that says it
    // could not run.
    const org = await client.query<{
      doctor_id: string;
      doctor_name: string;
      mr_id: string;
      visit_id: string | null;
    }>(
      `select d.id as doctor_id, d.full_name as doctor_name, p.id as mr_id,
              (select v.id from public.visits v where v.mr_id = p.id limit 1) as visit_id
         from public.user_profiles p
         join public.doctors d on d.territory_id = p.territory_id
        where p.role = 'mr' and p.full_name like 'SYNTHETIC%'
        order by p.full_name
        limit 1`,
    );
    const first = org.rows[0];
    if (first === undefined) return;
    seeded = true;
    otherOrg = {
      label: 'SYNTHETIC org',
      doctorId: first.doctor_id,
      doctorName: first.doctor_name,
      visitId: first.visit_id,
      mrId: first.mr_id,
    };

    // A different SUBTREE inside the same (synthetic) org: a doctor in another region
    // entirely, so the boundary is a territory one rather than an organisational one.
    const subtree = await client.query<{ doctor_id: string; doctor_name: string; mr_id: string }>(
      `select d.id as doctor_id, d.full_name as doctor_name, p.id as mr_id
         from public.user_profiles p
         join public.doctors d on d.territory_id = p.territory_id
        where p.role = 'mr' and p.full_name like 'SYNTHETIC%'
          and p.territory_id <> $1
        order by p.full_name desc
        limit 1`,
      [first.mr_id],
    );
    const other = subtree.rows[0];
    if (other !== undefined) {
      otherSubtree = {
        label: 'another territory subtree',
        doctorId: other.doctor_id,
        doctorName: other.doctor_name,
        visitId: null,
        mrId: other.mr_id,
      };
    }
  });
}, 120_000);

/**
 * Runs one attempt and classifies it.
 *
 * A thrown error is a REFUSAL; zero rows is an ABSENCE; anything else is DATA. Nothing
 * here interprets — the classification is mechanical so a cell cannot be argued into
 * looking better than it is.
 */
const classify = async (attempt: () => Promise<{ rowCount: number | null }>): Promise<Cell> => {
  try {
    const result = await attempt();
    return (result.rowCount ?? 0) > 0 ? 'DATA' : 'ABSENCE';
  } catch {
    return 'REFUSAL';
  }
};

const tokenFor = (user: FixtureWorld['users'][keyof FixtureWorld['users']]): string =>
  mintAccessToken({
    id: user.id,
    role: user.role,
    territoryId: user.territoryId,
    isActive: true,
  });

/** PostgREST, over real HTTP through Kong — the path the app actually uses. */
const viaPostgrest = async (token: string | undefined, doctorId: string): Promise<Cell> => {
  const response = await rest(`/doctors?id=eq.${doctorId}&select=id`, {
    ...(token === undefined ? {} : { token }),
  });
  if (response.status >= 400) return 'REFUSAL';
  return Array.isArray(response.body) && response.body.length > 0 ? 'DATA' : 'ABSENCE';
};

interface RowResult {
  rowCount: number | null;
}

const asRole = async (
  user: FixtureWorld['users'][keyof FixtureWorld['users']] | 'anon',
  fn: (client: Client) => Promise<Cell>,
): Promise<Cell> =>
  inRolledBackTransaction(async (client) => {
    if (user === 'anon') await asDatabaseRole(client, 'anon');
    else await asUser(client, user);
    return fn(client);
  });

describe.skipIf(!reachable)('G-RLS-C — the full commercial isolation matrix', () => {
  it('the fixture is real: two organisations exist and the targets are outside', async () => {
    // A positive control on the matrix itself. Without it, forty ABSENCE cells would be
    // indistinguishable from forty queries against ids that do not exist.
    expect(
      seeded,
      'seed:synthetic has not been run — the cross-ORG half of this matrix cannot execute',
    ).toBe(true);
    expect(otherOrg).not.toBeNull();
    expect(otherSubtree).not.toBeNull();

    await withClient(async (client) => {
      const orgs = await client.query<{ n: string }>(
        'select count(distinct organisation_id) as n from public.doctors',
      );
      expect(Number(orgs.rows[0]?.n)).toBeGreaterThan(1);

      // The targets really exist, and really belong to somebody else.
      const target = await client.query<{ organisation_id: string }>(
        'select organisation_id from public.doctors where id = $1',
        [otherOrg?.doctorId],
      );
      expect(target.rows).toHaveLength(1);
      expect(target.rows[0]?.organisation_id).not.toBe(world.organisationId);
    });
  });

  const boundaries = (): ReadonlyArray<{ name: string; target: Target }> => [
    { name: 'another ORG', target: otherOrg as Target },
    { name: 'another SUBTREE', target: otherSubtree as Target },
  ];

  const roles = () =>
    [
      { name: 'anon', user: 'anon' as const, token: undefined },
      { name: 'mr', user: world.users.puneMr, token: tokenFor(world.users.puneMr) },
      {
        name: 'field_manager',
        user: world.users.westManager,
        token: tokenFor(world.users.westManager),
      },
      { name: 'admin', user: world.users.admin, token: tokenFor(world.users.admin) },
    ] as const;

  it('runs the whole matrix and reports every cell', async () => {
    const rows: string[] = [];
    const defects: string[] = [];

    for (const boundary of boundaries()) {
      for (const role of roles()) {
        const cells: Record<string, Cell> = {};

        // 1. PostgREST.
        cells['postgrest'] = await viaPostgrest(role.token, boundary.target.doctorId);

        // 2. Raw SQL against the table.
        cells['raw sql'] = await asRole(role.user, (client) =>
          classify(() =>
            client.query<RowResult>('select id from public.doctors where id = $1', [
              boundary.target.doctorId,
            ]),
          ),
        );

        // 3. A join FROM a commercial table -- reaching the doctor through visits rather
        //    than asking for it directly, which is how a filter that lives in the wrong
        //    place gets bypassed.
        cells['join'] = await asRole(role.user, (client) =>
          classify(() =>
            client.query<RowResult>(
              `select d.id from public.visits v
                 join public.doctors d on d.id = v.doctor_id
                where d.id = $1`,
              [boundary.target.doctorId],
            ),
          ),
        );

        // 4. A database function. `search_doctors` is the sharp one: BE-W64 made it
        //    SECURITY DEFINER, so RLS does NOT scope it -- the predicate in its body
        //    does. If a transcription of the policy is ever wrong, this is the cell that
        //    shows it.
        cells['function'] = await asRole(role.user, async (client) => {
          try {
            // Searched BY NAME, not paged from a listing. A first version called
            // `search_doctors(null, null, 200)` and looked for the target in the page --
            // which made the cell report ABSENCE whenever the target sorted past row 200
            // of 3,520. That is the limit hiding the answer, not the scope refusing it,
            // and it produced one cell that disagreed with the other four for no reason
            // anybody could see.
            const result = await client.query<{ found: boolean }>(
              `select exists(
                 select 1 from jsonb_array_elements(
                   public.search_doctors($2, null, 200) -> 'items') e
                  where e ->> 'id' = $1) as found`,
              [boundary.target.doctorId, boundary.target.doctorName],
            );
            return result.rows[0]?.found === true ? 'DATA' : 'ABSENCE';
          } catch {
            return 'REFUSAL';
          }
        });

        // 5. A view.
        cells['view'] = await asRole(role.user, (client) =>
          classify(() =>
            client.query<RowResult>(
              'select visit_id from public.visit_summary where doctor_id = $1',
              [boundary.target.doctorId],
            ),
          ),
        );

        for (const [path, cell] of Object.entries(cells)) {
          rows.push(
            `${boundary.name.padEnd(16)} | ${role.name.padEnd(14)} | ${path.padEnd(9)} | ${cell}`,
          );
          if (cell === 'DATA') defects.push(`${boundary.name} / ${role.name} / ${path}`);
        }
      }
    }

    // Printed in full, always, so the matrix is in the run output rather than only in a
    // pass/fail. A gate whose result nobody can read is a gate nobody checks.
    console.log(`\nG-RLS-C matrix\n${'-'.repeat(60)}\n${rows.join('\n')}\n`);

    expect(rows).toHaveLength(40);

    // ---- what the matrix must show, and the one thing it currently does not ----
    //
    // **Cross-ORG DATA is a tenancy failure for EVERY role, admin included.** There is no
    // sense in which an administrator of one pharmaceutical company may read another
    // company's doctors, and BE-W76 records that they can: `is_admin()` is
    // `effective_role() = 'admin'` with no organisation in it, and **no policy anywhere in
    // this schema mentions `organisation_id`** -- zero of them. The org column exists on
    // the tables and has never been an access-control dimension.
    //
    // Listed explicitly rather than filtered out by a rule, so that the day BE-W76 is
    // fixed this assertion fails and forces the record to be corrected. A quarantine, not
    // an approval: deleting these five lines IS the acceptance test for the fix.
    const KNOWN_TENANCY_DEFECT_BE_W76 = [
      'another ORG / admin / postgrest',
      'another ORG / admin / raw sql',
      'another ORG / admin / join',
      'another ORG / admin / function',
      'another ORG / admin / view',
    ];
    const unexpected = defects.filter(
      (d) =>
        !KNOWN_TENANCY_DEFECT_BE_W76.includes(d) &&
        // Cross-SUBTREE access by an admin is by design: an administrator is scoped to an
        // organisation, not to a territory, and every other role is refused or absent.
        !d.startsWith('another SUBTREE / admin /'),
    );
    expect(unexpected, 'a NEW compliance-boundary defect').toEqual([]);

    // And the defect is still there, so the quarantine cannot rot into a comment about
    // something that was fixed years ago.
    for (const known of KNOWN_TENANCY_DEFECT_BE_W76) {
      expect(defects, `BE-W76 still open: ${known}`).toContain(known);
    }
  }, 300_000);

  it('a refusal and an absence are told apart, and anon gets neither by accident', async () => {
    // The distinction the matrix rests on. `anon` holds no grant on `doctors` at all --
    // MR-01's privilege posture guard asserts that -- so raw SQL must REFUSE rather than
    // return nothing, and a matrix that recorded ABSENCE there would be describing a
    // different database.
    const cell = await asRole('anon', (client) =>
      classify(() => client.query<RowResult>('select id from public.doctors limit 1')),
    );
    expect(cell).toBe('REFUSAL');
  });

  it('the same query as the OWNER returns data, so the matrix is not all-deny', async () => {
    // The positive control for the whole file. Forty refusals would also be produced by a
    // database that refuses everything, including to the person entitled.
    const cell = await asRole(world.users.puneMr, (client) =>
      classify(() =>
        client.query<RowResult>('select id from public.doctors where id = $1', [
          world.doctors.pune,
        ]),
      ),
    );
    expect(cell).toBe('DATA');
  });
});
