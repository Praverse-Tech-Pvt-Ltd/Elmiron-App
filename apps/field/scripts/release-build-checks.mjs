#!/usr/bin/env node
/**
 * `BE-W177` — what a PRODUCTION APK build must have before Gradle is started.
 *
 *   node apps/field/scripts/release-build-checks.mjs
 *
 * Run by `build-release-apk.ps1`; importable for its tests. Reads the environment only, and REFUSES
 * (exit 1, every problem listed at once) unless:
 *   - the app configuration loads exactly as the app will load it (`loadAppConfig`, the same call
 *     `src/config.ts` makes at import) -- Supabase URL, publishable key, and the EXPO_PUBLIC_APP_*
 *     values -- and the Supabase URL is https and not a local stack;
 *   - the key is a PUBLISHABLE key: a secret key in a bundle bypasses row-level security on every
 *     installed copy;
 *   - FIELD_ANDROID_VERSION_CODE is set, and is a whole number in range (`android-release.cjs`);
 *   - the four release-signing values are set, the keystore exists, and none of them is the public
 *     Android debug key's (`debug.keystore`, `androiddebugkey`, password `android`);
 *   - DEMO_CLEARTEXT_HOSTS, recording and coaching are unset (a demo build is debug-signed on purpose).
 *
 * It never prints a value of a key or a password -- only the NAME of what is wrong.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename } from 'node:path';
import { isLocalTarget, loadAppConfig } from '@fieldforce/core';

const require = createRequire(import.meta.url);
/** @type {{ androidVersionCode: (raw: unknown) => number }} */
const { androidVersionCode } = require('../plugins/android-release.cjs');
/** @type {{ PROPERTIES: string[] }} */
const { PROPERTIES: SIGNING } = require('../plugins/release-signing.cjs');

const MUST_BE_UNSET = [
  'DEMO_CLEARTEXT_HOSTS',
  'EXPO_PUBLIC_RECORDING_ENABLED',
  'EXPO_PUBLIC_COACHING_ENABLED',
];

/** True when this publishable-key slot holds something that is not a publishable key. */
const isSecretKey = (/** @type {string} */ key) => {
  if (key.startsWith('sb_secret_')) return true;
  // A legacy JWT key: the service-role one carries role=service_role.
  const payload = key.split('.')[1];
  if (payload === undefined) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return claims?.role === 'service_role';
  } catch {
    return false;
  }
};

/**
 * Every reason this environment may not build a production APK. Empty: it may. Pure apart from
 * `exists`, which is injected.
 *
 * @param {Record<string, string | undefined>} env
 * @param {{ exists?: (path: string) => boolean }} [io]
 * @returns {string[]}
 */
export const releaseBuildProblems = (env, { exists = existsSync } = {}) => {
  const problems = [];
  const set = (/** @type {string} */ name) => (env[name] ?? '').trim() !== '';

  try {
    loadAppConfig({
      SUPABASE_URL: env['EXPO_PUBLIC_SUPABASE_URL'],
      SUPABASE_PUBLISHABLE_KEY: env['EXPO_PUBLIC_SUPABASE_KEY'],
      APP_JWT_AUDIENCE: env['EXPO_PUBLIC_APP_JWT_AUDIENCE'],
      APP_SITE_URL: env['EXPO_PUBLIC_APP_SITE_URL'],
      APP_ADDITIONAL_REDIRECT_URLS: env['EXPO_PUBLIC_APP_ADDITIONAL_REDIRECT_URLS'],
      APP_DEEP_LINK_SCHEME: env['EXPO_PUBLIC_APP_DEEP_LINK_SCHEME'],
    });
  } catch (error) {
    // The message names fields and schema rules, never a value.
    problems.push(
      `the app configuration does not load: ${String(/** @type {Error} */ (error).message)}`,
    );
  }

  const url = (env['EXPO_PUBLIC_SUPABASE_URL'] ?? '').trim();
  if (url !== '') {
    if (!url.startsWith('https://'))
      problems.push(
        'EXPO_PUBLIC_SUPABASE_URL is not https: a production build talks to a deployment',
      );
    if (isLocalTarget(url))
      problems.push('EXPO_PUBLIC_SUPABASE_URL is a local stack, not a deployment');
  }
  if (!set('EXPO_PUBLIC_SUPABASE_KEY')) {
    problems.push('EXPO_PUBLIC_SUPABASE_KEY is not set');
  } else if (isSecretKey((env['EXPO_PUBLIC_SUPABASE_KEY'] ?? '').trim())) {
    problems.push(
      'EXPO_PUBLIC_SUPABASE_KEY is a SECRET key; only the publishable key may enter the app',
    );
  }

  if (!set('FIELD_ANDROID_VERSION_CODE')) {
    problems.push(
      'FIELD_ANDROID_VERSION_CODE is not set: every build handed to a rep needs a new, larger number',
    );
  } else {
    try {
      androidVersionCode(env['FIELD_ANDROID_VERSION_CODE']);
    } catch (error) {
      problems.push(String(/** @type {Error} */ (error).message));
    }
  }

  const missing = SIGNING.filter((name) => !set(name));
  if (missing.length > 0) problems.push(`release signing not set: ${missing.join(', ')}`);
  const store = (env['FIELDFORCE_UPLOAD_STORE_FILE'] ?? '').trim();
  if (store !== '') {
    if (basename(store).toLowerCase() === 'debug.keystore')
      problems.push('FIELDFORCE_UPLOAD_STORE_FILE is the Android DEBUG keystore');
    else if (!exists(store))
      problems.push('FIELDFORCE_UPLOAD_STORE_FILE names a file that does not exist');
  }
  if ((env['FIELDFORCE_UPLOAD_KEY_ALIAS'] ?? '').trim().toLowerCase() === 'androiddebugkey')
    problems.push('FIELDFORCE_UPLOAD_KEY_ALIAS is the Android DEBUG key alias');
  for (const name of ['FIELDFORCE_UPLOAD_STORE_PASSWORD', 'FIELDFORCE_UPLOAD_KEY_PASSWORD']) {
    if (env[name] === 'android') problems.push(`${name} is the Android DEBUG key's password`);
  }

  for (const name of MUST_BE_UNSET) {
    if (set(name)) problems.push(`${name} is set; a production build leaves it unset`);
  }
  return problems;
};

// CLI entry. Importing this module does not run anything.
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/gu, '/'))
) {
  const problems = releaseBuildProblems(process.env);
  if (problems.length > 0) {
    console.error(
      `RELEASE BUILD REFUSED -- ${String(problems.length)} problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
    process.exit(1);
  }
  console.log('release configuration: ok (no value printed)');
}
