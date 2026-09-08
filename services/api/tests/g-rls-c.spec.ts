import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { inRolledBackTransaction, requireDatabase, withClient } from './db.js';
import { asDatabaseRole, asUser, mintAccessToken, rest } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureUser, FixtureWorld } from './fixtures.js';

/**
 * G-RLS-C — the commercial isolation gate, as a complete matrix with a control on every
 * cell.
 *
 * Four roles x two boundaries x five paths, and for each boundary the same five paths run
 * again as the people entitled to the row. Fifty-five attempts, fifteen of which exist
 * only to prove the other forty mean something.
 *
 * **Every cell is stated as a REFUSAL or an ABSENCE**, never left ambiguous, because the
 * two mean different things to a client: a refusal says "not yours", an absence says
 * "nothing there", and a client that renders the second for the first is the
 * filter-in-the-client defect this project already forbids.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY ABSENCE NEEDS A POSITIVE CONTROL
 * ---------------------------------------------------------------------------
 *
 * MR-05 ran this matrix for the first time and one cell lied. The `function` path called
 * `search_doctors(null, null, 200)` and looked for the target in the returned page, which
 * reported ABSENCE whenever the target sorted past row 200 of 3,520. **That is the limit
 * hiding the answer, not the scope refusing it** — and a false negative in an isolation
 * test is worse than no test at all, because it produces a green gate.
 *
 * A limit, a filter, a typo and an empty fixture are all indistinguishable from a refusal
 * when you only look at the deny side. So each boundary carries `entitled` identities —
 * the people the row genuinely belongs to — and every path runs as them and is required
 * to return DATA. An ABSENCE in the matrix counts only because the identical query a few
 * rows down came back with the row.
 *
 * ---------------------------------------------------------------------------
 * THE SECOND ORGANISATION IS NOW A FIXTURE, NOT A SEED
 * ---------------------------------------------------------------------------
 *
 * MR-05's version drew its cross-org target from `seed:synthetic`, which CI does not run.
 * The suite therefore failed in CI with "seed:synthetic has not been run" — loudly, which
 * was the right design, but it meant the cross-ORG half had still never executed anywhere
 * except one laptop. `seedFixtures()` now builds a second organisation of its own, so
 * this matrix runs wherever the fixtures do.
 *
 * **G-RLS-X is not tested here and is ABSENT rather than passing.** The
 * commercial/clinical boundary needs a clinical schema and clinical roles, and neither
 * exists — S6 and S7 are cut under the default scope option. A gate with nothing to
 * separate has not been met. The organisation scoping added by MR-06 is the pattern the
 * clinical tables inherit when they exist: a tenant column on the row, one helper
 * expressing the caller's tenant, and the scope resolved inside `visible_*_ids()` rather
 * than restated per policy.
 */

const reachable = await requireDatabase();

/** What a single attempt produced. Never "empty or refused" — one or the other. */
type Cell = 'REFUSAL' | 'ABSENCE' | 'DATA';

interface Target {
  readonly doctorId: string;
  readonly doctorName: string;
}

interface Boundary {
  readonly name: string;
  readonly target: Target;
  /** The identities that SHOULD see the target. Their five cells must all be DATA. */
  readonly entitled: ReadonlyArray<{ name: string; user: FixtureUser }>;
}

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
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

const tokenFor = (user: FixtureUser): string =>
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
  user: FixtureUser | 'anon',
  fn: (client: Client) => Promise<Cell>,
): Promise<Cell> =>
  inRolledBackTransaction(async (client) => {
    if (user === 'anon') await asDatabaseRole(client, 'anon');
    else await asUser(client, user);
    return fn(client);
  });

/**
 * The five paths, run against one target as one identity.
 *
 * They are five because a fix that closes one is not a fix. PostgREST is what the app
 * uses; raw SQL is what a leaked connection string gives you; the join is how a filter
 * living in the wrong place gets bypassed; the function is `SECURITY DEFINER`, where RLS
 * does NOT apply and only the body's own predicate scopes the read; and the view is one
 * missing `security_invoker` away from running as its owner.
 */
