/**
 * W1-W D — the Edge Function runs the dependency versions the tests run, or the build fails.
 *
 * Two pins can name the same package: `supabase/functions/deno.json` (what the DEPLOYED function loads)
 * and `pnpm-lock.yaml` (what every test in this repository loads). They agreed on 2 October for the AWS
 * SDK; nothing made them keep agreeing, and the day they drift the tests prove a dependency the function
 * does not run. Found by the same sweep: `zod` was a RANGE in `deno.json` (`^4.1.12`) with no Deno
 * lockfile, so the deployed function would take whatever 4.x was newest on deploy day while the tests
 * ran the lockfile's version — a drift that needs nobody to change a file.
 *
 * The rule, per `npm:` import in `deno.json`:
 *   1. it is an EXACT version — a range is resolved on deploy day, not here;
 *   2. the package is in the lockfile's `importers` (some workspace tests it);
 *   3. every workspace that resolves it resolves THAT version.
 * Any other specifier (`jsr:`, `https:`) fails: this check cannot compare it, so it must not pass it.
 *
 * Deliberately a comparison and nothing cleverer — generating one file from the other would be a
 * second mechanism to keep correct. Pure function exported for the tests; the CLI runs only when
 * invoked directly, like `check-decision-debt.mjs`.
 */
import { readFileSync } from 'node:fs';

const EXACT = /^\d+\.\d+\.\d+$/u;

/** `importers:` of a pnpm lockfile → package name → the set of versions the workspaces resolve. */
export const resolvedInImporters = (lockText) => {
  const resolved = new Map();
  const lines = lockText.split(/\r?\n/u);
  const start = lines.indexOf('importers:');
  if (start === -1) return resolved;
  let name = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/u.test(line)) break; // the next top-level key ends the block
    const dependency = /^ {6}'?([^':]+(?::[^':]+)?)'?:$/u.exec(line);
    if (dependency) {
      name = dependency[1];
      continue;
    }
    const version = /^ {8}version: (\S+)$/u.exec(line);
    if (version && name !== null) {
      const plain = version[1].replace(/\(.*$/u, ''); // drop a peer-dependency suffix
      if (!resolved.has(name)) resolved.set(name, new Set());
      resolved.get(name).add(plain);
      name = null;
    }
  }
  return resolved;
};

export const compareFunctionPins = (denoJsonText, lockText) => {
  const imports = JSON.parse(denoJsonText).imports ?? {};
  const resolved = resolvedInImporters(lockText);
  const failures = [];
  for (const [alias, specifier] of Object.entries(imports)) {
    const npm = /^npm:(@?[^@]+)@(.+)$/u.exec(specifier);
    if (!npm) {
      failures.push(
        `${alias}: "${specifier}" is not an npm: specifier, so this check cannot compare it`,
      );
      continue;
    }
    const [, name, version] = npm;
    if (!EXACT.test(version)) {
      failures.push(
        `${name}: deno.json asks for "${version}", a RANGE — the deployed function takes whatever matches on deploy day. Pin it exactly`,
      );
      continue;
    }
    const tested = resolved.get(name);
    if (tested === undefined) {
      failures.push(
        `${name}: in deno.json but no workspace in pnpm-lock.yaml resolves it, so no test runs it`,
      );
      continue;
    }
    const others = [...tested].filter((v) => v !== version);
    if (others.length > 0) {
      failures.push(
        `${name}: the function runs ${version}; the tests run ${[...tested].join(', ')}. Make them the same`,
      );
    }
  }
  return { clear: failures.length === 0, failures };
};

// CLI entry. Importing this module does not run anything.
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
) {
  const deno = readFileSync(new URL('../supabase/functions/deno.json', import.meta.url), 'utf8');
  const lock = readFileSync(new URL('../../../pnpm-lock.yaml', import.meta.url), 'utf8');
  const { clear, failures } = compareFunctionPins(deno, lock);
  const count = Object.keys(JSON.parse(deno).imports ?? {}).length;
  if (clear) {
    console.log(
      `The Edge Function's ${String(count)} npm import(s) are the versions the tests run.`,
    );
  } else {
    for (const failure of failures) console.log(`::error title=Function pin drift::${failure}`);
    process.exit(1);
  }
}
