#!/usr/bin/env node
/**
 * `FE-W143` — the field app's translations, in and out.
 *
 *   pnpm i18n:export [--out <file.csv>]   write the catalogue as CSV for the translators
 *   pnpm i18n:import <file.csv> [--check] read their CSV back; --check validates and writes nothing
 *   pnpm i18n:sync                        give hi.json / mr.json exactly English's keys (new keys
 *                                         empty, removed keys dropped) after a developer edits en.json
 *
 * The logic is `packages/ui/src/i18n/csv.ts`, loaded directly (Node 24 strips its types) so this
 * script and the tests run the same code. `docs/operator/translations.md` is the operator's page.
 *
 * pnpm 11 forwards a literal `--` to the script (`docs/gotchas.md`), so one is ignored.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  catalogueJson,
  exportRows,
  importRows,
  parseCsv,
  toCsv,
} from '../packages/ui/src/i18n/csv.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'packages', 'ui', 'src', 'i18n');
const FILES = {
  en: join(DIR, 'en.json'),
  hi: join(DIR, 'hi.json'),
  mr: join(DIR, 'mr.json'),
  notes: join(DIR, 'notes.json'),
};

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const load = () => ({
  en: readJson(FILES.en),
  hi: readJson(FILES.hi),
  mr: readJson(FILES.mr),
  notes: readJson(FILES.notes),
});

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const [command, ...rest] = process.argv.slice(2).filter((arg) => arg !== '--');

const progress = (en, target) => {
  const keys = Object.keys(en);
  return `${String(keys.filter((key) => (target[key] ?? '').trim() !== '').length)} of ${String(keys.length)}`;
};

if (command === 'export') {
  const outFlag = rest.indexOf('--out');
  const out = resolve(outFlag === -1 ? 'field-app-translations.csv' : (rest[outFlag + 1] ?? ''));
  const catalogues = load();
  writeFileSync(out, toCsv(exportRows(catalogues)), 'utf8');
  console.log(`Wrote ${out}`);
  console.log(
    `${String(Object.keys(catalogues.en).length)} strings. Hindi ${progress(catalogues.en, catalogues.hi)} done, Marathi ${progress(catalogues.en, catalogues.mr)} done.`,
  );
} else if (command === 'import') {
  const file = rest.find((arg) => !arg.startsWith('--'));
  if (file === undefined) fail('Usage: pnpm i18n:import <file.csv> [--check]');
  const path = resolve(file);
  if (!existsSync(path)) fail(`No such file: ${path}`);
  const catalogues = load();
  const result = importRows({ ...catalogues, rows: parseCsv(readFileSync(path, 'utf8')) });
  if (result.errors.length > 0) {
    console.error(`REFUSED — ${String(result.errors.length)} problem(s); nothing was written:`);
    for (const error of result.errors) console.error(`  ${error}`);
    process.exit(1);
  }
  if (result.missing.length > 0) {
    console.log(
      `${String(result.missing.length)} key(s) had no row in the file and were left as they were.`,
    );
  }
  if (rest.includes('--check')) {
    console.log(`OK — ${String(result.changed)} value(s) would change. Nothing written (--check).`);
  } else {
    writeFileSync(FILES.hi, catalogueJson(result.hi), 'utf8');
    writeFileSync(FILES.mr, catalogueJson(result.mr), 'utf8');
    console.log(`OK — ${String(result.changed)} value(s) changed.`);
  }
  console.log(
    `Hindi ${progress(catalogues.en, result.hi)} done, Marathi ${progress(catalogues.en, result.mr)} done. A language is offered in the app only when it is complete.`,
  );
} else if (command === 'sync') {
  const catalogues = load();
  for (const language of ['hi', 'mr']) {
    const current = catalogues[language];
    const next = Object.fromEntries(
      Object.keys(catalogues.en).map((key) => [key, current[key] ?? '']),
    );
    const added = Object.keys(catalogues.en).filter((key) => !(key in current)).length;
    const dropped = Object.keys(current).filter((key) => !(key in catalogues.en)).length;
    writeFileSync(FILES[language], catalogueJson(next), 'utf8');
    console.log(
      `${language}.json: ${String(added)} key(s) added empty, ${String(dropped)} removed.`,
    );
  }
} else {
  fail(
    'Usage: pnpm i18n:export [--out file.csv] | pnpm i18n:import <file.csv> [--check] | pnpm i18n:sync',
  );
}
