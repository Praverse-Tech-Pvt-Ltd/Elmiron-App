import { readFile, writeFile } from 'node:fs/promises';
import { parseCsv } from './check-territory-sheet.mjs';

/**
 * `BE-W179` -- the doctors-and-clinics template's importer (Q-7): CHECK the sheet, then hand it to
 * `seed:reference`, exactly as `check-territory-sheet.mjs` does for territories. It writes nothing
 * to any database itself.
 *
 *   node services/api/scripts/check-doctor-sheet.mjs --reference reference.json \
 *     --doctors doctors-clinics.csv --out reference-with-doctors.json
 *
 * `--reference` is the file `check-territory-sheet.mjs` wrote for the SAME companies: a doctor's
 * territory must be one of its territories, and the doctor's company is that territory's company --
 * never a column the operator types (the database derives it the same way, and refuses a mismatch:
 * `doctors_derive_organisation`). The output is that file with `doctors[]` and `clinicAddresses[]`
 * filled; loading it again re-inserts nothing that already exists (`seed:reference`, ON CONFLICT).
 *
 * One row is one clinic of one doctor. A doctor with two clinics is two rows with the same
 * `doctor_key`; a doctor with no clinic yet is one row with the clinic columns empty.
 *
 * **What it refuses, each with its own code, by row number, all at once:**
 *   missing_column         the header lacks a template column
 *   missing_field          doctor_key, full_name or territory_code is empty
 *   example_row            a doctor_key or territory_code still starts with EXAMPLE-
 *   territory_unknown      territory_code is not a territory in --reference
 *   doctor_conflict        the same doctor_key in the same company with a different name,
 *                          registration, specialty, qualification or territory on another row
 *   duplicate_registration two doctor_keys of one company share a registration_number: the same
 *                          doctor twice
 *   clinic_missing_field   a row with clinic data lacks clinic_label, address_line1, city, state
 *                          or postal_code
 *   clinic_conflict        the same doctor_key and clinic_label with different clinic data
 *   bad_city / bad_state   empty of letters, or holding digits
 *   bad_postal_code        not a six-digit Indian PIN code
 *   bad_coordinates        latitude outside -90..90, longitude outside -180..180, not a number,
 *                          only one of the two, or exactly 0,0 (an empty cell filled with zero)
 *   bad_geofence           geofence_radius_metres not a whole number from 1 to 5000
 *
 * **What it does NOT do:** invent or look up coordinates. A clinic with no coordinates is loaded
 * without them; nothing is geocoded, here or anywhere else.
 *
 * An exactly repeated row is loaded once (the duplicate is reported as a note, not an error).
 */

export const DOCTOR_COLUMNS = [
  'doctor_key',
  'full_name',
  'registration_number',
  'specialty',
  'qualification',
  'territory_code',
  'clinic_label',
  'address_line1',
  'address_line2',
  'city',
  'state',
  'postal_code',
  'latitude',
  'longitude',
  'geofence_radius_metres',
];

const DOCTOR_FIELDS = ['full_name', 'registration_number', 'specialty', 'qualification'];
const CLINIC_FIELDS = [
  'clinic_label',
  'address_line1',
  'address_line2',
  'city',
  'state',
  'postal_code',
  'latitude',
  'longitude',
  'geofence_radius_metres',
];
export const DEFAULT_GEOFENCE_METRES = 150;

const SHEET = 'Doctors';
const nullIfEmpty = (value) => (value === '' ? null : value);

/** A decimal number, as a spreadsheet writes one; anything else is null. */
const decimal = (text) => (/^-?\d+(\.\d+)?$/u.test(text) ? Number(text) : null);

/**
 * @param {{ doctorsCsv: string, reference: { organisations: object[], territories: { key: string, code: string, organisationKey: string }[], doctors?: unknown[] } }} input
 */
