import { beforeAll, describe, expect, it } from 'vitest';
import { DB_URL, requireDatabase, withClient } from './db.js';
import { assertLocalhostOnly, seedDay, DEMO_MARKER } from '../scripts/seed-day.mjs';

/**
 * MR-10 Part B — the seed that unblocked the conversion.
 *
 * Three seeds existed and none produced a signable MR with a day in front of them:
 * `seed:mr` gives an account with `doctors=0`, `seed:synthetic` gives 3,520 doctors whose
 * accounts cannot sign in, and `seed:reference` correctly refuses to invent content. MR-09
 * proved on the emulator what that costs — the Today screen renders mock fixture ids while
 * Supabase holds nothing, and `record_check_in` refuses `42501` for a visit the server has
 * never seen.
 *
 * **The assertions below are the ones that would have caught the traps**, not a
 * restatement of the insert list: that the tenant has a consent notice at all (BE-W79), and
 * that `sync_pull` — the real read path — actually hands this MR their own day.
 */

const reachable = await requireDatabase();

/**
 * ONE seeded tenant, shared by every test below.
 *
 * **Each `seedDay()` call mints three GoTrue identities**, and the first version of this
 * file called it three times — nine `POST /admin/users` on top of everything else the
 * suite is doing. That was enough to bring back the connection exhaustion `maxWorkers: 6`
 * had closed in MR-07: CI failed with *"Database error creating new user"*, two suites
 * dead at their `beforeAll` and fifteen cases skipped.
 *
 * The MR-10 record had already named the shape — *the burst scales with the number of
 * suites* — and this suite was the next one added. Seeding once and asserting against it
 * is also the better test: the four assertions are about one dataset, not four.
 */
let seeded: Awaited<ReturnType<typeof seedDay>>;

beforeAll(async () => {
  if (!reachable) return;
  seeded = await seedDay({ another: true, dbUrl: DB_URL });
}, 60_000);

describe('seed:day refuses what it must refuse', () => {
  it('refuses a non-localhost database before opening a connection', () => {
    // Pure, so the refusal is testable without a remote database — the same shape as
    // `verify-rollbacks.mjs`. This script writes fabricated doctors, clinics and visits,
    // and a rule for a human to follow is not a guard.
    expect(() => {
      assertLocalhostOnly('postgresql://user:pw@db.example.com:5432/postgres');
    }).toThrow(/refuses to run against host "db\.example\.com"/);
  });

  it('allows the three localhost spellings', () => {
    // The positive control. A guard that refuses everything would satisfy the test above.
    for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
      expect(() => {
        assertLocalhostOnly(`postgresql://postgres:postgres@${host}:54322/postgres`);
      }).not.toThrow();
    }
  });
});

describe.skipIf(!reachable)('seed:day produces a day the server will actually serve', () => {
  it('gives the MR doctors, today’s visits, a beat plan and a consent notice', async () => {
    // `another: true` so this is independent of whatever else is in the database — the
    // script otherwise refuses a second run, which is its own guard and is tested by the
    // fact that every other suite would fail if it did not.
    expect(seeded.email).toMatch(/^demo-.*-mr@example\.test$/);

    await withClient(async (client) => {
      const counts = await client.query<{
        doctors: string;
        visits: string;
        clinics: string;
        entries: string;
        windows: string;
        notices: string;
      }>(
        `select
           (select count(*) from public.doctors where organisation_id = $1) as doctors,
           (select count(*) from public.visits v join public.doctors d on d.id = v.doctor_id
             where d.organisation_id = $1) as visits,
           (select count(*) from public.clinic_addresses c join public.doctors d on d.id = c.doctor_id
             where d.organisation_id = $1) as clinics,
           (select count(*) from public.beat_plan_entries e join public.beat_plans b on b.id = e.beat_plan_id
             join public.user_profiles p on p.id = b.mr_id where p.organisation_id = $1) as entries,
           (select count(*) from public.territory_shift_windows w join public.territories t on t.id = w.territory_id
             where t.organisation_id = $1) as windows,
           (select count(*) from public.consent_text_versions where organisation_id = $1) as notices`,
        [seeded.organisationId],
      );
      const row = counts.rows[0];

      expect(Number(row?.doctors)).toBe(3);
      expect(Number(row?.visits)).toBe(3);
      // `Doctor.clinicAddresses` is required by the contract and the doctors list renders
      // `clinicAddresses[0].city`. A doctor without one renders a blank card.
      expect(Number(row?.clinics)).toBe(3);
      // `BeatPlan` requires `entries`; a plan without them fails to parse.
      expect(Number(row?.entries)).toBe(3);
      // Without a window covering now, `record_check_in` refuses 45003 before anything
      // else behind it can be tested.
      expect(Number(row?.windows)).toBe(1);
      // **The BE-W79 trap.** Notices are tenant-scoped, so an MR whose organisation has no
      // notice cannot capture consent at all — and it reads as a new defect rather than as
      // missing data.
      expect(Number(row?.notices), 'the tenant has no consent notice').toBe(1);
    });
  }, 60_000);

  it('and sync_pull hands that MR their own day — the read path, not the tables', async () => {
    // The point of the whole part. Row counts prove the inserts ran; this proves the
    // server will serve them to the person who signed in, through RLS, on the path the
    // client actually uses.
    await withClient(async (client) => {
      const mr = await client.query<{ id: string }>(
        `select id from public.user_profiles where organisation_id = $1 and role = 'mr'`,
        [seeded.organisationId],
      );
      const mrId = mr.rows[0]?.id;
      expect(mrId).toBeDefined();

      await client.query('begin');
      try {
        await client.query('set local role authenticated');
        await client.query(
          `set local request.jwt.claims = '{"sub":"${String(mrId)}","role":"authenticated"}'`,
        );

        const pulled = await client.query<{ entity: string; n: string }>(
          `select c ->> 'entity' as entity, count(*) as n
             from jsonb_array_elements(public.sync_pull(null) -> 'changes') c
            group by 1`,
        );
        const byEntity = Object.fromEntries(pulled.rows.map((r) => [r.entity, Number(r.n)]));

        expect(byEntity['doctor'], 'sync_pull returned no doctors').toBe(3);
        expect(byEntity['visit'], 'sync_pull returned no visits').toBe(3);
        expect(byEntity['beat_plan']).toBe(1);
      } finally {
        await client.query('rollback');
      }
    });
  }, 60_000);

  it('marks everything DEMO, so it can never be mistaken for reference data', async () => {
    // `seed-reference-data.mjs` exists precisely so that real organisations, doctors and
    // clinics are supplied rather than invented. This script invents all three, so every
    // row it writes says so in its own name.
    await withClient(async (client) => {
      const rows = await client.query<{ name: string }>(
        `select o.name from public.organisations o where o.id = $1
         union all
         select d.full_name from public.doctors d where d.organisation_id = $1`,
        [seeded.organisationId],
      );
      expect(rows.rows.length).toBeGreaterThan(3);
      for (const row of rows.rows) {
        expect(row.name).toContain(DEMO_MARKER);
      }
    });
  }, 60_000);
});
