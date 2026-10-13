#!/usr/bin/env node
/**
 * `BE-W205` — `pnpm key-day`: ONE local command that makes everything testable once the AI key is in.
 *
 * The owner's goal, verbatim: *"Build everything so that I only push the API key and it is ready for
 * testing, nothing left."* Before this, "ready" was eleven commands across four pages (`HANDOVER.md`,
 * `DAY-ONE.md`, `START-HERE.md`, the loaders' own headers), two of them needing a SECOND admin who does
 * not exist in a fresh database, and every one needing the right flags typed. This runs them all, in
 * order, against the LOCAL stack, and prints what to do next.
 *
 *   pnpm key-day            build (or re-use) the local TEST company and make everything in it ready
 *   pnpm key-day --fresh    a NEW test company, even if one is already recorded
 *
 * ## What it does, in order
 *
 *   1. **Refuses any target but this laptop** (`target-guard.mjs`, with the remote opt-in IGNORED —
 *      see `refuseRemote`). Everything below writes fabricated people and invented content.
 *   2. **The stack is up and current**: auth answers, and every migration on disk is applied — compared
 *      by VERSION, not trusted from `db:start`, which applies nothing to an old database and exits 0
 *      (`docs/START-HERE.md`, "Already have a checkout?"). Otherwise: `pnpm db:reset`, and stop.
 *   3. **The functions `.env`**: is `AI_PROVIDER` set, is `OPENAI_API_KEY` present — NEVER a value. Absent
 *      is a WARNING, not a stop: the rest still runs and the gateway answers from the labelled stub.
 *   4. **A TEST company**: two admins (four eyes), a field manager, two reps in two territories with
 *      working hours, three fictional doctors each, a consent notice, and TODAY's beat plan for each rep.
 *   5. **The five instruction sets** from `docs/ai-platform/drafts/` and **the practice personas and
 *      scenarios** from `drafts/personas-and-scenarios.md` — admin A authors and submits, admin B
 *      approves, through the same RPCs the console calls. Scenario S6 is NOT loaded (`D-15`, below).
 *   6. **A TEST catalogue, one TEST approved document, one TEST course** (`key-day-content/`), through
 *      the real loaders and `content-step.mjs`, then approved (B), published and assigned to both reps.
 *   7. **The five AI features ON** and a daily limit (`ai-switches.mjs`), **live tracking ON** for this
 *      company, and **the live-tracking notice** proposed by A and approved by B.
 *   8. Prints the accounts, the console, and the exact next commands.
 *
 * ## Re-running it is safe (idempotent)
 *
 * The company it made is recorded in `services/api/.key-day/world.json` (git-ignored: it holds the
 * locally generated test passwords). A second run finds that company and only does what is not yet
 * done — an approved instruction set is not approved again, a switch that is on is not switched again,
 * today's plan is written only if today has none. **After `pnpm db:reset`** the recorded company no
 * longer exists, and a new one is made. `--fresh` makes a new one regardless; the old one is left.
 *
 * ## What it deliberately does NOT do
 *
 * * **Real-visit recording and coaching of real visits stay OFF** (`EXPO_PUBLIC_RECORDING_ENABLED`,
 *   `EXPO_PUBLIC_COACHING_ENABLED`): decision `D-15`, blocked on a PV/DPDP signatory (Q-13). So is
 *   practice scenario **S6** (a doctor reporting a reaction): whether practice may simulate an adverse
 *   event is a pharmacovigilance judgement (`drafts/personas-and-scenarios.md`).
 * * **No production action of any kind** — no link, deploy, secret or remote write. `docs/KEY-DAY.md`,
 *   "Production", is a page for a person, later.
 * * **It never reads, prints or stores the AI key.** It reports only whether the line is there.
 *
 * Every approval it records says, in its own attestation, that it is a LOCAL TEST approval and not an
 * operator decision — the database keeps that sentence, so a row can never be mistaken for real review.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { assertTargetAllowed } from './target-guard.mjs';
import {
  createAuthUser,
  DEFAULT_API_URL,
  DEFAULT_DB_URL,
  DEFAULT_SERVICE_ROLE_KEY,
} from './seed-one-mr.mjs';
import { restClient, signIn } from './content-loader.mjs';
import { checkCatalogue, loadCatalogue } from './load-catalogue.mjs';
import { checkCourse, loadCourse } from './load-course.mjs';
import { checkKnowledge, loadKnowledge } from './load-knowledge.mjs';
import { contentStep } from './content-step.mjs';
import { describeStatus, runSwitches, SWITCHABLE } from './ai-switches.mjs';

const at = (relative) => fileURLToPath(new URL(relative, import.meta.url));

export const REPO_ROOT = at('../../../');
export const MIGRATIONS_DIR = at('../supabase/migrations/');
export const FUNCTIONS_ENV = at('../supabase/functions/.env');
export const STATE_FILE = at('../.key-day/world.json');
export const CONTENT_DIR = at('./key-day-content/');
export const DRAFTS_DIR = at('../../../docs/ai-platform/drafts/');
export const NOTICE_DRAFT = at('../../../docs/operator/live-tracking-notice-DRAFT.md');

/**
 * The local stack's well-known ANON key — fixed and published by every local Supabase install, the
 * same default `tests/auth.ts` carries. Not a secret; a deployment rejects it.
 */
