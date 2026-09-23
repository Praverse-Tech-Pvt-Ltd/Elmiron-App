import { Client } from 'pg';
import { assertTargetAllowed } from './target-guard.mjs';

/**
 * BE-W21 — the forcing function on the UCPMP cap decision, and since MR-52 D4 on the
 * BE-W106 settings-model decision too. Two recorded acceptances, one step, the same shape:
 * a dated row in `app_thresholds` and a status function that reads the schema for whether
 * the question has actually been answered.
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

/**
 * MR-52 D4 — the same evaluation for `BE-W106`, the settings-model decision.
 *
 * `app_thresholds` stopped being directly readable in `20260923000300`, which removed the LEAK. The
 * model question — which settings belong to which company — is the operator's and stays open, so
 * the acceptance carries a date instead of running forever. `settingsScoped` is read from the
 * schema by `be_w106_decision_status()`, not from a flag: the answer lands as organisation scoping
 * on the table or it has not landed.
 *
 * @param {Record<string, unknown>} status the jsonb from public.be_w106_decision_status()
 * @returns {{ clear: boolean, reasons: string[], warnings: string[] }}
 */
export const evaluateSettingsModelDebt = (status) => {
  const reasons = [];
  const warnings = [];

  if (status === null || typeof status !== 'object') {
    return {
      clear: false,
      reasons: ['be_w106_decision_status() returned nothing readable.'],
      warnings,
    };
  }

  const due =
    status.dueAt === null || status.dueAt === undefined ? 'never set' : String(status.dueAt);

  if (status.overdue === true) {
    reasons.push(
      `BE-W106 is unanswered and its accepted deadline (${due}) has passed: app_thresholds still ` +
        'has no organisation scoping.',
    );
  } else if (status.overdue !== false) {
    reasons.push(`be_w106_decision_status() returned overdue=${String(status.overdue)}.`);
  } else if (status.warn === true) {
    warnings.push(
      `the BE-W106 settings-model decision is due on ${due}` +
        (status.daysRemaining === null || status.daysRemaining === undefined
          ? ''
          : ` -- ${String(status.daysRemaining)} day(s) left`) +
        '. After that this step fails the build.',
    );
  }

  return { clear: reasons.length === 0, reasons, warnings };
};

/**
 * MR-53 E3 — **each debt carries its own next step.**
 *
 * MR-52 D4 put a second dated decision into this one step, for a stated reason: "two places to
 * remember, and the one nobody remembers is the one that lapses". What it did not do was split
 * the ADVICE. The CLI printed the UCPMP question after every warning and after every failure, so
 * from 2026-10-10 -- when `BE-W106` enters its 21-day window, six days before the cap enters its
 * own -- a reader would have been told to go and ask the client what the UCPMP sample cap is in
 * order to clear a question about which settings belong to which company. On 2026-10-31 the same
 * wrong paragraph would have arrived attached to a RED build.
 *
 * That is the failure this repository names elsewhere as the worst kind: advice that looks like a
 * control while pointing somewhere else. So the question and the consequence belong to the debt,
 * not to the loop that prints them.
 */
const DEBTS = {
  ucpmpCap: {
    label: 'UCPMP sample cap',
    question:
      'What is the UCPMP sample cap, on what dimension, and who at the client owns\nthat number?',
    consequence:
      'Until it is set, public.enforce_ucpmp_sample_cap() is inert: samples are\n' +
      'accepted and uncounted, and the samples screen still says so.\n\n' +
      'Do NOT invent a value to clear this. Either set the real one, or file a\n' +
      'migration moving ucpmp_sample_cap_decision_due with the reason in its note.',
  },
  settingsModel: {
    label: 'BE-W106 settings model',
    question: 'Which settings belong to which company, and who owns that decision?',
    consequence:
      'Until it is answered, app_thresholds stays global: every organisation reads\n' +
      'one set of values, and the accessors that read them cannot tell them apart.\n' +
      'The LEAK is closed -- 20260923000300 revoked the direct select -- but the\n' +
      'model question is untouched by that.\n\n' +
      'Do NOT invent a scoping to clear this. Either land the decision on the table\n' +
      'as an organisation column or scope value, or file a migration moving\n' +
      'be_w106_settings_model_decision_due with the reason in its note.',
  },
};

