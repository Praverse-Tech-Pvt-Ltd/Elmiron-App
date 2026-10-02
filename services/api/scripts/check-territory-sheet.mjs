import { readFile, writeFile } from 'node:fs/promises';

/**
 * W1-N A3 -- the territory template's importer: CHECK the sheet, then hand it to
 * `seed:reference`. Operator direction B-1.
 *
 * The operator fills `docs/operator/territory-template.xlsx` and saves its two data sheets as CSV
 * (Excel: File -> Save As -> "CSV UTF-8"). This reads those two files, refuses every row it cannot
 * load with a NAMED reason, and -- only when there are none -- writes the JSON `seed:reference`
 * already takes. It writes nothing to any database itself.
 *
 * **Why a checker in front of the seeder rather than a second seeder.** `seed-reference-data.mjs`
 * inserts what it is given and relies on the database to refuse; a bad sheet would surface as a
 * foreign-key error naming a uuid derived from a key, halfway through a load. The operator needs
 * the opposite: every problem in the sheet, at once, by row number, before anything is written.
 *
 * **What it refuses, each with its own code:**
 *   missing_field         a required cell is empty (name, code, level; for an MR, name and email)
 *   missing_company       the company cell is empty
 *   unknown_level         level is not National, Region, Area or Territory
 *   duplicate_code        a code appears twice -- across ALL companies, because `territories.code`
 *                         is UNIQUE in the database without regard to company
 *   parent_missing        parent_code names a code that is not in the sheet
 *   parent_other_company  the parent belongs to a different company
 *   level_mismatch        National with a parent; Region not under National; Area not under Region
 *   duplicate_email       two MRs share an email (each MR is one sign-in account)
 *   mr_territory_missing  an MR's territory_code is not in the sheet
 *   mr_territory_level    an MR is placed on a National or Region row rather than an Area/Territory
 *   mr_other_company      an MR's company differs from their territory's
 *   example_row           a code still starts with EXAMPLE- -- the template's own example rows,
 *                         left in. Loading them would put invented master data into production.
 *
 * **What it does NOT do: create MR accounts.** An MR is a sign-in account, not a territory, and
 * `seed:reference` creates no users. The MR sheet is CHECKED here so the hierarchy is complete and
 * consistent. **On production each account is created BY HAND** (`docs/DEPLOY-RUNBOOK.md` step 4,
 * `BE-W137`): `seed:mr` refuses any non-local target by design and makes its own company. W1-T
 * corrected this line, which said accounts were "created with `seed:mr`". Said rather than implied.
 */

export const TERRITORY_COLUMNS = ['level', 'name', 'code', 'parent_code', 'company'];
export const MR_COLUMNS = ['name', 'email', 'mobile', 'territory_code', 'company'];

const LEVEL_RANK = { national: 1, region: 2, area: 3, territory: 3 };

/**
 * RFC 4180 CSV, enough of it for a spreadsheet export: quoted fields, doubled quotes, CRLF or LF,
 * and the UTF-8 byte-order mark Excel writes. No dependency, by the project's rule.
 * @param {string} text
 * @returns {string[][]}
 */
export const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^\u{FEFF}/u, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // A trailing blank line from the export is not a row.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
};

/**
 * Header row -> objects keyed by the expected column names. A missing column is a sheet-level error
 * rather than a row-level one: every row would otherwise fail for the same reason.
 * @param {string[][]} rows
 * @param {string[]} columns
 * @param {string} sheet
 */
const toRecords = (rows, columns, sheet) => {
  const [header = [], ...body] = rows;
  const index = header.map((h) => h.trim().toLowerCase());
  const absent = columns.filter((c) => !index.includes(c));
  if (absent.length > 0) {
    return {
      records: [],
      errors: [{ sheet, row: 1, code: 'missing_column', detail: absent.join(', ') }],
    };
  }
  const records = body.map((cells, i) => {
    /** @type {Record<string, string>} */
    const record = { row: String(i + 2) };
    for (const c of columns) record[c] = (cells[index.indexOf(c)] ?? '').trim();
    return record;
  });
  return { records, errors: [] };
};

/**
 * @param {{ territoriesCsv: string, mrsCsv: string }} input
 * @returns {{ errors: { sheet: string, row: number, code: string, detail: string }[], reference: object | null }}
 */