export const DEFAULT_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

/** Every name this script gives a row starts with this, so the company is never mistaken for real. */
export const MARKER = 'TEST Key-day';

/**
 * The output schema each feature's flow checks its approved prompt against — the same map as
 * `GATEWAY_OUTPUT_SCHEMA_NAME` in `@fieldforce/core`, which a script may not import
 * (`scripts-convention.spec.ts`); `key-day.spec.ts` pins the two equal.
 */
export const OUTPUT_SCHEMA = {
  product_qa: 'ProductQaOutputSchema',
  mr_chat: 'MrChatOutputSchema',
  lms_tutor: 'LmsTutorOutputSchema',
  ai_doctor: 'SimDoctorTurnOutputSchema',
  ai_coach: 'SimCoachOutputSchema',
};

/** Scenarios not loaded, and why. A person must decide them, not this script. */
export const PRACTICE_NOT_LOADED = {
  S6: "a doctor reporting a reaction is a possible adverse event; whether practice may simulate one is the PV signatory's decision (D-15)",
};

const ATTESTATION =
  'pnpm key-day: the DRAFT text, approved by a second TEST admin in a LOCAL TEST company only. Not an operator approval.';
const SWITCH_NOTE = 'pnpm key-day: LOCAL TEST company only. Not a decision for any real company.';

// ---------------------------------------------------------------------------------------------
// Pure parts. Each is tested in `tests/key-day.spec.ts` without a database or a network.
// ---------------------------------------------------------------------------------------------

/** @param {string[]} argv */
export const parseKeyDayArgs = (argv) => {
  const problems = [];
  for (const a of argv) {
    if (a !== '--fresh' && a !== '--help')
      problems.push(`"${a}" — the options are --fresh and --help`);
  }
  return { fresh: argv.includes('--fresh'), help: argv.includes('--help'), problems };
};

/**
 * What the functions `.env` holds — as FACTS ABOUT LINES, never a value. `text` null: no file.
 *
 * `provider` is printed only when it is a short lowercase word: a line written with `echo >>` onto a
 * file with no final newline reads `AI_PROVIDER=openaiOPENAI_API_KEY=sk-…`, and its "value" is the key.
 *
 * @param {string | null} text
 */
export const inspectFunctionsEnv = (text) => {
  if (text === null)
    return { exists: false, provider: null, openAiKey: 'absent', aws: false, glued: false };
  const values = Object.fromEntries(
    text
      .split(/\r?\n/u)
      .map((l) => /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/u.exec(l))
      .filter((m) => m !== null)
      .map((m) => [m[1], (m[2] ?? '').replace(/^"|"$/gu, '')]),
  );
  const glued = Object.values(values).some((v) => /[A-Z_]{4,}=/u.test(v));
  const raw = values['AI_PROVIDER'];
  const provider =
    raw === undefined || raw === ''
      ? null
      : /^[a-z][a-z0-9_-]{0,19}$/u.test(raw)
        ? raw
        : 'unreadable';
  const key = (values['OPENAI_API_KEY'] ?? '').trim();
  return {
    exists: true,
    provider,
    openAiKey: key === '' ? 'absent' : /REPLACE-ME/u.test(key) ? 'placeholder' : 'present',
    aws: Boolean(values['AWS_ACCESS_KEY_ID'] && values['AWS_SECRET_ACCESS_KEY']),
    glued,
  };
};

/**
 * What to say about the `.env`, and whether the AI will be the real vendor. Never a value.
 * @param {ReturnType<typeof inspectFunctionsEnv>} env
 * @returns {{ live: boolean; lines: string[] }}
 */
export const describeFunctionsEnv = (env) => {
  const stub =
    'until it is fixed the gateway answers from the labelled STUB — everything else below still runs';
  if (!env.exists)
    return {
      live: false,
      lines: [
        `WARNING: no services/api/supabase/functions/.env — ${stub}.`,
        '  Copy services/api/supabase/functions/.env.example to .env and paste the key IN AN EDITOR.',
      ],
    };
  const lines = [];
  if (env.glued)
    lines.push(
      'WARNING: a line in functions/.env holds two settings glued together (the `echo >>` trap, START-HERE Trap 4). Fix it in an editor.',
    );
  if (env.provider === 'openai') {
    if (env.openAiKey === 'present') {
      lines.push('AI_PROVIDER=openai; OPENAI_API_KEY is present (value not read or printed).');
      return { live: !env.glued, lines };
    }
    lines.push(
      env.openAiKey === 'placeholder'
        ? `WARNING: OPENAI_API_KEY is still the .env.example placeholder — ${stub} (503 no_provider).`
        : `WARNING: AI_PROVIDER=openai but no OPENAI_API_KEY line — ${stub} (503 no_provider).`,
    );
    return { live: false, lines };
  }
  if (env.provider === 'bedrock') {
    lines.push(
      env.aws
        ? 'AI_PROVIDER=bedrock; the AWS key lines are present (values not read or printed). The pilot provider is OpenAI (BE-C79).'
        : 'WARNING: AI_PROVIDER=bedrock but the AWS key lines are missing.',
    );
    return { live: env.aws && !env.glued, lines };
  }
  lines.push(
    env.provider === null
      ? `WARNING: AI_PROVIDER is not set in functions/.env — ${stub}.`
      : `WARNING: AI_PROVIDER is ${env.provider === 'unreadable' ? 'not a provider name (not printed)' : `"${env.provider}"`}, neither openai nor bedrock — ${stub}.`,
  );
  return { live: false, lines };
};

