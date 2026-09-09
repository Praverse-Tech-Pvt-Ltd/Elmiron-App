import { beforeAll, describe, expect, it } from 'vitest';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { seedFixtures } from './fixtures.js';

/**
 * MR-01 A4 — can a business write succeed unaudited?
 *
 * The question matters at a different severity from an outage. A write that fails is
 * visible and recoverable; **a write that succeeds without its audit row is an
 * audit-bypass**, and this product's compliance story rests on `audit_log` being a
 * complete record of who touched what. A gap in it cannot be reconstructed afterwards,
 * because the only evidence that the row was ever written is the row that was not.
 *
 * Reading the mechanism says it is safe: `write_audit_row()` is a `SECURITY DEFINER`
 * trigger performing a plain `insert` **with no exception block anywhere**, so a failure
 * propagates and aborts the statement. But "I read it and it looked fine" is the claim
 * this project has been wrong about eight times, so the branch is exercised: the audit
 * write is broken deliberately and the business row is looked for afterwards.
 *
 * Everything runs inside a rolled-back transaction, so the sabotage never outlives the
 * test.
 */

const reachable = await requireDatabase();

/**
 * Retries a transaction that lost a deadlock, which is what Postgres expects a caller to
 * do — `40P01` is documented as a transient condition, not a defect in the statement that
 * hit it.
 *
 * **MR-07 E3, and it is a mitigation rather than a cure.** The test below needs
 * ACCESS EXCLUSIVE on `audit_log` to install its sabotage trigger, and every other suite
 * in a parallel run writes audit rows. Taking that lock first made the ordering
 * consistent and cut the failure rate from roughly one run in three to one in five;
 * retrying closes the rest, because the remaining case is a genuine two-transaction cycle
 * that no lock ordering inside THIS transaction can prevent.
 *
 * Bounded and narrow on purpose. It is not in `inRolledBackTransaction`, because a
 * deadlock anywhere else in this suite would be a finding rather than noise, and a
 * blanket retry is how a real lock-ordering bug gets hidden for a year.
 */
const retryOnDeadlock = async <T>(fn: () => Promise<T>, attempts = 4): Promise<T> => {
  for (let i = 1; ; i += 1) {
    try {
      return await fn();
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      if (code !== '40P01' || i >= attempts) throw error;
    }
  }
};

/**
 * ONE seeded world, shared by both tests that need one.
 *
 * **This file called `seedFixtures()` once per test** -- two full worlds, sixteen GoTrue
 * identities, for a file with two tests that need one. That is the same per-test seeding
 * pattern MR-11 removed from `seed-day.spec` after it took CI down with nine, and nobody
 * knew it existed in a second suite: MR-12's per-file identity budget failed on this file
 * the first time it ran, which is the difference between a lesson and a control.
 *
 * Both tests run inside `inRolledBackTransaction`, so neither can see the other's writes
 * and sharing the world costs them no isolation.
 */
let world: Awaited<ReturnType<typeof seedFixtures>>;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