export const checkTerritorySheet = ({ territoriesCsv, mrsCsv }) => {
  /** @type {{ sheet: string, row: number, code: string, detail: string }[]} */
  const errors = [];
  const fail = (sheet, row, code, detail) => errors.push({ sheet, row: Number(row), code, detail });

  const t = toRecords(parseCsv(territoriesCsv), TERRITORY_COLUMNS, 'Territories');
  const m = toRecords(parseCsv(mrsCsv), MR_COLUMNS, 'MRs');
  errors.push(...t.errors, ...m.errors);
  if (errors.length > 0) return { errors, reference: null };

  // Pass 1: each row alone, and the codes it claims.
  const byCode = new Map();
  for (const r of t.records) {
    for (const f of ['level', 'name', 'code']) {
      if (r[f] === '') fail('Territories', r.row, 'missing_field', f);
    }
    if (r.company === '') fail('Territories', r.row, 'missing_company', r.code);
    if (r.level !== '' && LEVEL_RANK[r.level.toLowerCase()] === undefined) {
      fail('Territories', r.row, 'unknown_level', r.level);
    }
    if (r.code === '') continue;
    const key = r.code.toUpperCase();
    if (key.startsWith('EXAMPLE-')) {
      fail(
        'Territories',
        r.row,
        'example_row',
        `${r.code} -- delete the example rows before loading`,
      );
    }
    if (byCode.has(key)) {
      fail(
        'Territories',
        r.row,
        'duplicate_code',
        `${r.code} (first on row ${byCode.get(key).row})`,
      );
    } else {
      byCode.set(key, r);
    }
  }

  // Pass 2: each row against its parent. Order in the sheet does not matter.
  for (const r of byCode.values()) {
    const rank = LEVEL_RANK[r.level.toLowerCase()];
    if (r.parent_code === '') {
      if (rank !== undefined && rank !== 1) {
        fail('Territories', r.row, 'level_mismatch', `${r.level} ${r.code} has no parent`);
      }
      continue;
    }
    const parent = byCode.get(r.parent_code.toUpperCase());
    if (parent === undefined) {
      fail('Territories', r.row, 'parent_missing', r.parent_code);
      continue;
    }
    // An empty company is already `missing_company`; reporting it again as a mismatch would be
    // two refusals for one cause.
    if (r.company !== '' && parent.company !== r.company) {
      fail('Territories', r.row, 'parent_other_company', `${r.parent_code} is ${parent.company}`);
    }
    const parentRank = LEVEL_RANK[parent.level.toLowerCase()];
    if (rank !== undefined && parentRank !== undefined && parentRank !== rank - 1) {
      fail('Territories', r.row, 'level_mismatch', `${r.level} under ${parent.level}`);
    }
  }

  // The MR sheet: checked, not loaded -- see the header.
  const emails = new Map();
  for (const r of m.records) {
    for (const f of ['name', 'email']) {
      if (r[f] === '') fail('MRs', r.row, 'missing_field', f);
    }
    if (r.company === '') fail('MRs', r.row, 'missing_company', r.email);
    const email = r.email.toLowerCase();
    if (email !== '' && emails.has(email)) {
      fail('MRs', r.row, 'duplicate_email', `${r.email} (first on row ${emails.get(email)})`);
    } else if (email !== '') {
      emails.set(email, r.row);
    }
    const territory = byCode.get(r.territory_code.toUpperCase());
    if (territory === undefined) {
      fail('MRs', r.row, 'mr_territory_missing', r.territory_code);
      continue;
    }
    if (LEVEL_RANK[territory.level.toLowerCase()] !== 3) {
      fail('MRs', r.row, 'mr_territory_level', `${r.territory_code} is ${territory.level}`);
    }
    if (r.company !== '' && territory.company !== r.company) {
      fail('MRs', r.row, 'mr_other_company', `${r.territory_code} is ${territory.company}`);
    }
  }

  if (errors.length > 0) return { errors, reference: null };

  // Parents before children: `seed:reference` inserts in file order.
  const ordered = [...byCode.values()].sort(
    (a, b) => LEVEL_RANK[a.level.toLowerCase()] - LEVEL_RANK[b.level.toLowerCase()],
  );
  const companies = [...new Set(ordered.map((r) => r.company))];
  return {
    errors: [],
    reference: {
      organisations: companies.map((name) => ({ key: `company:${name}`, name })),
      territories: ordered.map((r) => ({
        key: `territory:${r.code.toUpperCase()}`,
        name: r.name,
        code: r.code,
        parentKey: r.parent_code === '' ? null : `territory:${r.parent_code.toUpperCase()}`,
        organisationKey: `company:${r.company}`,
      })),
      doctors: [],
      consentTextVersions: [],
    },
  };
};

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};

const main = async () => {
  const territoriesPath = arg('--territories');
  const mrsPath = arg('--mrs');
  if (territoriesPath === undefined || mrsPath === undefined) {
    throw new Error(
      'usage: check-territory-sheet --territories <Territories.csv> --mrs <MRs.csv> [--out reference.json]',
    );
  }
  const result = checkTerritorySheet({
    territoriesCsv: await readFile(territoriesPath, 'utf8'),
    mrsCsv: await readFile(mrsPath, 'utf8'),
  });
  if (result.errors.length > 0) {
    for (const e of result.errors)
      console.error(`${e.sheet} row ${String(e.row)}: ${e.code} -- ${e.detail}`);
    console.error(`${String(result.errors.length)} problem(s). Nothing was written.`);
    process.exitCode = 1;
    return;
  }
  const out = arg('--out');
  if (out !== undefined) await writeFile(out, `${JSON.stringify(result.reference, null, 2)}\n`);
  console.log(
    `OK: ${String(result.reference.organisations.length)} company(ies), ` +
      `${String(result.reference.territories.length)} territory row(s). ` +
      (out === undefined ? 'Pass --out to write the seed:reference file.' : `Wrote ${out}.`),
  );
};

if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/gu, '/'))
) {
  await main();
}