const allPaths = async (
  user: FixtureUser | 'anon',
  token: string | undefined,
  target: Target,
): Promise<Record<string, Cell>> => {
  const cells: Record<string, Cell> = {};

  cells['postgrest'] = await viaPostgrest(token, target.doctorId);

  cells['raw sql'] = await asRole(user, (client) =>
    classify(() =>
      client.query<RowResult>('select id from public.doctors where id = $1', [target.doctorId]),
    ),
  );

  cells['join'] = await asRole(user, (client) =>
    classify(() =>
      client.query<RowResult>(
        `select d.id from public.visits v
           join public.doctors d on d.id = v.doctor_id
          where d.id = $1`,
        [target.doctorId],
      ),
    ),
  );

  cells['function'] = await asRole(user, async (client) => {
    try {
      // Searched BY NAME, not paged from a listing — see the header. Before MR-06 this
      // function carried its own transcription of the admin policy ("for an admin the
      // equivalent scope is every territory"); that branch is deleted and it now reads
      // the same `current_user_visible_territory_ids()` as everything else.
      const result = await client.query<{ found: boolean }>(
        `select exists(
           select 1 from jsonb_array_elements(
             public.search_doctors($2, null, 200) -> 'items') e
            where e ->> 'id' = $1) as found`,
        [target.doctorId, target.doctorName],
      );
      return result.rows[0]?.found === true ? 'DATA' : 'ABSENCE';
    } catch {
      return 'REFUSAL';
    }
  });

  cells['view'] = await asRole(user, (client) =>
    classify(() =>
      client.query<RowResult>('select visit_id from public.visit_summary where doctor_id = $1', [
        target.doctorId,
      ]),
    ),
  );

  return cells;
};