/**
 * Both debts, each with its own advice, and the combined verdict the exit code reads.
 *
 * Pure and exported for the same reason the two evaluators are: the state where BOTH are inside
 * their windows at once lasts fifteen days in October 2026, and a control whose behaviour in that
 * state has never been seen is indistinguishable from one that gets it wrong.
 *
 * @param {Record<string, unknown> | null} capStatus jsonb from ucpmp_cap_decision_status()
 * @param {Record<string, unknown> | null} settingsStatus jsonb from be_w106_decision_status()
 */
export const evaluateAllDecisionDebt = (capStatus, settingsStatus) => {
  const debts = [
    { key: 'ucpmpCap', ...DEBTS.ucpmpCap, ...evaluateDecisionDebt(capStatus) },
    { key: 'settingsModel', ...DEBTS.settingsModel, ...evaluateSettingsModelDebt(settingsStatus) },
  ];
  return {
    debts,
    clear: debts.every((debt) => debt.clear),
    // Flattened as well, unchanged: the exit code and the run summary read the whole set.
    reasons: debts.flatMap((debt) => debt.reasons),
    warnings: debts.flatMap((debt) => debt.warnings),
  };
};

export const checkDecisionDebt = async (overrides = {}) => {
  const config = { ...DEFAULTS, ...overrides };
  // MR-43 D2 / `BE-W103`. Found by running every script against a non-resolving host rather
  // than by reading them: this one inherited SUPABASE_DB_URL with no guard at all. It is a
  // read, so the harm is a build decision taken against the wrong database rather than a
  // write -- but it FAILS CI on a date, and failing the build on production's thresholds
  // when the repository's own are what it is checking would be a hard defect to see.
  assertTargetAllowed({
    command: 'check:decision-debt',
    label: 'database URL',
    url: config.dbUrl,
    consequence: 'It decides whether the build fails on recorded decision debt.',
  });

  const client = new Client({ connectionString: config.dbUrl });
  await client.connect();

  try {
    const result = await client.query('select public.ucpmp_cap_decision_status() as status');
    const status = result.rows[0]?.status ?? null;

    // MR-52 D4. Two debts, one step: a second CI job for a second dated row would be two places
    // to remember, and the one nobody remembers is the one that lapses.
    const settingsResult = await client.query('select public.be_w106_decision_status() as status');
    const settingsStatus = settingsResult.rows[0]?.status ?? null;

    return { status, settingsStatus, ...evaluateAllDecisionDebt(status, settingsStatus) };
  } finally {
    await client.end();
  }
};

// CLI entry. Importing this module does not run anything.
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
) {
  const { status, settingsStatus, debts, clear } = await checkDecisionDebt();
  console.log(JSON.stringify({ ucpmpCap: status, settingsModel: settingsStatus }, null, 2));

  for (const debt of debts) {
    for (const warning of debt.warnings) {
      // ::warning:: is a GitHub Actions annotation, so this surfaces on the run summary
      // rather than only inside a log nobody opens on a green build.
      console.log(`::warning title=${debt.label} decision due::${warning}`);
      console.error(`\nA DECISION IS COMING DUE -- ${debt.label}:\n  - ${warning}`);
      console.error(`\n${debt.question}\n\nThis is not failing the build yet. It will.`);
    }
  }

  if (!clear) {
    // MR-53 E3. One block per unanswered decision, each with ITS OWN question and consequence.
    for (const debt of debts) {
      if (debt.clear) continue;
      console.error(`\nA DECISION IS OVERDUE -- ${debt.label}:`);
      for (const reason of debt.reasons) console.error(`  - ${reason}`);
      console.error(`\n${debt.question}\n\n${debt.consequence}`);
    }
    process.exit(1);
  }

  const days = status?.daysRemaining;
  console.log(
    days === null || days === undefined
      ? '\nUCPMP sample cap is configured. Nothing outstanding.'
      : `\nUCPMP sample cap decision is outstanding, ${String(days)} day(s) to the deadline.`,
  );

  const settingsDays = settingsStatus?.daysRemaining;
  console.log(
    settingsStatus?.settingsScoped === true
      ? 'BE-W106: app_thresholds carries organisation scoping. Nothing outstanding.'
      : settingsDays === null || settingsDays === undefined
        ? 'BE-W106: the settings-model decision is outstanding with no deadline.'
        : `BE-W106: the settings-model decision is outstanding, ${String(settingsDays)} day(s) to the deadline.`,
  );
}