/**
 * Migrations on disk against migrations applied, by VERSION (the file name's prefix).
 * @param {string[]} files  `*.sql` names in the migrations folder
 * @param {string[]} applied  `supabase_migrations.schema_migrations.version`
 */
export const migrationGap = (files, applied) => {
  const onDisk = files.filter((f) => f.endsWith('.sql')).map((f) => f.split('_')[0]);
  const have = new Set(applied.map(String));
  const want = new Set(onDisk);
  return {
    onDisk: onDisk.length,
    applied: applied.length,
    missing: onDisk.filter((v) => !have.has(v)).sort(),
    unknown: [...have].filter((v) => !want.has(v)).sort(),
  };
};

/**
 * A draft instruction set: the first ```text block (the text) and the first ```json block (its
 * model config) — the same reading `tests/ai-live.spec.ts` does, so both approve identical words.
 * @param {string} feature
 * @param {string} file
 */
export const readDraftPrompt = (feature, file) => {
  const text = /```text\r?\n([\s\S]*?)\r?\n```/u.exec(file)?.[1];
  const modelConfig = /```json\r?\n([\s\S]*?)\r?\n```/u.exec(file)?.[1];
  if (text === undefined || modelConfig === undefined)
    throw new Error(`docs/ai-platform/drafts/${feature}.md has no \`\`\`text or \`\`\`json block`);
  return { text, modelConfig: JSON.parse(modelConfig) };
};

const cell = (s) => s.replace(/\*\*/gu, '').trim();

/**
 * The personas and scenarios of `drafts/personas-and-scenarios.md`, from its two tables. Scenarios in
 * `PRACTICE_NOT_LOADED` are returned separately, never dropped silently.
 * @param {string} file
 */