describe.skipIf(!reachable)('a business write cannot succeed unaudited', () => {
  it('the audit trigger is AFTER, FOR EACH ROW, and in the same transaction', async () => {
    // Structural, and it is the part that decides the answer: an asynchronous or deferred
    // audit could not be atomic with the write however careful the function body was.
    await inRolledBackTransaction(async (client) => {
      const rows = await client.query<{
        tgname: string;
        timing: string;
        deferrable: boolean;
        row_level: boolean;
      }>(
        `select t.tgname,
                case when (t.tgtype & 2) <> 0 then 'BEFORE' else 'AFTER' end as timing,
                t.tgdeferrable as deferrable,
                (t.tgtype & 1) <> 0 as row_level
           from pg_trigger t
           join pg_proc p on p.oid = t.tgfoid
          where p.proname = 'write_audit_row' and not t.tgisinternal
          order by t.tgname`,
      );
      expect(rows.rows.length).toBeGreaterThan(5);
      for (const row of rows.rows) {
        expect(row.timing, row.tgname).toBe('AFTER');
        expect(row.row_level, row.tgname).toBe(true);
        // A DEFERRABLE trigger fires at commit and could be skipped by SET CONSTRAINTS.
        expect(row.deferrable, row.tgname).toBe(false);
      }
    });
  });

  it('the function that performs the INSERT has no exception handler', async () => {
    // The precise property. One `exception when others then null` around the insert would
    // turn every assertion below into a coincidence -- the write would succeed, the audit
    // row would silently not exist, and nothing would ever say so.
    await inRolledBackTransaction(async (client) => {
      const src = await client.query<{ prosrc: string }>(
        `select prosrc from pg_proc where proname = 'write_audit_row'`,
      );
      expect(src.rows).toHaveLength(1);
      expect(src.rows[0]?.prosrc.toLowerCase()).not.toMatch(/exception\s+when/);
    });
  });

  it('the two helpers that DO swallow degrade metadata only, never the row', async () => {
    // Written down rather than glossed, because a first pass at this test asserted "no
    // exception handler anywhere on the audit path" and failed -- correctly.
    //
    // `current_request_id()` and `current_client_ip()` both catch `when others`. Both are
    // reading the PostgREST header bag to populate a COLUMN, and both run BEFORE the
    // insert rather than around it. A malformed header bag therefore degrades `request_id`
    // to null and `ip_address` to the connection address, and the audit row is still
    // written. That is a deliberate trade, commented in the function -- "a malformed
    // header bag must not break an audited read" -- and it is a metadata degradation, NOT
    // an audit bypass. The distinction is the whole point of A4.
    //
    // What this asserts is that the trade stays bounded to those two columns: neither
    // helper touches `actor_id`, `action`, `table_name` or `row_id`, so no swallow can
    // make an audit row that misidentifies who did what to which record.
    await inRolledBackTransaction(async (client) => {
      const helpers = await client.query<{ proname: string; prosrc: string }>(
        `select proname, prosrc from pg_proc
          where proname in ('current_request_id', 'current_client_ip')`,
      );
      expect(helpers.rows).toHaveLength(2);
      for (const helper of helpers.rows) {
        expect(helper.prosrc.toLowerCase(), helper.proname).toMatch(/exception\s+when/);
        // Reads a GUC and returns a value. It cannot insert, update or delete anything.
        expect(helper.prosrc.toLowerCase(), helper.proname).not.toMatch(
          /\b(insert|update|delete)\b/,
        );
      }

      // And the identity columns come from the trigger body, not from a swallowing helper.
      const audit = await client.query<{ prosrc: string }>(
        `select prosrc from pg_proc where proname = 'write_audit_row'`,
      );
      const body = audit.rows[0]?.prosrc ?? '';
      expect(body).toMatch(/auth\.uid\(\)/);
      expect(body).toMatch(/tg_table_name/);
    });
  });

  it('THE PROOF: with the audit write broken, the business row does not survive', async () => {
    await retryOnDeadlock(() =>
      inRolledBackTransaction(async (client) => {
        // MR-07 E3. Take the strong lock FIRST, before anything else in this transaction.
        //
        // `create trigger` needs ACCESS EXCLUSIVE on `audit_log`, and every other suite
        // running in parallel writes audit rows. Acquiring it here rather than four
        // statements in makes this transaction's lock order consistent with everyone
        // else's, so it waits instead of deadlocking. Without it this test failed roughly
        // one run in three with `deadlock detected` -- on the file whose whole purpose is
        // to prove that a business write cannot succeed unaudited.
        //
        // Same defect as the first draft of `tenant-boundary-restrictive.spec.ts`, which
        // did DDL on `doctors`: a test that makes the rest of the suite flaky is not a
        // control, it is a second defect.
        await client.query('lock table public.audit_log in access exclusive mode');

        // Break the audit write. A BEFORE INSERT trigger on audit_log is the narrowest
        // sabotage available: it leaves every other path alone and fails exactly the insert
        // `write_audit_row` performs.
        await client.query(
          `create function pg_temp.break_audit() returns trigger language plpgsql as $$
           begin raise exception 'audit storage is unavailable' using errcode = '58030'; end $$`,
        );
        await client.query(
          `create trigger zzz_break_audit before insert on public.audit_log
           for each row execute function pg_temp.break_audit()`,
        );

        await client.query('savepoint before_write');
        await expect(
          client.query(`update public.doctors set specialty = 'Sabotage' where id = $1`, [
            world.doctors.pune,
          ]),
        ).rejects.toMatchObject({ code: '58030' });
        await client.query('rollback to savepoint before_write');

        await client.query('drop trigger zzz_break_audit on public.audit_log');

        // The business row is unchanged. Not "an error was raised" -- the row itself.
        const after = await client.query<{ specialty: string | null }>(
          'select specialty from public.doctors where id = $1',
          [world.doctors.pune],
        );
        expect(after.rows[0]?.specialty).not.toBe('Sabotage');
      }),
    );
  });

  it('the control is not vacuous: the same write succeeds AND audits when unbroken', async () => {
    // Without this, the test above would pass against a schema where the update was
    // refused for some unrelated reason and no audit row was ever attempted.
    await inRolledBackTransaction(async (client) => {
      const before = await client.query<{ n: string }>(
        `select count(*) as n from public.audit_log
          where table_name = 'doctors' and row_id = $1`,
        [world.doctors.pune],
      );
      await client.query(`update public.doctors set specialty = 'Nephrology' where id = $1`, [
        world.doctors.pune,
      ]);
      const after = await client.query<{ n: string }>(
        `select count(*) as n from public.audit_log
          where table_name = 'doctors' and row_id = $1`,
        [world.doctors.pune],
      );
      expect(Number(after.rows[0]?.n)).toBeGreaterThan(Number(before.rows[0]?.n));

      const updated = await client.query<{ specialty: string | null }>(
        'select specialty from public.doctors where id = $1',
        [world.doctors.pune],
      );
      expect(updated.rows[0]?.specialty).toBe('Nephrology');
    });
  });
});
