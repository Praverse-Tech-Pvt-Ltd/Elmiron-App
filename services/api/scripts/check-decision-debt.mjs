import { Client } from 'pg';

/**
 * BE-W21 — the forcing function on the UCPMP cap decision.
 *
 * `20260907000700_ucpmp_sample_caps.sql` built the cap and deliberately left the
 * ceiling null, because nothing in this repository states what the UCPMP limit is and
 * a constraint built on an invented number looks enforced while being wrong invisibly.
 * That is correct and it leaves the mechanism INERT until somebody with authority
 * answers the question. Nothing was making anybody answer it.
 *
 * This is the thing that makes them. It fails CI once the deadline in
 * `ucpmp_sample_cap_decision_due` passes and the cap is still unset — the same shape as
 * `check:purge-health`, and for the same stated reason: a non-zero exit from a CI job
 * reaches a person, and a null in a table does not.
 *
 * **It deliberately does NOT block a sample write or a `pnpm test` run.** A control that
 * breaks a developer's afternoon over a decision they do not own gets skipped, and a
 * skipped control is not a control. The suite tests the MECHANISM against a backdated
 * row (`decision-debt.spec.ts`); only CI is calendar-sensitive.
 *
 * Escaping it is possible on purpose: set `ucpmp_sample_cap_quantity`, or file a new
 * migration inserting a later `ucpmp_sample_cap_decision_due` with a reason in its note.
 * `app_thresholds` is append-only, so a deferral is a dated, attributable row.
 *
 * Plain `.mjs` with `pg` and no workspace imports, like its five siblings —
 * `scripts-convention.spec.ts` fails the build if that ever stops being true, because
 * nothing builds `packages/core` before a workflow runs a script directly.
 *
 * Run: pnpm --filter @fieldforce/api check:decision-debt
 */

const DEFAULTS = {
  dbUrl: process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
};

/**
 * Pure, so the overdue path is testable without waiting for November.
 *
 * Three states, not two. `clear` decides the exit code; `warnings` are printed and do
 * NOT fail the build. A control that goes red three weeks early has moved the deadline
 * and lied about which day it was -- but a red build arriving unannounced on the day is
 * treated as an obstacle to get past, where a warning three weeks earlier is treated as
 * a question. So: warn, then fail.
 *
 * @param {Record<string, unknown>} status the jsonb from public.ucpmp_cap_decision_status()
 * @returns {{ clear: boolean, reasons: string[], warnings: string[] }}
 */
export const evaluateDecisionDebt = (status) => {
  const reasons = [];
  const warnings = [];

  // Fail closed on a shape this script does not recognise. A control that treats an
  // unreadable answer as "fine" is the inert `ALTER DEFAULT PRIVILEGES` of FIX-05.
  if (status === null || typeof status !== 'object') {
    return {
      clear: false,
      reasons: ['ucpmp_cap_decision_status() returned nothing readable.'],
      warnings,
    };
  }

  const due =
    status.dueAt === null || status.dueAt === undefined ? 'never set' : String(status.dueAt);

  if (status.overdue === true) {
    reasons.push(
      `the UCPMP sample cap is still unconfigured and its decision deadline (${due}) has passed.`,
    );
  } else if (status.overdue !== false) {
    reasons.push(`ucpmp_cap_decision_status() returned overdue=${String(status.overdue)}.`);
  } else if (status.warn === true) {
    // Not a failure. `warn` and `overdue` are mutually exclusive in the database, so
    // this branch can never suppress the one above.
    warnings.push(
      `the UCPMP sample cap decision is due on ${due}` +
        (status.daysRemaining === null || status.daysRemaining === undefined
          ? ''
          : ` -- ${String(status.daysRemaining)} day(s) left`) +
        '. After that this step fails the build.',
    );
  }

  return { clear: reasons.length === 0, reasons, warnings };
};

export const checkDecisionDebt = async (overrides = {}) => {
  const config = { ...DEFAULTS, ...overrides };
  const client = new Client({ connectionString: config.dbUrl });
  await client.connect();

  try {
    const result = await client.query('select public.ucpmp_cap_decision_status() as status');
    const status = result.rows[0]?.status ?? null;
    return { status, ...evaluateDecisionDebt(status) };
  } finally {
    await client.end();
  }
};

// CLI entry. Importing this module does not run anything.
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
) {
  const { status, clear, reasons, warnings } = await checkDecisionDebt();
  console.log(JSON.stringify(status, null, 2));

  for (const warning of warnings) {
    // ::warning:: is a GitHub Actions annotation, so this surfaces on the run summary
    // rather than only inside a log nobody opens on a green build.
    console.log(`::warning title=Decision due::${warning}`);
    console.error(`\nA DECISION IS COMING DUE:\n  - ${warning}`);
    console.error(
      '\nWhat is the UCPMP sample cap, on what dimension, and who at the client owns\n' +
        'that number? This is not failing the build yet. It will.',
    );
  }

  if (!clear) {
    console.error('\nA DECISION IS OVERDUE:');
    for (const reason of reasons) console.error(`  - ${reason}`);
    console.error(
      '\nWhat is the UCPMP sample cap, on what dimension, and who at the client owns\n' +
        'that number? Until it is set, public.enforce_ucpmp_sample_cap() is inert:\n' +
        'samples are accepted and uncounted, and the samples screen still says so.\n\n' +
        'Do NOT invent a value to clear this. Either set the real one, or file a\n' +
        'migration moving ucpmp_sample_cap_decision_due with the reason in its note.',
    );
    process.exit(1);
  }

  const days = status?.daysRemaining;
  console.log(
    days === null || days === undefined
      ? '\nUCPMP sample cap is configured. Nothing outstanding.'
      : `\nUCPMP sample cap decision is outstanding, ${String(days)} day(s) to the deadline.`,
  );
}