describe.skipIf(!reachable)('G-RLS-C — the full commercial isolation matrix', () => {
  const boundaries = (): ReadonlyArray<Boundary> => [
    {
      // Another TENANT. Rival Pharma is a separate organisation with its own territory,
      // its own MR and its own admin, and shares nothing with Gate0 Pharma.
      name: 'another ORG',
      target: { doctorId: world.doctors.rival, doctorName: 'Dr Rival Fixture' },
      entitled: [
        { name: 'their mr', user: world.users.rivalMr },
        // The control that matters most. Without it, "an admin cannot see the rival
        // doctor" is indistinguishable from "no admin can see any doctor" — which is
        // exactly what an over-broad fix produces, and it would have looked like a pass.
        { name: 'their admin', user: world.users.rivalAdmin },
      ],
    },
    {
      // Another SUBTREE inside the SAME tenant. South is a sibling of West, so puneMr and
      // westManager are outside it and the org-level admin is legitimately inside.
      name: 'another SUBTREE',
      target: { doctorId: world.doctors.south, doctorName: 'Dr South Fixture' },
      entitled: [{ name: 'their mr', user: world.users.southMr }],
    },
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

  it('the fixture is real: two organisations exist and the targets are outside', async () => {
    // A positive control on the FIXTURE, before any control on a query. Without it, forty
    // ABSENCE cells would be indistinguishable from forty queries against ids that do not
    // exist — the shape of blind spot that let BE-W76 survive twenty sessions.
    expect(world.rivalOrganisationId).not.toBe(world.organisationId);

    await withClient(async (client) => {
      const target = await client.query<{ organisation_id: string }>(
        'select organisation_id from public.doctors where id = $1',
        [world.doctors.rival],
      );
      expect(target.rows, 'the cross-org target must exist').toHaveLength(1);
      expect(target.rows[0]?.organisation_id).toBe(world.rivalOrganisationId);

      // And the second boundary really is inside the FIRST organisation, so the two rows
      // of the matrix are testing two different things.
      const sibling = await client.query<{ organisation_id: string }>(
        'select organisation_id from public.doctors where id = $1',
        [world.doctors.south],
      );
      expect(sibling.rows[0]?.organisation_id).toBe(world.organisationId);

      // The admin under test has a tenant at all. Before MR-06 this column did not exist
      // and this assertion could not have been written.
      const admin = await client.query<{ organisation_id: string }>(
        'select organisation_id from public.user_profiles where id = $1',
        [world.users.admin.id],
      );
      expect(admin.rows[0]?.organisation_id).toBe(world.organisationId);
    });
  });

  it('runs the whole matrix and reports every cell', async () => {
    const rows: string[] = [];
    const defects: string[] = [];
    const deadControls: string[] = [];

    for (const boundary of boundaries()) {
      // ---- the deny side ----
      for (const role of roles()) {
        const cells = await allPaths(role.user, role.token, boundary.target);
        for (const [path, cell] of Object.entries(cells)) {
          rows.push(
            `${boundary.name.padEnd(16)} | ${role.name.padEnd(18)} | ${path.padEnd(9)} | ${cell}`,
          );
          if (cell === 'DATA') defects.push(`${boundary.name} / ${role.name} / ${path}`);
        }
      }

      // ---- the control side: the same five queries by someone entitled ----
      for (const control of boundary.entitled) {
        const cells = await allPaths(control.user, tokenFor(control.user), boundary.target);
        for (const [path, cell] of Object.entries(cells)) {
          rows.push(
            `${boundary.name.padEnd(16)} | ${`CONTROL ${control.name}`.padEnd(18)} | ` +
              `${path.padEnd(9)} | ${cell}`,
          );
          if (cell !== 'DATA') {
            deadControls.push(`${boundary.name} / ${control.name} / ${path} -> ${cell}`);
          }
        }
      }
    }

    // Printed in full, always, so the matrix is in the run output rather than only in a
    // pass/fail. A gate whose result nobody can read is a gate nobody checks.
    console.log(`\nG-RLS-C matrix\n${'-'.repeat(70)}\n${rows.join('\n')}\n`);

    // 2 boundaries x 4 roles x 5 paths = 40 deny cells,
    // plus 3 entitled identities x 5 paths = 15 controls.
    expect(rows).toHaveLength(55);

    // **The controls first.** If these are not all DATA then the deny side proves nothing,
    // and reporting a pass off the back of a broken query is the failure this file was
    // rewritten to make impossible.
    expect(
      deadControls,
      'a POSITIVE CONTROL did not return the row — every ABSENCE above is meaningless, ' +
        'because a limit, a filter, a typo and an empty fixture look identical to a refusal',
    ).toEqual([]);

    // ---- and now the boundary itself ----
    //
    // MR-05 quarantined five cells here: `another ORG / admin / *` all returned DATA,
    // because `is_admin()` had no organisation in it and no policy in the schema mentioned
    // `organisation_id`. MR-06 closed that — `user_profiles` gained a tenant, the two
    // `visible_*_ids()` admin branches stopped meaning "everything", and the six
    // `*_admin_all` policies gained an explicit tenant predicate. **The quarantine is
    // deleted rather than relaxed**, so a regression fails here rather than being excused.
    //
    // Cross-SUBTREE access by an admin remains by design and is the ONLY permitted DATA:
    // an administrator is scoped to an organisation, not to a territory.
    const permitted = defects.filter((d) => d.startsWith('another SUBTREE / admin /'));
    const unexpected = defects.filter((d) => !d.startsWith('another SUBTREE / admin /'));

    expect(unexpected, 'a compliance-boundary defect: data crossed a tenant boundary').toEqual([]);

    // The by-design cells are asserted PRESENT, not merely tolerated. If an over-broad
    // organisation predicate ever scoped an admin down to their own territory, every one
    // of these would turn to ABSENCE and the suite would still have been green without
    // this line — a fix that breaks the product looking exactly like a fix that works.
    expect(permitted).toHaveLength(5);
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

  it('an admin still administers their OWN tenant — the fix did not just deny everything', async () => {
    // The whole-file counterpart to the per-boundary controls. An organisation predicate
    // that resolved to null for everyone would produce a perfect matrix and a product
    // nobody could use.
    const cell = await asRole(world.users.admin, (client) =>
      classify(() =>
        client.query<RowResult>('select id from public.doctors where id = $1', [
          world.doctors.south,
        ]),
      ),
    );
    expect(cell).toBe('DATA');
  });
});
