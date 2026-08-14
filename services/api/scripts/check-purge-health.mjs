import { Client } from 'pg';

/**
 * The retention watchdog.
 *
 * `audio_purge_health()` has existed since BE-W6 so that a stopped purge would be
 * visible rather than inferred. Nothing called it. A health function nobody calls is
 * the scheduler problem wearing a different hat, so this is the thing that calls it
 * and, when the answer is bad, FAILS — because a non-zero exit from a scheduled
 * GitHub Actions job sends mail to a person, and a row in a table does not.
 *
 * It runs as its own workflow, on its own schedule, deliberately separate from the
 * purge itself. A watchdog that shares a process with the thing it watches dies with
 * it and reports nothing.
 *
 * Run: pnpm --filter @elmiron/api check:purge-health
 */

const DEFAULTS = {
  dbUrl: process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  /**
   * BE-W8 addendum: this is a SEPARATE, deliberately loose signal from the
   * database's own `stalled` verdict (public.audio_purge_is_stalled(), backlog-
   * size-based since this addendum). It exists only to catch a worker that has
   * gone completely silent even when the fleet is too small for the backlog
   * count to trip the primary check. 12h, not the 3h this project shipped
   * earlier the same day and then reverted: a per-object age check that tight
   * trips on ordinary GitHub Actions scheduling jitter against an hourly cron
   * (already observed: a 1h46m nominal-to-actual gap on a real run).
   */
  runSilenceHours: Number(process.env.PURGE_RUN_SILENCE_HOURS ?? 12),
};

/**
 * Pure, so the failure path is testable without arranging a genuinely broken purge.
 *
 * @param {Record<string, unknown>} health the jsonb from public.audio_purge_health()
 * @param {{ runSilenceHours?: number, now?: Date }} [options]
 * @returns {{ healthy: boolean, reasons: string[] }}
 */
export const evaluatePurgeHealth = (health, options = {}) => {
  const runSilenceHours = options.runSilenceHours ?? DEFAULTS.runSilenceHours;
  const now = options.now ?? new Date();
  const reasons = [];

  const liveObjectCount = Number(health.liveObjectCount ?? 0);
  const lastSuccessfulRunAt =
    health.lastSuccessfulRunAt === null || health.lastSuccessfulRunAt === undefined
      ? null
      : new Date(String(health.lastSuccessfulRunAt));

  // The database's own verdict (public.audio_purge_is_stalled(), backlog-size-
  // based since the BE-W8 addendum): the worker cannot keep up with what it is
  // claiming, or a single object has gone unclaimed past the hard ceiling. This
  // is the condition that also stops new uploads being accepted, so by the time
  // it is true, MRs are already being refused. No specific hour number belongs
  // in this message: the DB composes two thresholds (a backlog multiplier and a
  // ceiling) into one boolean, and restating one of them here would drift the
  // moment either changes -- exactly the bug this addendum fixed.
  if (health.stalled === true) {
    reasons.push(
      `${String(health.overdueObjectCount ?? 0)} object(s) are past their purge date and the ` +
        'retention worker is stalled. New uploads are being refused.',
    );
  }

  // A SEPARATE, deliberately loose signal: the worker has not succeeded in a
  // long time, independent of whether a backlog has built up yet. Watching the
  // worker rather than only its effect, so the alert arrives before anything
  // actually goes overdue. Silent when the system holds no audio at all: a
  // fresh deployment has nothing to purge and is not broken.
  if (liveObjectCount > 0) {
    if (lastSuccessfulRunAt === null) {
      reasons.push(
        `${String(liveObjectCount)} live audio object(s) exist and the retention worker has ` +
          'never completed a successful run.',
      );
    } else {
      const hoursSince = (now.getTime() - lastSuccessfulRunAt.getTime()) / 3_600_000;
      if (hoursSince > runSilenceHours) {
        reasons.push(
          `the retention worker last succeeded ${hoursSince.toFixed(1)}h ago, over the ` +
            `${String(runSilenceHours)}h limit.`,
        );
      }
    }
  }

  return { healthy: reasons.length === 0, reasons };
};

export const checkPurgeHealth = async (overrides = {}) => {
  const config = { ...DEFAULTS, ...overrides };
  const client = new Client({ connectionString: config.dbUrl });
  await client.connect();

  try {
    const result = await client.query('select public.audio_purge_health() as health');
    const health = result.rows[0]?.health ?? {};
    return { health, ...evaluatePurgeHealth(health, { runSilenceHours: config.runSilenceHours }) };
  } finally {
    await client.end();
  }
};

// CLI entry. Importing this module does not run anything.
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
) {
  const { health, healthy, reasons } = await checkPurgeHealth();
  console.log(JSON.stringify(health, null, 2));

  if (!healthy) {
    console.error('\nAUDIO RETENTION IS NOT HEALTHY:');
    for (const reason of reasons) console.error(`  - ${reason}`);
    console.error(
      '\nThe 90-day retention promise is made on privacy grounds and is currently not being kept.\n' +
        'Run `pnpm --filter @elmiron/api purge:audio` and find out why the schedule stopped.',
    );
    process.exit(1);
  }

  console.log('\nAudio retention is healthy.');
}
