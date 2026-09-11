#!/usr/bin/env node
/**
 * BE-W92 — turn `log_lock_waits` on. Instrument the deadlock; do not force it.
 *
 * One deadlock has been observed on this project: once, during MR-26. MR-27 D1 tried to
 * reproduce it — three concurrent full-suite runs and five sequential ones, 0 in 9 — and
 * established only that concurrency against one database manufactures cross-run
 * interference rather than reproducing this. `BE-W92`'s verification order wants the
 * RELATION NAMES first, and the only thing that can supply them is Postgres at the moment
 * it happens.
 *
 * ## Why this is a script and NOT a migration
 *
 * It was written as a migration first, and the migration failed:
 *
 *     ERROR:  permission denied to set parameter "log_lock_waits"
 *
 * `log_lock_waits` is a `SUSET` parameter, and Supabase's `postgres` role — which every
 * migration runs as — is not a superuser. Only `supabase_admin` is. So this cannot live in
 * `supabase/migrations/`, and leaving a migration there that fails on every fresh database
 * would be worse than not having one.
 *
 * It connects as `supabase_admin` for that reason and for no other. Nothing else in this
 * repository does, and nothing else should: this is a cluster-level observation setting,
 * not schema.
 *
 * ## What it deliberately does NOT change
 *
 * `deadlock_timeout` stays at its default. Lowering it would make the detector fire sooner
 * and would read as progress, while changing the thing being measured — MR-27 D1's mistake
 * one layer down. `lock-wait-logging.spec.ts` asserts it is still `default` for exactly
 * that reason, so a future session that lowers it "to help" fails with the reason attached.
 *
 * `log_min_duration_statement` stays off: slow-statement lines would bury the lock lines
 * they are supposed to stand out from.
 *
 * ## What it gives
 *
 * A log line whenever a session waits longer than `deadlock_timeout` for a lock, naming the
 * lock, the relation and the blocking PID — for waits that RESOLVE as well as waits that
 * deadlock. That second half is the point. A deadlock seen once is a race lost once, and
 * the same contention is almost certainly being won the rest of the time, silently. This
 * makes the near-misses visible without needing the miss.
 *
 * **No mechanism is proposed and none should be read into this.** There is one observation
 * and no relation names; anything said about the cause today would be a story fitted to a
 * single event.
 *
 * Run after `db:start` or `db:reset`, and in CI's database job before the suites.
 */

import { Client } from 'pg';

const ADMIN_URL =
  process.env['SUPABASE_ADMIN_DB_URL'] ??
  'postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres';

const run = async () => {
  const client = new Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    await client.query('alter database postgres set log_lock_waits = on');

    // Read it back from `pg_db_role_setting` rather than trusting the statement's exit.
    // `ALTER DATABASE` applies to sessions opened AFTERWARDS, so `current_setting()` on
    // THIS connection still reports the old value — a true reading of a stale session, and
    // the kind of check that reports success while proving nothing.
    const stored = await client.query(
      `select s.setconfig
         from pg_db_role_setting s
         join pg_database d on d.oid = s.setdatabase
        where d.datname = 'postgres' and s.setrole = 0`,
    );
    const settings = stored.rows[0]?.setconfig ?? [];
    if (!settings.includes('log_lock_waits=on')) {
      throw new Error(
        `log_lock_waits was NOT stored on the database. Stored settings: ${JSON.stringify(settings)}. ` +
          'The ALTER succeeded and the setting is absent, which means it was written somewhere ' +
          'this reads from and should not be trusted -- fix the reader before trusting this run.',
      );
    }

    // The other half, reported rather than changed. If somebody has moved
    // `deadlock_timeout`, the instrument is no longer measuring what it was turned on for
    // and the person running this should know now rather than when reading the log.
    const timeout = await client.query(
      `select setting, source from pg_settings where name = 'deadlock_timeout'`,
    );
    const { setting, source } = timeout.rows[0] ?? {};
    if (source !== 'default') {
      process.stderr.write(
        `WARNING: deadlock_timeout is ${String(setting)}ms from source '${String(source)}', not the default.\n` +
          '  BE-W92 wants it left alone: the instrument must not change what it measures.\n',
      );
    }

    process.stdout.write(
      `log_lock_waits=on stored on database "postgres". deadlock_timeout ${String(setting)}ms (${String(source)}), unchanged.\n` +
        '  Takes effect for sessions opened from now on. BE-W92: observation only -- no mechanism is claimed.\n',
    );
  } finally {
    await client.end();
  }
};

await run();
