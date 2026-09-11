import { describe, expect, it } from 'vitest';
import { requireDatabase, withClient } from './db.js';

/**
 * BE-W92 — the instrument is ON, asserted rather than assumed.
 *
 * One deadlock, observed once, during MR-26. MR-27 D1 could not reproduce it — 0 in 9 —
 * and established only that concurrency against one database is the wrong instrument.
 * `BE-W92`'s verification order wants the RELATION NAMES first, and the only thing that can
 * supply them is Postgres at the moment it happens.
 *
 * So this asserts the setting is in force, and nothing else. **There is no attempt here to
 * cause a deadlock.** Manufacturing one would be MR-27 D1's mistake repeated: the event
 * that was seen was not caused by a test, and one caused by a test would name whatever
 * relations the test touched.
 *
 * This case exists because an instrumentation setting is exactly the kind of thing that is
 * turned on once, lost in a `db reset` or a fresh CI container, and then trusted for months
 * — nobody notices a log line that is missing.
 *
 * **It is set by `services/api/scripts/enable-lock-logging.mjs`, not by a migration.**
 * `log_lock_waits` is a `SUSET` parameter and Supabase's `postgres` role — which every
 * migration runs as — is not a superuser; the migration written first failed with
 * *"permission denied to set parameter"*. The script connects as `supabase_admin`, runs
 * after `db:start`/`db:reset`, and runs in CI's database job before the suites. If this
 * case fails locally, that script has not been run against this database.
 */

const reachable = await requireDatabase();

describe.skipIf(!reachable)('BE-W92 — lock waits are logged', () => {
  it('log_lock_waits is set ON for this database', async () => {
    await withClient(async (client) => {
      // Read from `pg_db_role_setting`, not `current_setting()`. `ALTER DATABASE` applies
      // to sessions opened AFTERWARDS, so a pooled connection opened before the migration
      // ran still reports the old value — a true reading of a stale session, and a test
      // failure with nothing wrong behind it.
      const stored = await client.query<{ setconfig: string[] | null }>(
        `select s.setconfig
           from pg_db_role_setting s
           join pg_database d on d.oid = s.setdatabase
          where d.datname = current_database() and s.setrole = 0`,
      );
      const settings = stored.rows[0]?.setconfig ?? [];
      // The precondition: there is a stored settings array at all. Without it, `[]` does
      // not contain the string, the assertion below fails, and the message would point at
      // the setting rather than at the migration never having run.
      expect(settings.length, 'no database-level settings are stored at all').toBeGreaterThan(0);
      expect(settings).toContain('log_lock_waits=on');
    });
  });

  it('deadlock_timeout is left at its DEFAULT, deliberately', async () => {
    // The other half, and the one that keeps the instrument honest. Lowering
    // `deadlock_timeout` would make the detector fire sooner and read as progress, while
    // changing the thing being measured. If a future session lowers it to "help", this
    // fails and says why.
    await withClient(async (client) => {
      const result = await client.query<{ setting: string; source: string }>(
        `select setting, source from pg_settings where name = 'deadlock_timeout'`,
      );
      expect(result.rows[0]?.setting).toBe('1000');
      expect(
        result.rows[0]?.source,
        'deadlock_timeout has been changed from the default; see BE-W92 — the instrument must not change what it measures',
      ).toBe('default');
    });
  });
});
