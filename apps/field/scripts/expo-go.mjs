#!/usr/bin/env node
/**
 * `FE-W206` — `pnpm expo-go`: the field app on a phone's Expo Go, from this laptop, in one command.
 *
 * Written 15 October 2026 for the owner, who works on an iPhone without a Mac and moves between
 * machines: *"tomorrow if I use another account on another device it should load all data of docker
 * and Expo Go, so I just have to start on the same Wi-Fi."* Before this it was six steps from three
 * pages, and the one everybody misses is that `apps/field/.env` (git-ignored, so absent on a fresh
 * clone) points the app at `127.0.0.1` — which, on a phone, is the phone.
 *
 * ## What it does, in order
 *
 *   1. **The local stack answers.** If it does not, `pnpm db:start` (the first run on a machine pulls
 *      the Supabase images: several GB, once). Docker Desktop must be running; this does not start it.
 *   2. **`pnpm key-day`**, unless `--no-seed`: the LOCAL test company, its people, approved content, a
 *      course, today's plans, every AI feature and live tracking on. Idempotent, so a second run only
 *      does what is missing. It needs no AI key: without one the AI answers from the labelled stub.
 *   3. **The laptop's Wi-Fi address** (`likelyLanAddress`, or `--ip <address>`), and the publishable key
 *      from `supabase status` — read into this process's environment, never printed.
 *   4. **`expo start --lan`** in `apps/field`, with the app pointed at `http://<address>:54321` and every
 *      built feature on, exactly the set the demo APK's `-AllFeatures` uses. Recording and coaching of
 *      real visits stay OFF (`D-15`). Values set here win over `apps/field/.env`.
 *
 * Then: open Expo Go on a phone on the same Wi-Fi, signed in to the same Expo account as
 * `npx expo login` here (Expo Go requires it since September 2026), and open the project. The
 * accounts are printed at the end; their password is the `password` field of
 * `services/api/.key-day/world.json`, which this script never prints.
 *
 *   pnpm expo-go                   everything above
 *   pnpm expo-go --no-seed         skip `pnpm key-day` (the stack is already seeded)
 *   pnpm expo-go --ip 192.168.1.7  use this address instead of guessing
 *
 * It never touches production: `key-day` refuses any target but this laptop, and the app is pointed
 * at this laptop's address only.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const REPO_ROOT = at('../../../');
const FIELD_DIR = at('../');
const WORLD_FILE = at('../../../services/api/.key-day/world.json');

/** The flags `build-demo-apk.ps1 -AllFeatures` turns on (`apps/field/src/features.ts`). */
export const ALL_FEATURE_FLAGS = [
  'EXPO_PUBLIC_LEARNING',
  'EXPO_PUBLIC_LESSON_TUTOR',
  'EXPO_PUBLIC_ASSISTANT',
  'EXPO_PUBLIC_PRODUCT_QA',
  'EXPO_PUBLIC_PRACTICE',
  'EXPO_PUBLIC_PRACTICE_VOICE',
  'EXPO_PUBLIC_LIVE_TRACKING',
];

/** `D-15`: blocked on the PV/DPDP signatory. Removed from the environment, whatever the shell says. */
export const MUST_BE_UNSET = ['EXPO_PUBLIC_COACHING_ENABLED', 'EXPO_PUBLIC_RECORDING_ENABLED'];

/** The root `.env.example`'s local `EXPO_PUBLIC_APP_*` values. Not secrets. */
export const LOCAL_APP_DEFAULTS = {
  EXPO_PUBLIC_APP_JWT_AUDIENCE: 'authenticated',
  EXPO_PUBLIC_APP_SITE_URL: 'http://127.0.0.1:3000',
  EXPO_PUBLIC_APP_DEEP_LINK_SCHEME: 'com.praversetech.fieldforce',
  EXPO_PUBLIC_APP_ADDITIONAL_REDIRECT_URLS: 'com.praversetech.fieldforce://auth-callback',
};

/** @param {readonly string[]} argv */
export const parseExpoGoArgs = (argv) => {
  const problems = [];
  let ip = null;
  let seed = true;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--no-seed') seed = false;
    else if (arg === '--ip') {
      const value = argv[i + 1];
      if (value === undefined || !/^\d{1,3}(\.\d{1,3}){3}$/u.test(value)) {
        problems.push('--ip needs an IPv4 address, e.g. --ip 192.168.1.7');
      } else ip = value;
      i += 1;
    } else problems.push(`unknown argument: ${String(arg)}`);
  }
  return { ip, seed, problems };
};

/**
 * The environment `expo start` runs with. Pure, so the one rule that matters — the phone is pointed
 * at the LAPTOP, never at 127.0.0.1 — is tested without a phone.
 *
 * @param {{ ip: string, publishableKey: string, base: Record<string, string | undefined> }} input
 */
