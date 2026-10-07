/**
 * W2-A A (`BE-C70`) — the service-role key is read in exactly ONE place, or the build fails.
 *
 * `C30` once guaranteed the key had NO reference in the Edge Function, so nobody in a hurry could reach
 * for it. `BE-C69` (W1-Z) needed the key for two practice writes and spent that guarantee. This check is
 * what replaces it — a property that cannot be broken quietly:
 *
 *   1. the key's NAME appears in code (comments excepted) exactly once under `supabase/functions`, and
 *      that once is a `Deno.env.get(...)` in `_shared/practice-writer.ts`;
 *   2. nothing under `supabase/functions` reads the WHOLE environment (`Deno.env.toObject()`);
 *   3. every `Deno.env.get(...)` names its variable as a string literal — a computed name could be
 *      the key under another spelling;
 *   4. `_shared/practice-writer.ts` exports exactly one name, `practiceWriterFromEnv` — never the key,
 *      never the client — and its allow-list is exactly `record_sim_turn`, `record_sim_coach_analysis`
 *      and (W2-E C, `BE-W146`) `ai_gateway_complete_request`;
 *   5. `packages/core/src`, which the function imports, reads no environment at all;
 *   6. (W2-B E) the OTHER credentials the platform hands every Edge Function by default — since W2-C
 *      D2 the LEGACY service-role key (`SUPABASE_SERVICE_ROLE_KEY`), `SUPABASE_SECRET_KEY` (the local
 *      single-key fallback) and the direct database URL (`SUPABASE_DB_URL`) — are not named in
 *      function code AT ALL. (Until W2-C the legacy key was the one read and the new keys were here.)
 *      Supabase's own guide says a secret key "will bypass Row Level Security", and the database URL
 *      is a Postgres login. Rules 1-5 guarded one of three equivalent doors; a hurried change
 *      reaching for either of the others passed them.
 *
 * **What this buys, said so nobody misreads it in six months: it reduces ACCIDENTAL use and changes
 * nothing about CAPABILITY.** The platform injects all three into every function whatever the code
 * does; a function that never names them still holds them. The check makes reaching for them a
 * visible, reviewed change — that is all.
 *
 * **What it cannot catch:** deliberate obfuscation (a name assembled from pieces that are not literal
 * reads, `globalThis`-indexed access), or a third-party package reading the environment. It is a guard
 * against the hurried change, which is what `C30` guarded against — not against an attacker with
 * commit access. Pure functions exported for the tests; the CLI runs only when invoked directly.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * W2-C D2 / `BE-W162` — the ONE key read is now the named secret keys, `SUPABASE_SECRET_KEYS`, and the
 * legacy `SUPABASE_SERVICE_ROLE_KEY` has moved into rule 6: named nowhere. Supabase retires the legacy
 * key at the end of 2026 (`BE-C72`); the writer moved off it while nothing depended on the timing.
 */
export const KEY_NAME = 'SUPABASE_SECRET_KEYS';
export const WRITER_PATH = '_shared/practice-writer.ts';
export const WRITER_ALLOWED = [
  'ai_gateway_complete_request',
  'record_sim_coach_analysis',
  'record_sim_turn',
];
/** Rule 6 — credentials with the key's reach (or more) that the function must never name. */
export const EQUIVALENT_CREDENTIALS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_DB_URL',
];

/** Removes `//` and `/* *\/` comments, keeping strings intact enough for these patterns. */
export const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/**
 * `functions`: [{ path (relative to supabase/functions), text }]; `core`: [{ path, text }].
 * Returns the failures; empty means the property holds.
 */