export const parsePracticeDrafts = (file) => {
  const personas = [];
  const scenarios = [];
  const skipped = [];
  for (const line of file.split(/\r?\n/u)) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map(cell);
    if (/^P\d$/u.test(cells[0] ?? '') && cells.length === 5) {
      const [code, displayName, specialty, stance, brief] = cells;
      personas.push({ code, displayName, specialty, stance: stance.replace(/`/gu, ''), brief });
    } else if (/^S\d$/u.test(cells[0] ?? '') && cells.length === 5) {
      const [code, persona, title, objective, objection] = cells;
      const row = {
        code,
        persona: persona.replace(/\s*\(.*\)$/u, '').trim(),
        title: title.replace(/^"|"$/gu, ''),
        objective,
        objection: objection.replace(/^"|"$/gu, ''),
      };
      if (code in PRACTICE_NOT_LOADED) skipped.push({ code, why: PRACTICE_NOT_LOADED[code] });
      else scenarios.push(row);
    }
  }
  return { personas, scenarios, skipped };
};

/**
 * The live-tracking notice for the TEST company: the engineering draft's text, under a first line
 * that says what it is. The draft's `[[ BLANK ]]` items stay visible on purpose — they are the
 * company's decisions, and a test company has made none.
 * @param {string} draft
 */
export const testNoticeBody = (draft) => {
  const start = draft.indexOf('## ');
  const text = start === -1 ? draft : draft.slice(start);
  return (
    'TEST COMPANY — LOCAL KEY-DAY REHEARSAL ONLY. This is the engineering DRAFT notice, not reviewed by ' +
    'legal and in force only in a throwaway local test company. Its [[ BLANK ]] items are a real ' +
    "company's decisions.\n\n" +
    text.trim()
  ).slice(0, 19_000);
};

/**
 * Refuses any target that is not this machine, BEFORE anything is opened. `target-guard.mjs`'s
 * opt-in (`ELMIRON_ALLOW_REMOTE_TARGET=1`) is deliberately not honoured: it exists for the scheduled
 * retention jobs, and nothing makes it right to put fabricated people into a deployment.
 */
export const refuseRemote = (targets) => {
  for (const { label, url } of targets) {
    assertTargetAllowed({
      command: 'key-day',
      label,
      url,
      consequence:
        'It creates fabricated people, a test company and test content, and approves them, which must never reach a deployment.',
      env: {},
    });
  }
};

/** The laptop's likely Wi-Fi address, for the APK command. A suggestion: `ipconfig` decides. */
export const likelyLanAddress = (interfaces = networkInterfaces()) => {
  const candidates = Object.entries(interfaces).flatMap(([name, list]) =>
    (list ?? [])
      .filter((a) => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
      .map((a) => ({ name, address: a.address })),
  );
  return (
    candidates.find((c) => /wi-?fi|wlan|wireless/iu.test(c.name)) ??
    candidates.find((c) => !/vethernet|wsl|docker|virtual|vmware|vbox/iu.test(c.name)) ??
    null
  );
};

// ---------------------------------------------------------------------------------------------
// The run.
// ---------------------------------------------------------------------------------------------

const say = (line = '') => process.stdout.write(`${line}\n`);
const step = (text) => say(`\n==> ${text}`);
const ok = (text) => say(`    ok: ${text}`);
const note = (text) => say(`    ${text}`);

const DOCTORS = {
  pune: [
    { name: 'Dr TEST Asha Deshpande', spec: 'Urology', line1: '12 FC Road', pin: '411004' },
    { name: 'Dr TEST Vikram Rao', spec: 'Nephrology', line1: '48 JM Road', pin: '411005' },
    { name: 'Dr TEST Meera Iyer', spec: 'General practice', line1: '3 Baner Road', pin: '411045' },
  ],
  mumbai: [
    { name: 'Dr TEST Rohan Mehta', spec: 'Urology', line1: '7 Linking Road', pin: '400050' },
    {
      name: 'Dr TEST Kavita Shah',
      spec: 'Internal medicine',
      line1: '21 Hill Road',
      pin: '400050',
    },
    { name: 'Dr TEST Arjun Nair', spec: 'Cardiology', line1: '5 Carter Road', pin: '400050' },
  ],
};
const CITY = {
  pune: { city: 'Pune', lat: 18.5204, lng: 73.8567 },
  mumbai: { city: 'Mumbai', lat: 19.0596, lng: 72.8295 },
};

/** A new TEST company, as the database owner — the part no screen can do (identities, a company). */
const createWorld = async ({ db, apiUrl, serviceRoleKey }) => {
  const run = randomUUID().slice(0, 6);
  // Locally generated, local only. Never a real person's password, and the stack is this laptop's.
  const password = `keyday-${randomBytes(9).toString('base64url')}`;
  const email = (who) => `keyday-${run}-${who}@example.test`;
  const people = {
    adminA: email('admin-a'),
    adminB: email('admin-b'),
    manager: email('manager'),
    rep1: email('rep-1'),
    rep2: email('rep-2'),
  };
  // Sequentially: a burst of GoTrue admin calls exhausts the local pool (seed-day.mjs, MR-07).
  const ids = {};
  for (const [key, address] of Object.entries(people)) {
    ids[key] = await createAuthUser(address, password, { apiUrl, serviceRoleKey });
  }
  const org = randomUUID();
  const region = randomUUID();
  const areas = { pune: randomUUID(), mumbai: randomUUID() };

  await db.query('begin');
  try {
    await db.query('insert into public.organisations (id, name) values ($1, $2)', [
      org,
      `${MARKER} Pharma ${run}`,
    ]);
    await db.query(
      `insert into public.territories (id, name, code, parent_id, organisation_id) values
         ($1, $4, $7, null, $10), ($2, $5, $8, $1, $10), ($3, $6, $9, $1, $10)`,
      [
        region,
        areas.pune,
        areas.mumbai,
        `${MARKER} West ${run}`,
        `${MARKER} Pune ${run}`,
        `${MARKER} Mumbai ${run}`,
        `KD-W-${run}`,
        `KD-W-PUN-${run}`,
        `KD-W-MUM-${run}`,
        org,
      ],
    );
    const profile = (id, name, role, territory, manager = null) =>
      db.query(
        `insert into public.user_profiles
           (id, full_name, role, territory_id, organisation_id, reporting_manager_id)
         values ($1, $2, $3, $4, $5, $6)`,
        [id, `${MARKER} ${name}`, role, territory, org, manager],
      );
    await profile(ids.adminA, 'Admin A', 'admin', null);
    await profile(ids.adminB, 'Admin B', 'admin', null);
    await profile(ids.manager, 'Manager', 'field_manager', region);
    await profile(ids.rep1, 'Rep 1 (Pune)', 'mr', areas.pune, ids.manager);
    await profile(ids.rep2, 'Rep 2 (Mumbai)', 'mr', areas.mumbai, ids.manager);

    // Working hours: wide, all week, so the day can be tested at whatever hour someone is testing
    // (seed-day.mjs). Set on the region; both areas inherit it.
    await db.query(
      `insert into public.territory_shift_windows
         (territory_id, shift_start, shift_end, timezone, grace_minutes, active_weekdays)
       values ($1, '04:00', '23:59', 'Asia/Kolkata', 30, '{1,2,3,4,5,6,7}')`,
      [region],
    );
    // A consent notice for THIS company (`BE-W79`), effective a month ago, or no consent can be taken.
    await db.query(
      `insert into public.consent_text_versions
         (id, version_label, language, full_text, effective_from, organisation_id)
       values ($1, $2, 'en-IN', $3, now() - interval '30 days', $4)`,
      [
        randomUUID(),
        `${MARKER} v1 ${run}`,
        'TEST consent notice for a local rehearsal. I agree to this conversation being recorded so that ' +
          'the representative’s team can review how they presented. The recording is kept for 90 days and ' +
          'then deleted. I may withdraw at any time by telling the representative.',
        org,
      ],
    );
    for (const [place, rep] of [
      ['pune', ids.rep1],
      ['mumbai', ids.rep2],
    ]) {
      for (const [i, d] of DOCTORS[place].entries()) {
        const doctorId = randomUUID();
        await db.query(
          `insert into public.doctors
             (id, organisation_id, full_name, registration_number, specialty, qualification,
              territory_id, assigned_mr_id)
           values ($1, $2, $3, $4, $5, 'MBBS (TEST)', $6, $7)`,
          [
            doctorId,
            org,
            `${d.name} (fictional)`,
            `KD-${run}-${place.slice(0, 3).toUpperCase()}-${String(i + 1)}`,
            d.spec,
            areas[place],
            rep,
          ],
        );
        await db.query(
          `insert into public.clinic_addresses
             (id, doctor_id, label, line1, city, state, postal_code, latitude, longitude)
           values ($1, $2, 'Main clinic (TEST)', $3, $4, 'Maharashtra', $5, $6, $7)`,
          [
            randomUUID(),
            doctorId,
            d.line1,
            CITY[place].city,
            d.pin,
            CITY[place].lat + i * 0.004,
            CITY[place].lng + i * 0.004,
          ],
        );
      }
    }
    await db.query('commit');
  } catch (error) {
    await db.query('rollback').catch(() => {});
    throw error;
  }
  return { run, organisationId: org, password, people, ids };
};

/** Today's plan for a rep, written by their manager's path — only if today has none yet. */
const ensureTodayPlan = async (db, managerId, repId) => {
  const existing = await db.query(
    `select count(*)::int as n from public.visits
      where mr_id = $1 and origin = 'planned' and status <> 'cancelled'
        and planned_date = public.rep_today($1)`,
    [repId],
  );
  if (existing.rows[0].n > 0) return { written: false, stops: existing.rows[0].n };
  const stops = await db.query(
    `select d.id as "doctorId", c.id as "clinicAddressId"
       from public.doctors d
       join public.clinic_addresses c on c.doctor_id = d.id
      where d.assigned_mr_id = $1 and d.is_active
      order by d.registration_number`,
    [repId],
  );
  // `write_plan_version` is the one path `plan_mr_day` uses and the only one that may create a planned
  // visit (`BE-C78`); called as the owner because a script is not a signed-in manager, but the plan is
  // still the MANAGER's (seed-day.mjs does the same).
  await db.query(
    `select public.write_plan_version(m, r, public.rep_today(r.id), $3::jsonb, null)
       from public.user_profiles m, public.user_profiles r
      where m.id = $1 and r.id = $2`,
    [managerId, repId, JSON.stringify(stops.rows)],
  );
  return { written: true, stops: stops.rows.length };
};

/** Author → submit → approve, whatever state a previous run left it in. Returns what it did. */
const fourEyes = async ({ row, insert, submit, approve }) => {
  if (row?.status === 'approved') return 'already approved';
  let current = row;
  if (current === undefined || !['draft', 'in_review'].includes(current.status)) {
    current = await insert();
  }
  if (current.status === 'draft') await submit(current.id);
  await approve(current.id);
  return 'approved (A submitted, B approved)';
};

const lower = (s) => String(s).trim().toLowerCase();

const main = async (argv) => {
  const args = parseKeyDayArgs(argv);
  if (args.problems.length > 0 || args.help) {
    for (const p of args.problems) process.stderr.write(`${p}\n`);
    say('usage: pnpm key-day [--fresh]   (docs/KEY-DAY.md)');
    return args.problems.length > 0 ? 2 : 0;
  }
  const apiUrl = process.env.SUPABASE_URL ?? DEFAULT_API_URL;
  const dbUrl = process.env.SUPABASE_DB_URL ?? DEFAULT_DB_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? DEFAULT_SERVICE_ROLE_KEY;
  const apiKey = process.env.SUPABASE_ANON_KEY ?? DEFAULT_ANON_KEY;

  say(
    'pnpm key-day — makes the LOCAL stack ready to test, once the AI key is in (docs/KEY-DAY.md)',
  );
  step('Checking the target is this laptop');
  refuseRemote([
    { label: 'API URL', url: apiUrl },
    { label: 'database URL', url: dbUrl },
  ]);
  ok(`${apiUrl} and the database are local`);

  step('Checking the local stack is up and current');
  try {
    const health = await fetch(`${apiUrl}/auth/v1/health`, { headers: { apikey: apiKey } });
    if (!health.ok) throw new Error(String(health.status));
  } catch {
    process.stderr.write(
      `\nSTOPPED: nothing answers at ${apiUrl}. Start the stack: pnpm db:start\n`,
    );
    return 1;
  }
  const db = new Client({ connectionString: dbUrl, connectionTimeoutMillis: 5000 });
  await db.connect();
  try {
    const applied = (
      await db.query('select version from supabase_migrations.schema_migrations')
    ).rows.map((r) => r.version);
    const gap = migrationGap(readdirSync(MIGRATIONS_DIR), applied);
    if (gap.missing.length > 0 || gap.unknown.length > 0) {
      process.stderr.write(
        `\nSTOPPED: the database is not the code's. ${String(gap.onDisk)} migrations on disk, ${String(gap.applied)} applied` +
          (gap.missing.length > 0
            ? `; not applied: ${gap.missing.slice(0, 3).join(', ')}${gap.missing.length > 3 ? ', …' : ''}`
            : '') +
          (gap.unknown.length > 0
            ? `; applied but not on disk: ${gap.unknown.slice(0, 3).join(', ')}`
            : '') +
          '.\n  pnpm db:start does not apply new migrations to an old database. Run: pnpm db:reset' +
          ' (local data is lost), then pnpm key-day again.\n',
      );
      return 1;
    }
    ok(`auth answers; all ${String(gap.onDisk)} migrations on disk are applied`);

    step('Checking services/api/supabase/functions/.env (no value is read out or printed)');
    const envText = existsSync(FUNCTIONS_ENV) ? readFileSync(FUNCTIONS_ENV, 'utf8') : null;
    const ai = describeFunctionsEnv(inspectFunctionsEnv(envText));
    for (const line of ai.lines) note(line);
    if (envText !== null) {
      try {
        execFileSync('git', ['check-ignore', '-q', FUNCTIONS_ENV], {
          cwd: REPO_ROOT,
          stdio: 'ignore',
        });
        ok('the file is git-ignored');
      } catch {
        process.stderr.write(
          '\nSTOPPED: services/api/supabase/functions/.env is NOT git-ignored here. Restore `.env` in .gitignore before anything else.\n',
        );
        return 1;
      }
    }

    step('The TEST company');
    let world = null;
    if (!args.fresh && existsSync(STATE_FILE)) {
      const recorded = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
      const found = await db.query('select 1 from public.organisations where id = $1', [
        recorded.organisationId,
      ]);
      if (found.rows.length === 1) {
        world = recorded;
        ok(
          `re-using ${MARKER} Pharma ${String(world.run)} (recorded in services/api/.key-day/world.json)`,
        );
      } else {
        note('the recorded test company is not in this database (reset since?) — making a new one');
      }
    }
    if (world === null) {
      world = await createWorld({ db, apiUrl, serviceRoleKey });
      mkdirSync(at('../.key-day/'), { recursive: true });
      writeFileSync(STATE_FILE, `${JSON.stringify(world, null, 2)}\n`);
      ok(
        `made ${MARKER} Pharma ${world.run}: 2 admins, a manager, 2 reps, 6 fictional doctors, working hours`,
      );
    }
    for (const rep of ['rep1', 'rep2']) {
      const plan = await ensureTodayPlan(db, world.ids.manager, world.ids[rep]);
      ok(
        `${rep}: today's beat plan ${plan.written ? 'written' : 'already there'} (${String(plan.stops)} stops)`,
      );
    }

    const as = async (who) => {
      const session = await signIn({
        url: apiUrl,
        apiKey,
        email: world.people[who],
        password: world.password,
      });
      return { ...session, rest: restClient({ url: apiUrl, apiKey, token: session.token }) };
    };
    const a = await as('adminA');
    const b = await as('adminB');
    const target = { url: apiUrl, apiKey, email: world.people.adminA, password: world.password };

    step('The five instruction sets, from docs/ai-platform/drafts/ (A submits, B approves)');
    for (const feature of SWITCHABLE) {
      const draft = readDraftPrompt(feature, readFileSync(`${DRAFTS_DIR}${feature}.md`, 'utf8'));
      const rows = await a.rest.get(
        `ai_prompt_versions?select=id,status&feature=eq.${feature}&order=created_at.desc`,
      );
      const outcome = await fourEyes({
        row:
          rows.find((r) => r.status === 'approved') ??
          rows.find((r) => ['draft', 'in_review'].includes(r.status)),
        insert: () =>
          a.rest.insert('ai_prompt_versions', {
            feature,
            system_prompt: draft.text,
            output_schema_name: OUTPUT_SCHEMA[feature],
            model_config: draft.modelConfig,
            created_by_user_id: a.userId,
          }),
        submit: (id) => a.rest.rpc('submit_ai_prompt_version', { p_version_id: id }),
        approve: (id) =>
          b.rest.rpc('approve_ai_prompt_version', { p_version_id: id, p_attestation: ATTESTATION }),
      });
      ok(`${feature.padEnd(11)} ${outcome}`);
    }

    step(
      'Practice personas and scenarios, from drafts/personas-and-scenarios.md (A submits, B approves)',
    );
    const practice = parsePracticeDrafts(
      readFileSync(`${DRAFTS_DIR}personas-and-scenarios.md`, 'utf8'),
    );
    const personaIds = {};
    const heldPersonas = await a.rest.get(
      'sim_personas?select=id,display_name,status&order=created_at.desc',
    );
    for (const p of practice.personas) {
      const mine = heldPersonas.filter((r) => lower(r.display_name) === lower(p.displayName));
      let id = null;
      const outcome = await fourEyes({
        row:
          mine.find((r) => r.status === 'approved') ??
          mine.find((r) => ['draft', 'in_review'].includes(r.status)),
        insert: () =>
          a.rest.insert('sim_personas', {
            display_name: p.displayName,
            specialty: p.specialty,
            stance: p.stance,
            brief: p.brief,
            created_by_user_id: a.userId,
          }),
        submit: (x) => a.rest.rpc('submit_sim_content', { p_kind: 'persona', p_id: x }),
        approve: (x) => {
          id = x;
          return b.rest.rpc('approve_sim_content', {
            p_kind: 'persona',
            p_id: x,
            p_attestation: ATTESTATION,
          });
        },
      });
      personaIds[p.code] = id ?? mine.find((r) => r.status === 'approved')?.id;
      ok(`${p.code} ${p.displayName}: ${outcome}`);
    }
    const heldScenarios = await a.rest.get(
      'sim_scenarios?select=id,title,status&order=created_at.desc',
    );
    for (const s of practice.scenarios) {
      const mine = heldScenarios.filter((r) => lower(r.title) === lower(s.title));
      const outcome = await fourEyes({
        row:
          mine.find((r) => r.status === 'approved') ??
          mine.find((r) => ['draft', 'in_review'].includes(r.status)),
        insert: () =>
          a.rest.insert('sim_scenarios', {
            persona_id: personaIds[s.persona],
            title: s.title,
            objective: s.objective,
            objection: s.objection,
            created_by_user_id: a.userId,
          }),
        submit: (x) => a.rest.rpc('submit_sim_content', { p_kind: 'scenario', p_id: x }),
        approve: (x) =>
          b.rest.rpc('approve_sim_content', {
            p_kind: 'scenario',
            p_id: x,
            p_attestation: ATTESTATION,
          }),
      });
      ok(`${s.code} ${s.title}: ${outcome}`);
    }
    for (const s of practice.skipped) note(`${s.code} NOT loaded: ${s.why}`);

    step('TEST catalogue, approved document and course (the real loaders, as admin A)');
    const content = (name) => readFileSync(`${CONTENT_DIR}${name}.md`, 'utf8');
    const catalogue = checkCatalogue(content('catalogue'));
    if (catalogue.problems.length > 0)
      throw new Error('key-day-content/catalogue.md does not check');
    await loadCatalogue(catalogue.catalogue, target);
    ok('catalogue: market India, product Testoval TEST (re-running writes only what is missing)');

    const knowledge = checkKnowledge(content('knowledge'));
    if (knowledge.problems.length > 0)
      throw new Error('key-day-content/knowledge.md does not check');
    const docs = (await a.rest.get('knowledge_documents?select=id,title')).filter(
      (d) => lower(d.title) === lower(knowledge.doc.title),
    );
    const versions =
      docs.length === 0
        ? []
        : await a.rest.get(
            `knowledge_document_versions?select=id,status&document_id=eq.${docs[0].id}&order=created_at.desc`,
          );
    const docOutcome = await fourEyes({
      row:
        versions.find((v) => v.status === 'approved') ??
        versions.find((v) => ['draft', 'in_review'].includes(v.status)),
      insert: async () => ({
        id: (await loadKnowledge(knowledge.doc, target)).versionId,
        status: 'draft',
      }),
      submit: () => contentStep('submit-knowledge', knowledge.doc.title, target),
      approve: (id) =>
        b.rest.rpc('approve_knowledge_version', { p_version_id: id, p_attestation: ATTESTATION }),
    });
    ok(`document "${knowledge.doc.title}": ${docOutcome}`);

    const course = checkCourse(content('course'));
    if (course.problems.length > 0) throw new Error('key-day-content/course.md does not check');
    const findCourse = async () =>
      (await a.rest.get('courses?select=id,title')).find(
        (c) => lower(c.title) === lower(course.course.title),
      );
    let held = await findCourse();
    const courseVersions =
      held === undefined
        ? []
        : await a.rest.get(
            `course_versions?select=id,status,course_modules(id)&course_id=eq.${held.id}`,
          );
    if (courseVersions.some((v) => v.status === 'published')) {
      ok(`course "${course.course.title}": already published`);
    } else {
      // A draft WITH lessons is a previous run's load: publish it. An EMPTY draft is a load that failed
      // part-way, which `loadCourse` itself re-uses (`BE-W167`), so it is loaded again.
      const loaded = courseVersions.some(
        (v) => v.status === 'draft' && v.course_modules.length > 0,
      );
      if (!loaded) await loadCourse(course.course, target);
      await contentStep('publish-course', course.course.title, target);
      held = await findCourse();
      ok(`course "${course.course.title}": loaded and published (no second admin: Q-21)`);
    }
    for (const rep of ['rep1', 'rep2']) {
      await a.rest.rpc('assign_course', {
        p_course_id: held.id,
        p_assignee_user_id: world.ids[rep],
        p_due_on: null,
      });
    }
    ok('course assigned to both reps');

    step('AI features ON, a daily limit (ai-switches.mjs)');
    const before = await runSwitches({ verb: 'status', writes: [] }, target);
    const writes = before.features
      .filter((f) => !f.on)
      .map((f) => ({ key: `ai_feature_enabled:${f.feature}`, value: true }));
    if (before.limit === null) writes.push({ key: 'ai_daily_requests_per_user', value: 100 });
    const status =
      writes.length === 0
        ? before
        : await runSwitches({ verb: 'on', writes }, { ...target, note: SWITCH_NOTE });
    for (const line of describeStatus(status).split('\n')) note(line);

    step('Live tracking ON for this TEST company, and its notice (A proposes, B approves)');
    const tracking = await a.rest.rpc('organisation_threshold', { p_key: 'live_tracking_enabled' });
    if (tracking?.effectiveValue === true) ok('the company switch is already ON');
    else {
      await a.rest.rpc('set_live_tracking_enabled', { p_enabled: true, p_reason: SWITCH_NOTE });
      ok('the company switch is ON');
    }
    const notices = await a.rest.rpc('live_tracking_notices', {});
    const versionsHeld = notices?.versions ?? [];
    if (versionsHeld.some((v) => v.status === 'in_force'))
      ok('a company notice is already in force');
    else {
      const waiting = versionsHeld.find((v) => v.status === 'waiting' && v.authoredByYou);
      const id =
        waiting?.id ??
        (await a.rest.rpc('propose_live_tracking_notice', {
          p_version_label: `${MARKER} notice v1 ${String(world.run)}`,
          p_body: testNoticeBody(readFileSync(NOTICE_DRAFT, 'utf8')),
        }));
      await b.rest.rpc('approve_live_tracking_notice', {
        p_notice_version_id: id,
        p_attestation: ATTESTATION,
      });
      ok('the TEST notice is in force (each rep accepts it in the app)');
    }

    step('Is the AI gateway served?');
    let served = false;
    try {
      const r = await fetch(`${apiUrl}/functions/v1/ai-gateway`, { method: 'POST' });
      served = r.status === 401 && (await r.json().catch(() => null))?.code === '28000';
    } catch {
      served = false;
    }
    note(
      served
        ? 'yes — ai-gateway answers (restart it if you changed functions/.env since)'
        : 'not yet — run pnpm functions:serve in a second terminal',
    );

    const lan = likelyLanAddress();
    const ip = lan?.address ?? '<laptop address from ipconfig>';
    say('\n================================================================================');
    say(`READY — ${MARKER} Pharma ${String(world.run)}, LOCAL ONLY. Test accounts, not people.`);
    say('================================================================================');
    say(`  password (all five):   ${world.password}`);
    say(`  admin A (console):     ${world.people.adminA}`);
    say(`  admin B (console):     ${world.people.adminB}`);
    say(`  field manager:         ${world.people.manager}`);
    say(`  rep 1, Pune (app):     ${world.people.rep1}`);
    say(`  rep 2, Mumbai (app):   ${world.people.rep2}`);
    say('');
    say(
      '  AI:    ' +
        (ai.live
          ? 'the key line is in place.'
          : 'NO KEY — the gateway answers from the labelled stub until the .env is fixed.'),
    );
    say('');
    say('  Next, in order:');
    say(
      '    1. pnpm functions:serve                      (second terminal; restart it after any .env change)',
    );
    say(
      '    2. pnpm ai:live                              (all five features against the real model; read BOTH runner lines)',
    );
    say('    3. the console: copy apps/console/.env.example to apps/console/.env.local once, then');
    say(
      '       pnpm --filter @fieldforce/console dev      → http://localhost:3100/sign-in  (admin A or B)',
    );
    say(
      `    4. the demo APK with every built feature on (phone on the same Wi-Fi; ${lan === null ? 'find the address with ipconfig' : `${lan.name} looks like ${lan.address} — check with ipconfig`}):`,
    );
    say(
      `       powershell -ExecutionPolicy Bypass -File apps\\field\\scripts\\build-demo-apk.ps1 -Ip ${ip} -AllFeatures -CheckOnly`,
    );
    say(
      `       powershell -ExecutionPolicy Bypass -File apps\\field\\scripts\\build-demo-apk.ps1 -Ip ${ip} -AllFeatures`,
    );
    say('');
    say('  Still OFF, on purpose: recording of real visits and coaching of real visits');
    say(
      '  (EXPO_PUBLIC_RECORDING_ENABLED, EXPO_PUBLIC_COACHING_ENABLED) and practice scenario S6 —',
    );
    say('  decision D-15, blocked on the PV/DPDP signatory (Q-13). Nothing here changes that.');
    say('');
    say(
      '  Re-run any time: pnpm key-day (re-uses this company)  |  pnpm key-day --fresh (a new one)',
    );
    return 0;
  } finally {
    await db.end();
  }
};

// CLI entry. Importing this module does not run anything.
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(
        `\nkey-day STOPPED: ${error instanceof Error ? error.message : String(error)}\n` +
          '  Everything done before this point is kept; fix the cause and run pnpm key-day again — it re-uses the company.\n',
      );
      process.exitCode = 1;
    });
}