export const expoGoEnv = ({ ip, publishableKey, base }) => {
  /** @type {Record<string, string | undefined>} */
  const env = { ...base };
  for (const name of MUST_BE_UNSET) delete env[name];
  for (const [name, value] of Object.entries(LOCAL_APP_DEFAULTS)) {
    if (env[name] === undefined || env[name] === '') env[name] = value;
  }
  for (const name of ALL_FEATURE_FLAGS) env[name] = 'true';
  env['EXPO_PUBLIC_SUPABASE_URL'] = `http://${ip}:54321`;
  env['EXPO_PUBLIC_SUPABASE_KEY'] = publishableKey;
  return env;
};

/** `supabase status -o env` → the publishable key, or '' when the stack gave none. */
export const publishableKeyFrom = (statusOutput) => {
  const line = statusOutput.split(/\r?\n/u).find((l) => l.startsWith('PUBLISHABLE_KEY='));
  return line === undefined
    ? ''
    : line.slice('PUBLISHABLE_KEY='.length).trim().replace(/^"|"$/gu, '');
};

const say = (text) => process.stdout.write(`${text}\n`);
const step = (text) => say(`\n==> ${text}`);
const isWindows = process.platform === 'win32';

/** `corepack pnpm …` from the repository root, inheriting the terminal. Returns the exit code. */
const pnpm = (args) =>
  spawnSync('corepack', ['pnpm', ...args], { cwd: REPO_ROOT, stdio: 'inherit', shell: isWindows })
    .status ?? 1;

const stackAnswers = async () => {
  try {
    const res = await fetch('http://127.0.0.1:54321/auth/v1/health', {
      signal: AbortSignal.timeout(5000),
    });
    // 401 without an apikey still means the gateway is up.
    return res.status < 500;
  } catch {
    return false;
  }
};

const main = async (argv) => {
  const args = parseExpoGoArgs(argv);
  if (args.problems.length > 0) {
    for (const p of args.problems) process.stderr.write(`${p}\n`);
    say('usage: pnpm expo-go [--no-seed] [--ip <address>]   (docs/operator/ios.md)');
    return 2;
  }
  say('pnpm expo-go — the field app on a phone, from this laptop, over this Wi-Fi');

  step('The local stack (Docker must be running)');
  if (await stackAnswers()) say('    ok: Supabase answers on this laptop');
  else {
    say('    not running: pnpm db:start (the first time on a machine downloads several GB)');
    if (pnpm(['db:start']) !== 0 || !(await stackAnswers())) {
      say('    STOPPED: the stack did not come up. Is Docker Desktop running?');
      return 1;
    }
  }

  if (args.seed) {
    step('pnpm key-day — the local TEST company and everything in it (safe to re-run)');
    if (pnpm(['key-day']) !== 0) {
      say('    STOPPED: key-day did not finish; its own message above says why.');
      return 1;
    }
  }

  step("This laptop's Wi-Fi address");
  const { likelyLanAddress } = await import('../../../services/api/scripts/key-day.mjs');
  const ip = args.ip ?? likelyLanAddress()?.address ?? null;
  if (ip === null) {
    say(
      '    STOPPED: no Wi-Fi address found. Run `ipconfig` and pass it: pnpm expo-go --ip <address>',
    );
    return 1;
  }
  say(`    ok: ${ip} (pass --ip to choose another)`);

  step('The publishable key, from `supabase status` (never printed)');
  const status = spawnSync(
    'corepack',
    ['pnpm', 'exec', 'supabase', '--workdir', 'services/api', 'status', '-o', 'env'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      shell: isWindows,
    },
  );
  const publishableKey = publishableKeyFrom(String(status.stdout ?? ''));
  if (publishableKey === '') {
    say('    STOPPED: `supabase status` gave no PUBLISHABLE_KEY. Is the stack running?');
    return 1;
  }
  say(`    ok: read (${String(publishableKey.length)} characters)`);

  step('Who to sign in as');
  if (existsSync(WORLD_FILE)) {
    const world = JSON.parse(readFileSync(WORLD_FILE, 'utf8'));
    for (const [role, email] of Object.entries(world.people ?? {}))
      say(`    ${role.padEnd(8)} ${String(email)}`);
    say(
      '    password: the "password" field of services/api/.key-day/world.json (not printed here)',
    );
  } else say('    no services/api/.key-day/world.json yet — run without --no-seed');

  step('Expo Go');
  say('    1. The phone on the SAME Wi-Fi as this laptop.');
  say('    2. Expo Go signed in to the same Expo account as `npx expo login` on this laptop.');
  say(`    3. Open the project under "Development servers", or enter exp://${ip}:8081`);
  say('    Stop with Ctrl+C. The app talks to THIS laptop: keep it on, with Docker running.');
  say(
    '    The AI screens need the gateway: in a second terminal, `pnpm functions:serve` (on Windows',
  );
  say(
    '    it exits 1 once serving; harmless). Without an OpenAI key it answers from the labelled stub.',
  );

  const child = spawn('npx', ['expo', 'start', '--lan'], {
    cwd: FIELD_DIR,
    stdio: 'inherit',
    shell: isWindows,
    env: expoGoEnv({ ip, publishableKey, base: process.env }),
  });
  return await new Promise((resolve) => {
    child.on('exit', (code) => resolve(code ?? 0));
  });
};

if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/gu, '/'))
) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