export const checkDoctorSheet = ({ doctorsCsv, reference }) => {
  /** @type {{ sheet: string, row: number, code: string, detail: string }[]} */
  const errors = [];
  /** @type {string[]} */
  const notes = [];
  const fail = (row, code, detail) => errors.push({ sheet: SHEET, row: Number(row), code, detail });

  if ((reference.doctors ?? []).length > 0) {
    fail(
      1,
      'reference_has_doctors',
      "pass the territory checker's file, not one that already has doctors",
    );
    return { errors, notes, reference: null };
  }

  const rows = parseCsv(doctorsCsv);
  const [header = [], ...body] = rows;
  const index = header.map((h) => h.trim().toLowerCase());
  const absent = DOCTOR_COLUMNS.filter((c) => !index.includes(c));
  if (absent.length > 0) {
    fail(1, 'missing_column', absent.join(', '));
    return { errors, notes, reference: null };
  }
  const records = body.map((cells, i) => {
    /** @type {Record<string, string>} */
    const r = { row: String(i + 2) };
    for (const c of DOCTOR_COLUMNS) r[c] = (cells[index.indexOf(c)] ?? '').trim();
    return r;
  });

  const territories = new Map(reference.territories.map((t) => [t.code.toUpperCase(), t]));
  /** @type {Map<string, Record<string, string>>} */
  const doctors = new Map();
  /** @type {Map<string, Record<string, string>>} */
  const clinics = new Map();
  /** @type {Map<string, string>} */
  const registrations = new Map();

  for (const r of records) {
    for (const f of ['doctor_key', 'full_name', 'territory_code']) {
      if (r[f] === '') fail(r.row, 'missing_field', f);
    }
    const key = r.doctor_key.toUpperCase();
    const territoryCode = r.territory_code.toUpperCase();
    if (key.startsWith('EXAMPLE-') || territoryCode.startsWith('EXAMPLE-')) {
      fail(r.row, 'example_row', `${r.doctor_key} -- delete the example rows before loading`);
      continue;
    }
    if (key === '' || r.full_name === '' || territoryCode === '') continue;
    if (!territories.has(territoryCode)) {
      fail(r.row, 'territory_unknown', `${r.territory_code} is not a territory in --reference`);
      continue;
    }

    // The doctor: the same on every row that names them. A doctor_key is a doctor WITHIN A
    // COMPANY -- two companies may number their doctors alike, and may both call on the same
    // registered doctor -- so identity and registration are both scoped by the territory's company.
    const company = String(territories.get(territoryCode)?.organisationKey);
    const identity = `${company}|${key}`;
    const first = doctors.get(identity);
    if (first === undefined) {
      doctors.set(identity, r);
      const registration = r.registration_number.toUpperCase();
      if (registration !== '') {
        const holder = registrations.get(`${company}|${registration}`);
        if (holder !== undefined) {
          fail(r.row, 'duplicate_registration', `${r.registration_number} is also ${holder}`);
        } else {
          registrations.set(`${company}|${registration}`, r.doctor_key);
        }
      }
    } else {
      const differ = [...DOCTOR_FIELDS, 'territory_code'].filter(
        (f) => first[f].toUpperCase() !== r[f].toUpperCase(),
      );
      if (differ.length > 0) {
        fail(
          r.row,
          'doctor_conflict',
          `${r.doctor_key}: ${differ.join(', ')} differ from row ${first.row}`,
        );
        continue;
      }
    }

    // The clinic, if this row has one.
    if (CLINIC_FIELDS.every((f) => r[f] === '')) continue;
    let clinicOk = true;
    const bad = (code, detail) => {
      fail(r.row, code, detail);
      clinicOk = false;
    };
    for (const f of ['clinic_label', 'address_line1', 'city', 'state', 'postal_code']) {
      if (r[f] === '') bad('clinic_missing_field', f);
    }
    for (const [f, code] of /** @type {const} */ ([
      ['city', 'bad_city'],
      ['state', 'bad_state'],
    ])) {
      if (r[f] !== '' && (!/\p{L}/u.test(r[f]) || /\d/u.test(r[f]))) bad(code, r[f]);
    }
    if (r.postal_code !== '' && !/^[1-9]\d{5}$/u.test(r.postal_code)) {
      bad('bad_postal_code', `${r.postal_code} -- a six-digit PIN code`);
    }
    const lat = decimal(r.latitude);
    const lng = decimal(r.longitude);
    if (r.latitude !== '' || r.longitude !== '') {
      if (r.latitude === '' || r.longitude === '') {
        bad('bad_coordinates', 'give both latitude and longitude, or neither');
      } else if (lat === null || lng === null) {
        bad('bad_coordinates', `${r.latitude}, ${r.longitude} is not a pair of decimal numbers`);
      } else if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        bad('bad_coordinates', `${r.latitude}, ${r.longitude} is out of range`);
      } else if (lat === 0 && lng === 0) {
        bad('bad_coordinates', '0, 0 is not a clinic -- leave both empty if unknown');
      }
    }
    if (r.geofence_radius_metres !== '' && !/^\d+$/u.test(r.geofence_radius_metres)) {
      bad('bad_geofence', r.geofence_radius_metres);
    } else if (r.geofence_radius_metres !== '') {
      const metres = Number(r.geofence_radius_metres);
      if (metres < 1 || metres > 5000)
        bad('bad_geofence', `${r.geofence_radius_metres} -- 1 to 5000`);
    }
    if (!clinicOk) continue;

    const clinicKey = `${identity}|${r.clinic_label.toUpperCase()}`;
    const seen = clinics.get(clinicKey);
    if (seen === undefined) {
      clinics.set(clinicKey, r);
    } else {
      const differ = CLINIC_FIELDS.filter((f) => seen[f].toUpperCase() !== r[f].toUpperCase());
      if (differ.length > 0) {
        fail(
          r.row,
          'clinic_conflict',
          `${r.doctor_key} / ${r.clinic_label}: ${differ.join(', ')} differ from row ${seen.row}`,
        );
      } else {
        notes.push(`row ${r.row} repeats row ${seen.row} exactly; loaded once`);
      }
    }
  }

  if (errors.length > 0) return { errors, notes, reference: null };

  // Keys carry the company: two companies may both number their doctors from 1.
  const doctorKeyOf = (r) => {
    const territory = territories.get(r.territory_code.toUpperCase());
    return `doctor:${String(territory?.organisationKey)}:${r.doctor_key.toUpperCase()}`;
  };
  return {
    errors: [],
    notes,
    reference: {
      ...reference,
      doctors: [...doctors.values()].map((r) => {
        const territory = territories.get(r.territory_code.toUpperCase());
        return {
          key: doctorKeyOf(r),
          organisationKey: territory?.organisationKey,
          territoryKey: territory?.key,
          fullName: r.full_name,
          registrationNumber: nullIfEmpty(r.registration_number),
          specialty: nullIfEmpty(r.specialty),
          qualification: nullIfEmpty(r.qualification),
        };
      }),
      clinicAddresses: [...clinics.values()].map((r) => ({
        key: `${doctorKeyOf(r)}:clinic:${r.clinic_label.toUpperCase()}`,
        doctorKey: doctorKeyOf(r),
        label: r.clinic_label,
        line1: r.address_line1,
        line2: nullIfEmpty(r.address_line2),
        city: r.city,
        state: r.state,
        postalCode: r.postal_code,
        latitude: decimal(r.latitude),
        longitude: decimal(r.longitude),
        geofenceRadiusMetres:
          r.geofence_radius_metres === ''
            ? DEFAULT_GEOFENCE_METRES
            : Number(r.geofence_radius_metres),
      })),
    },
  };
};

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};

const main = async () => {
  const referencePath = arg('--reference');
  const doctorsPath = arg('--doctors');
  if (referencePath === undefined || doctorsPath === undefined) {
    throw new Error(
      'usage: check-doctor-sheet --reference <reference.json> --doctors <doctors.csv> [--out <file>]',
    );
  }
  const result = checkDoctorSheet({
    doctorsCsv: await readFile(doctorsPath, 'utf8'),
    reference: JSON.parse(await readFile(referencePath, 'utf8')),
  });
  for (const note of result.notes) console.log(`note: ${note}`);
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
    `OK: ${String(result.reference.doctors.length)} doctor(s), ` +
      `${String(result.reference.clinicAddresses.length)} clinic(s). ` +
      (out === undefined ? 'Pass --out to write the seed:reference file.' : `Wrote ${out}.`),
  );
};

if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/gu, '/'))
) {
  await main();
}
