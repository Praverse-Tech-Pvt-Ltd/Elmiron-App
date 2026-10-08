#!/usr/bin/env node
/**
 * W2-I B1 — a company's AI switches, without SQL. `set_organisation_threshold` was called only by a
 * browser test, so switching a feature on for a company on day one was a hand-written SQL call.
 *
 *   status                 what is in force for the admin's company, feature by feature
 *   on  <feature…|all>     switch features on      (ai_feature_enabled:<feature> = true)
 *   off <feature…|all>     switch features off
 *   limit <n>              requests per person per day (ai_daily_requests_per_user), a whole number ≥ 1
 *
 *   LOADER_PASSWORD=… node services/api/scripts/ai-switches.mjs on mr_chat product_qa \
 *     --url http://127.0.0.1:54321 --key <publishable key> --email admin@company [--note "why"]
 *
 * **Why the names are checked here.** The function stores ANY key: `on mrchat` would be accepted, written,
 * and switch nothing on. So every name is checked against the five features the gateway serves before
 * anything is written, and one bad name writes nothing at all.
 *
 * **"On" is one of three conditions** (`20260924000700_ai_control_plane.sql`): the switch, an APPROVED
 * instruction set for the feature (four eyes, in the console), and a daily limit. `status` shows all
 * three, so "switched on but still refused" is visible before a rep meets it.
 *
 * It calls the same functions a console screen would, as the signed-in admin; the database refuses
 * anyone else (42501).
 */
import { restClient, signIn } from './content-loader.mjs';

/** The gateway's features — pinned equal to `GATEWAY_FEATURES` in packages/core by a test. */
export const SWITCHABLE = ['product_qa', 'mr_chat', 'lms_tutor', 'ai_doctor', 'ai_coach'];
const LIMIT_KEY = 'ai_daily_requests_per_user';
const switchKey = (feature) => `ai_feature_enabled:${feature}`;

/**
 * Parse a command. Pure: every problem at once, nothing written. No network.
 * @param {string[]} words
 */
export const parseSwitches = (words) => {
  const [verb = '', ...rest] = words;
  const problems = [];
  if (verb === 'status') {
    if (rest.length > 0) problems.push(`"status" takes nothing after it; got ${rest.join(' ')}`);
    return { command: { verb, writes: [] }, problems };
  }
  if (verb === 'on' || verb === 'off') {
    if (rest.length === 0) problems.push(`"${verb}" needs at least one feature, or "all"`);
    const features = rest.includes('all') ? [...SWITCHABLE] : rest;
    if (rest.includes('all') && rest.length > 1) problems.push('"all" cannot be mixed with names');
    for (const f of rest.filter((r) => r !== 'all')) {
      if (!SWITCHABLE.includes(f))
        problems.push(`"${f}" is not a feature; the features are ${SWITCHABLE.join(', ')}`);
    }
    return {
      command: {
        verb,
        writes: [...new Set(features)].map((f) => ({ key: switchKey(f), value: verb === 'on' })),
      },
      problems,
    };
  }
  if (verb === 'limit') {
    const n = rest[0] ?? '';
    if (rest.length !== 1 || !/^[1-9]\d{0,5}$/u.test(n))
      problems.push(`"limit" takes one whole number from 1 to 999999; got "${rest.join(' ')}"`);
    return { command: { verb, writes: [{ key: LIMIT_KEY, value: Number(n) }] }, problems };
  }
  problems.push(`"${verb}" — the commands are status, on, off and limit`);
  return { command: { verb, writes: [] }, problems };
};

/** What is in force for the signed-in admin's company: switch, approved instruction set, limit. */
const readStatus = async (rest) => {
  const read = async (key) =>
    /** @type {{ effectiveValue: unknown; hasOwnValue: boolean }} */ (
      await rest.rpc('organisation_threshold', { p_key: key })
    );
  const approved = new Set(
    (await rest.get('ai_prompt_versions?select=feature&status=eq.approved')).map((r) => r.feature),
  );
  const limit = (await read(LIMIT_KEY)).effectiveValue;
  const features = [];
  for (const feature of SWITCHABLE) {
    const on = (await read(switchKey(feature))).effectiveValue === true;
    features.push({ feature, on, approvedInstructions: approved.has(feature) });
  }
  return { limit: limit ?? null, features };
};

/**
 * @param {{ verb: string; writes: { key: string; value: unknown }[] }} command
 */
export const runSwitches = async (command, { url, apiKey, email, password, note, fetchImpl }) => {
  const session = await signIn({ url, apiKey, email, password, fetchImpl });
  const rest = restClient({ url, apiKey, token: session.token, fetchImpl });
  for (const w of command.writes) {
    await rest.rpc('set_organisation_threshold', {
      p_key: w.key,
      p_value: w.value,
      p_note: note ?? `Set with ai-switches.mjs by ${email}`,
    });
  }
  return readStatus(rest);
};

/** One line per feature; a feature that is on but cannot run says why. */
export const describeStatus = ({ limit, features }) =>
  [
    `daily limit per person: ${limit === null ? 'NOT SET — every feature refuses' : String(limit)}`,
    ...features.map(({ feature, on, approvedInstructions }) => {
      const why = [];
      if (!on) why.push('switched off');
      if (!approvedInstructions) why.push('no approved instruction set');
      if (limit === null) why.push('no daily limit');
      return `${feature.padEnd(11)} ${why.length === 0 ? 'RUNS' : `does not run: ${why.join(', ')}`}`;
    }),
  ].join('\n');

// CLI entry. Importing this module does not run anything.
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
) {
  const args = process.argv.slice(2);
  const words = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
  const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const { command, problems } = parseSwitches(words);
  if (problems.length > 0) {
    console.error(`NOTHING WRITTEN.\n${problems.map((p) => `  ${p}`).join('\n')}`);
    process.exit(2);
  }
  const password = process.env.LOADER_PASSWORD;
  if (password === undefined || password === '') {
    console.error(
      'LOADER_PASSWORD is not set. The admin password is read from the environment only.',
    );
    process.exit(2);
  }
  try {
    const status = await runSwitches(command, {
      url: opt('--url'),
      apiKey: opt('--key'),
      email: opt('--email'),
      password,
      note: opt('--note'),
    });
    console.log(describeStatus(status));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