export const checkServiceRoleReads = (functions, core) => {
  const failures = [];
  let namedAt = [];
  for (const { path, text } of functions) {
    const code = stripComments(text);
    const names = code.split(KEY_NAME).length - 1;
    if (names > 0) namedAt.push({ path, names, code });
    for (const name of EQUIVALENT_CREDENTIALS) {
      if (new RegExp(`\\b${name}\\b`).test(code)) {
        failures.push(
          `${path}: names ${name}, which reaches as far as the service-role key — function code must not`,
        );
      }
    }
    if (/Deno\s*\.\s*env\s*\.\s*toObject\s*\(/.test(code)) {
      failures.push(
        `${path}: reads the WHOLE environment (Deno.env.toObject), which includes the key`,
      );
    }
    for (const m of code.matchAll(/Deno\s*\.\s*env\s*\.\s*get\s*\(\s*([^)]*)\)/g)) {
      if (!/^(['"`])[A-Z0-9_]+\1$/.test(m[1].trim())) {
        failures.push(
          `${path}: Deno.env.get(${m[1].trim()}) — the variable must be named literally`,
        );
      }
    }
  }
  const total = namedAt.reduce((n, a) => n + a.names, 0);
  const inWriter = namedAt.find((a) => a.path === WRITER_PATH);
  if (total !== 1 || inWriter === undefined) {
    failures.push(
      `${KEY_NAME} must appear in code exactly once, in ${WRITER_PATH}; found ${String(total)}: ` +
        (namedAt.map((a) => `${a.path} ×${String(a.names)}`).join(', ') || 'nowhere'),
    );
  } else if (!new RegExp(`Deno\\.env\\.get\\(\\s*'${KEY_NAME}'\\s*\\)`).test(inWriter.code)) {
    failures.push(`${WRITER_PATH}: the one mention of ${KEY_NAME} is not a Deno.env.get read`);
  }
  const writer = functions.find((f) => f.path === WRITER_PATH);
  if (writer === undefined) {
    failures.push(`${WRITER_PATH} is missing`);
  } else {
    const code = stripComments(writer.text);
    const exported = [
      ...code.matchAll(/export\s+(?:const|function|let|class|default)\s*([A-Za-z0-9_]*)/g),
    ].map((m) => m[1] || 'default');
    if (exported.length !== 1 || exported[0] !== 'practiceWriterFromEnv') {
      failures.push(
        `${WRITER_PATH} must export only practiceWriterFromEnv; exports: ${exported.join(', ') || 'none'}`,
      );
    }
    if (/export\s*\{/.test(code))
      failures.push(`${WRITER_PATH}: re-exports a list — export only practiceWriterFromEnv`);
    const allow = /PRACTICE_WRITES[^=]*=\s*new Set\(\s*\[([^\]]*)\]/.exec(code);
    const names = allow ? [...allow[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort() : null;
    if (names === null || JSON.stringify(names) !== JSON.stringify(WRITER_ALLOWED)) {
      failures.push(
        `${WRITER_PATH}: the allow-list must be exactly ${WRITER_ALLOWED.join(', ')}; is ${names === null ? 'not found' : names.join(', ')}`,
      );
    }
  }
  for (const { path, text } of core) {
    if (/\b(Deno\s*\.\s*env|process\s*\.\s*env)\b/.test(stripComments(text))) {
      failures.push(
        `packages/core/${path}: reads the environment — core is imported by the function and must not`,
      );
    }
  }
  return failures;
};

const walk = (dir, base = dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full, base);
    return /\.(ts|js|mjs|tsx)$/.test(name)
      ? [{ path: relative(base, full).replace(/\\/g, '/'), text: readFileSync(full, 'utf8') }]
      : [];
  });

/** The files as they are on disk: every code file under supabase/functions, and core's non-test source. */
export const loadRepository = () => {
  const dir = (rel) => new URL(rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  return {
    functions: walk(dir('../supabase/functions/')),
    core: walk(dir('../../../packages/core/src/')).filter((f) => !/\.test\.ts$/.test(f.path)),
  };
};

// CLI entry. Importing this module does not run anything.
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
) {
  const { functions, core } = loadRepository();
  const failures = checkServiceRoleReads(functions, core);
  if (failures.length === 0) {
    console.log(
      `The service-role key is read in exactly one place (${WRITER_PATH}); ${String(functions.length)} function files and ${String(core.length)} core files checked.`,
    );
  } else {
    for (const f of failures) console.log(`::error title=Service-role key reachable::${f}`);
    process.exit(1);
  }
}
