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
      // MR-15 B3. FIVE visits across THREE days, not three on one. See the dimension
      // assertion below for why the count alone is not the point.
      expect(Number(row?.visits)).toBe(5);
      // `Doctor.clinicAddresses` is required by the contract and the doctors list renders
      // `clinicAddresses[0].city`. A doctor without one renders a blank card.
      expect(Number(row?.clinics)).toBe(3);
      // `BeatPlan` requires `entries`; a plan without them fails to parse. Still three:
      // yesterday's and tomorrow's visits carry no beat plan, because today's approved
      // plan is not a claim about either.
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

  it('places every clock-bounded column in the past, at whatever hour it is run', async () => {
    // **The defect this exists to stop.** `visitRows` used `todayAt(9, 30)` — today at a
    // fixed LOCAL hour — for `started_at` and `completed_at`, both of which
    // `validate_visit` bounds against `now()` plus the device-clock tolerance. In the IST
    // afternoon 09:30 is behind you and the seed passes; on a UTC runner at 07:56 it is
    // 94 minutes ahead and the seed dies with `45007`, taking two suites down at their
    // `beforeAll`. CI run `34326262244`.
    //
    // The comment above `visitRows` had already stated the requirement — "`completed_at`
    // is in the past for both finished visits, which the new `visits_validate` trigger
    // requires". It was written directly above the code that broke it. This assertion is
    // that sentence turned into something that can fail.
    await withClient(async (client) => {
      const rows = await client.query<{
        id: string;
        future_start: boolean;
        future_done: boolean;
        start_mins_ago: string | null;
      }>(
        `select v.id,
                v.started_at   > now() as future_start,
                v.completed_at > now() as future_done,
                extract(epoch from (now() - v.started_at)) / 60 as start_mins_ago
           from public.visits v
           join public.doctors d on d.id = v.doctor_id
          where d.organisation_id = $1
          order by v.started_at nulls last`,
        [seeded.organisationId],
      );

      expect(rows.rows.length).toBe(5);
      for (const row of rows.rows) {
        expect(row.future_start, `visit ${row.id} started in the future`).not.toBe(true);
        expect(row.future_done, `visit ${row.id} completed in the future`).not.toBe(true);
      }

      // **And that they were derived from `now`, not from a wall clock.** "In the past" on
      // its own is not a guard: `todayAt(9, 30)` satisfies it every afternoon, which is
      // exactly why the defect survived to CI. Pinning the offsets makes the old shape fail
      // at almost any hour rather than only before 10:15 — the assertion stops depending on
      // when somebody happens to run it.
      const startedAgo = rows.rows
        .map((r) => (r.start_mins_ago === null ? null : Number(r.start_mins_ago)))
        .filter((v): v is number => v !== null)
        .sort((a, b) => b - a);

      // Three finished now: yesterday's, plus today's two. Sorted longest-ago first, so
      // [0] is yesterday's and [1], [2] are today's.
      expect(startedAgo.length, 'three visits should be finished').toBe(3);
      expect(startedAgo[0], "yesterday's visit should be over a day ago").toBeGreaterThan(
        24 * 60 + 140,
      );
      expect(startedAgo[0]).toBeLessThan(24 * 60 + 160);
      expect(startedAgo[1]).toBeGreaterThan(140);
      expect(startedAgo[1]).toBeLessThan(160);
      expect(startedAgo[2]).toBeGreaterThan(80);
      expect(startedAgo[2]).toBeLessThan(100);
    });
  }, 60_000);

  /**
   * MR-15 B3 — the DIMENSION, not the row count.
   *
   * A fixture holding a single value of a dimension cannot test any predicate on that
   * dimension. `seed:day` seeded exactly one day, so it shared the mock's blind spot: the
   * app filtered visits by date nowhere at all, and neither fixture could reveal it. It
   * took running the app on a second day, where the Today screen counted yesterday's
   * visits and offered to send the MR to a clinic for one of them.
   *
   * This asserts the dimension is varied, not that five rows exist -- a future change
   * that moved all five onto one day would keep every count above passing and quietly
   * restore the blind spot.
   */
  it('spans THREE days, so a missing date filter has something to get wrong', async () => {
    await withClient(async (client) => {
      const rows = await client.query<{ ist_day: string; status: string }>(
        // The zone is read from the organisation's configured window rather than joined
        // to the MR's own territory: `resolve_shift_window()` walks UP the hierarchy, so
        // a window can legitimately sit on a parent and a direct join finds nothing. The
        // first draft of this test did exactly that and returned zero rows -- which would
        // have read as "the dimension is single-valued" when the real answer was "the
        // query is wrong". A count of zero is asserted against below for that reason.
        `select (v.scheduled_for at time zone (
                  select w.timezone from public.territory_shift_windows w
                    join public.territories t on t.id = w.territory_id
                   where t.organisation_id = $1 limit 1
                ))::date::text as ist_day,
                v.status::text
           from public.visits v
           join public.doctors d on d.id = v.doctor_id
          where d.organisation_id = $1`,
        [seeded.organisationId],
      );

      // Read in the TERRITORY's zone, which is the boundary MR-15 A2 settled on -- not
      // the runner's, and not UTC. A UTC day would cut an Indian working day at 05:30.
      // A positive control on the QUERY before the assertion about the DATA. An empty
      // result would otherwise satisfy "not single-valued" reasoning by accident and
      // report a broken join as a finding about the seed.
      expect(rows.rows.length, 'the query found no visits at all').toBe(5);

      const days = new Set(rows.rows.map((r) => r.ist_day));
      expect(days.size, 'the date dimension is single-valued again').toBe(3);

      // And the STATES are what make a wrong filter visible on screen rather than only in
      // a test: yesterday's completed visit inflates "done", and tomorrow's planned one
      // becomes "Next visit" and sends the MR to a clinic a day early.
      const sorted = [...days].sort();
      const byDay = (day: string): string[] =>
        rows.rows.filter((r) => r.ist_day === day).map((r) => r.status);
      expect(byDay(sorted[0] ?? ''), 'yesterday must hold a COMPLETED visit').toContain(
        'completed',
      );
      expect(byDay(sorted[2] ?? ''), 'tomorrow must hold a PLANNED visit').toContain('planned');
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
        expect(byEntity['visit'], 'sync_pull returned no visits').toBe(5);
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
