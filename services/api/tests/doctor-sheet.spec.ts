import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DB_URL, requireDatabase, withClient } from './db.js';
import { DEFAULT_GEOFENCE_METRES, checkDoctorSheet } from '../scripts/check-doctor-sheet.mjs';
import { checkTerritorySheet } from '../scripts/check-territory-sheet.mjs';
import { seedReferenceData } from '../scripts/seed-reference-data.mjs';
import type { ReferenceData } from '../scripts/seed-reference-data.d.mts';

/**
 * `BE-W179` — the doctors-and-clinics template (Q-7): its checker, and `seed:reference` loading
 * what the checker writes. The first half is pure; the second needs the local database.
 *
 * All names, codes and coordinates are synthetic and carry a run id; nothing here is real master
 * data, and none of it is loaded anywhere but the local test database.
 */

const TEMPLATE = join(
  __dirname,
  '..',
  '..',
  '..',
  'docs',
  'operator',
  'doctors-clinics-template.csv',
);
const HEADER =
  'doctor_key,full_name,registration_number,specialty,qualification,territory_code,clinic_label,' +
  'address_line1,address_line2,city,state,postal_code,latitude,longitude,geofence_radius_metres';

/** Two companies, each with one Area, made by the territory checker itself. */
const territoryReference = (suffix = ''): ReferenceData => {
  const { reference, errors } = checkTerritorySheet({
    territoriesCsv: [
      'level,name,code,parent_code,company',
      `National,India,IN${suffix},,Acme Pharma${suffix}`,
      `Region,West,IN-W${suffix},IN${suffix},Acme Pharma${suffix}`,
      `Area,Pune,IN-W-PUN${suffix},IN-W${suffix},Acme Pharma${suffix}`,
      `Area,Nagpur,IN-W-NAG${suffix},IN-W${suffix},Acme Pharma${suffix}`,
      `National,India B,BN${suffix},,Beta Labs${suffix}`,
      `Region,West B,BN-W${suffix},BN${suffix},Beta Labs${suffix}`,
      `Area,Pune B,BN-W-PUN${suffix},BN-W${suffix},Beta Labs${suffix}`,
    ].join('\n'),
    mrsCsv: 'name,email,mobile,territory_code,company\n',
  });
  if (reference === null) throw new Error(JSON.stringify(errors));
  return reference;
};

const row = (cells: Partial<Record<string, string>>, territory = 'IN-W-PUN'): string =>
  [
    cells['doctor_key'] ?? 'D001',
    cells['full_name'] ?? 'Dr Asha Rao',
    cells['registration_number'] ?? 'MMC-1001',
    cells['specialty'] ?? 'Urology',
    cells['qualification'] ?? 'MBBS MS',
    cells['territory_code'] ?? territory,
    cells['clinic_label'] ?? 'Main clinic',
    cells['address_line1'] ?? '1 Station Road',
    cells['address_line2'] ?? '',
    cells['city'] ?? 'Pune',
    cells['state'] ?? 'Maharashtra',
    cells['postal_code'] ?? '411001',
    cells['latitude'] ?? '18.5204',
    cells['longitude'] ?? '73.8567',
    cells['geofence_radius_metres'] ?? '',
  ].join(',');

const check = (rows: string[], reference = territoryReference()) =>
  checkDoctorSheet({ doctorsCsv: [HEADER, ...rows].join('\n'), reference });
const codes = (rows: string[]) => check(rows).errors.map((e) => e.code);

describe('BE-W179 — the doctors-and-clinics sheet checker', () => {
  it('the shipped template is well-formed, and refused ONLY because its rows are examples', () => {
    const csv = readFileSync(TEMPLATE, 'utf8');
    const result = checkDoctorSheet({ doctorsCsv: csv, reference: territoryReference() });
    expect(new Set(result.errors.map((e) => e.code))).toEqual(new Set(['example_row']));
    expect(result.reference).toBeNull();
    // Without the prefix, and pointed at a real territory, the same rows pass.
    const renamed = checkDoctorSheet({
      doctorsCsv: csv.replace(/EXAMPLE-IN-W-PUN/gu, 'IN-W-PUN').replace(/EXAMPLE-/gu, ''),
      reference: territoryReference(),
    });
    expect(renamed.errors).toEqual([]);
    expect(renamed.reference?.doctors).toHaveLength(2);
    expect(renamed.reference?.clinicAddresses).toHaveLength(2);
  });

  it('one doctor, one clinic: mapped to doctors[] and clinicAddresses[], company from the territory', () => {
    const { errors, reference } = check([row({})]);
    expect(errors).toEqual([]);
    const territories = territoryReference().territories;
    const pune = territories.find((t) => t.code === 'IN-W-PUN');
    expect(reference?.doctors).toEqual([
      {
        key: `doctor:${String(pune?.organisationKey)}:D001`,
        organisationKey: pune?.organisationKey,
        territoryKey: pune?.key,
        fullName: 'Dr Asha Rao',
        registrationNumber: 'MMC-1001',
        specialty: 'Urology',
        qualification: 'MBBS MS',
      },
    ]);
    expect(reference?.clinicAddresses).toEqual([
      {
        key: `doctor:${String(pune?.organisationKey)}:D001:clinic:MAIN CLINIC`,
        doctorKey: `doctor:${String(pune?.organisationKey)}:D001`,
        label: 'Main clinic',
        line1: '1 Station Road',
        line2: null,
        city: 'Pune',
        state: 'Maharashtra',
        postalCode: '411001',
        latitude: 18.5204,
        longitude: 73.8567,
        geofenceRadiusMetres: DEFAULT_GEOFENCE_METRES,
      },
    ]);
    // The territory file's own rows are carried through untouched.
    expect(reference?.territories).toEqual(territories);
  });

  it('one doctor, two clinics: one doctor, two clinics', () => {
    const { errors, reference } = check([
      row({}),
      row({ clinic_label: 'Evening clinic', address_line1: '2 Lane', latitude: '', longitude: '' }),
    ]);
    expect(errors).toEqual([]);
    expect(reference?.doctors).toHaveLength(1);
    expect(reference?.clinicAddresses?.map((c) => c.label)).toEqual([
      'Main clinic',
      'Evening clinic',
    ]);
  });

  it('multiple doctors, in two companies, each in its own company', () => {
    const { errors, reference } = check([
      row({}),
      row({ doctor_key: 'D002', full_name: 'Dr Ravi Shah', registration_number: 'MMC-1002' }),
      row(
        { doctor_key: 'D001', full_name: 'Dr Meera Iyer', registration_number: 'KMC-77' },
        'BN-W-PUN',
      ),
    ]);
    expect(errors).toEqual([]);
    expect(reference?.doctors.map((d) => d.organisationKey)).toEqual([
      'company:Acme Pharma',
      'company:Acme Pharma',
      'company:Beta Labs',
    ]);
    // The same doctor_key in two companies is two doctors, never one.
    expect(new Set(reference?.doctors.map((d) => d.key)).size).toBe(3);
  });

  it('a doctor with no clinic yet loads with none', () => {
    const blank = { clinic_label: '', address_line1: '', city: '', state: '', postal_code: '' };
    const { errors, reference } = check([row({ ...blank, latitude: '', longitude: '' })]);
    expect(errors).toEqual([]);
    expect(reference?.clinicAddresses).toEqual([]);
  });

  it('missing territory, and a territory that is not in the reference, are refused', () => {
    expect(codes([row({ territory_code: '' })])).toEqual(['missing_field']);
    expect(codes([row({ territory_code: 'IN-E-KOL' })])).toEqual(['territory_unknown']);
  });

  it('missing doctor_key or full_name is refused', () => {
    expect(codes([row({ doctor_key: '' })])).toEqual(['missing_field']);
    expect(codes([row({ full_name: '' })])).toEqual(['missing_field']);
  });

  it('the same doctor_key with a different identity fails loudly, naming both rows', () => {
    const result = check([row({}), row({ full_name: 'Dr A. Rao', clinic_label: 'Second' })]);
    expect(result.errors).toEqual([
      {
        sheet: 'Doctors',
        row: 3,
        code: 'doctor_conflict',
        detail: 'D001: full_name differ from row 2',
      },
    ]);
    // Moved to another territory of the SAME company: a conflict.
    expect(codes([row({}), row({ territory_code: 'IN-W-NAG', clinic_label: 'B' })])).toEqual([
      'doctor_conflict',
    ]);
    // A second key with the same registration in the same company: the same doctor twice.
    expect(codes([row({}), row({ doctor_key: 'D009' })])).toEqual(['duplicate_registration']);
    // The same key, or registration, in ANOTHER company is that company's own doctor.
    expect(codes([row({}), row({ clinic_label: 'B' }, 'BN-W-PUN')])).toEqual([]);
  });

  it('the same clinic twice: identical is loaded once; different is refused', () => {
    const same = check([row({}), row({})]);
    expect(same.errors).toEqual([]);
    expect(same.reference?.clinicAddresses).toHaveLength(1);
    expect(same.notes).toEqual(['row 3 repeats row 2 exactly; loaded once']);
    expect(codes([row({}), row({ address_line1: '9 Other Road' })])).toEqual(['clinic_conflict']);
  });

  it('invalid latitude or longitude is refused; nothing is invented for a missing one', () => {
    expect(codes([row({ latitude: '91' })])).toEqual(['bad_coordinates']);
    expect(codes([row({ longitude: '-181' })])).toEqual(['bad_coordinates']);
    expect(codes([row({ latitude: '18.5.1' })])).toEqual(['bad_coordinates']);
    expect(codes([row({ latitude: 'abc' })])).toEqual(['bad_coordinates']);
    expect(codes([row({ longitude: '' })])).toEqual(['bad_coordinates']);
    expect(codes([row({ latitude: '0', longitude: '0' })])).toEqual(['bad_coordinates']);
    const none = check([row({ latitude: '', longitude: '' })]);
    expect(none.errors).toEqual([]);
    expect(none.reference?.clinicAddresses?.[0]).toMatchObject({ latitude: null, longitude: null });
    // The boundaries themselves are valid.
    expect(codes([row({ latitude: '-90', longitude: '180' })])).toEqual([]);
  });

  it('a blank required address field is refused, by name', () => {
    for (const field of ['clinic_label', 'address_line1', 'city', 'state', 'postal_code']) {
      const result = check([row({ [field]: '' })]);
      expect(result.errors.map((e) => [e.code, e.detail])).toContainEqual([
        'clinic_missing_field',
        field,
      ]);
    }
  });

  it('city, state and PIN code are validated', () => {
    expect(codes([row({ city: '12345' })])).toEqual(['bad_city']);
    expect(codes([row({ state: 'MH1' })])).toEqual(['bad_state']);
    expect(codes([row({ postal_code: '41100' })])).toEqual(['bad_postal_code']);
    expect(codes([row({ postal_code: '011001' })])).toEqual(['bad_postal_code']);
  });

  it('geofence: default 150 when empty; a supplied radius is kept; a bad one refused', () => {
    expect(check([row({})]).reference?.clinicAddresses?.[0]?.geofenceRadiusMetres).toBe(150);
    expect(
      check([row({ geofence_radius_metres: '300' })]).reference?.clinicAddresses?.[0]
        ?.geofenceRadiusMetres,
    ).toBe(300);
    expect(codes([row({ geofence_radius_metres: '0' })])).toEqual(['bad_geofence']);
    expect(codes([row({ geofence_radius_metres: '75.5' })])).toEqual(['bad_geofence']);
    expect(codes([row({ geofence_radius_metres: '9000' })])).toEqual(['bad_geofence']);
  });

  it('a missing template column is one sheet-level refusal', () => {
    const result = checkDoctorSheet({
      doctorsCsv: 'doctor_key,full_name\nD1,Dr X',
      reference: territoryReference(),
    });
    expect(result.errors.map((e) => e.code)).toEqual(['missing_column']);
  });
});

// ---------------------------------------------------------------------------------------------
// Loading: `seed:reference` with the checker's output, against the local database.
// ---------------------------------------------------------------------------------------------

const reachable = await requireDatabase();

describe.skipIf(!reachable)('BE-W179 — seed:reference loads doctors and clinics', () => {
  const runId = randomUUID().slice(0, 8).toUpperCase();
  const load = (reference: ReferenceData) =>
    seedReferenceData(reference, { apply: true, dbUrl: DB_URL });
  const sheet = (rows: string[]) => {
    const result = check(rows, territoryReference(`-${runId}`));
    if (result.reference === null) throw new Error(JSON.stringify(result.errors));
    return result.reference;
  };
  const rowsFor = (overrides: Partial<Record<string, string>> = {}) => [
    row({ ...overrides }, `IN-W-PUN-${runId}`),
    row(
      { ...overrides, clinic_label: 'Evening clinic', geofence_radius_metres: '250' },
      `IN-W-PUN-${runId}`,
    ),
    row(
      {
        ...overrides,
        doctor_key: 'D001',
        full_name: 'Dr Meera Iyer',
        registration_number: 'KMC-77',
      },
      `BN-W-PUN-${runId}`,
    ),
  ];
  const clinicsOf = (fullName: string) =>
    withClient((client) =>
      client.query<{
        label: string;
        geofence_radius_metres: number;
        latitude: number | null;
        territory: string;
        doctor_org: string;
        territory_org: string;
      }>(
        `select a.label, a.geofence_radius_metres, a.latitude, t.code as territory,
                d.organisation_id as doctor_org, t.organisation_id as territory_org
           from public.clinic_addresses a
           join public.doctors d on d.id = a.doctor_id
           join public.territories t on t.id = d.territory_id
          where d.full_name = $1 and t.code like $2
          order by a.label`,
        [fullName, `%-${runId}`],
      ),
    );

  it('loads two doctors in two companies, with the default and a supplied geofence', async () => {
    const result = await load(sheet(rowsFor()));
    expect(result.counts).toMatchObject({ doctors: 2, clinicAddresses: 3 });

    const asha = await clinicsOf('Dr Asha Rao');
    expect(asha.rows.map((r) => [r.label, r.geofence_radius_metres])).toEqual([
      ['Evening clinic', 250],
      ['Main clinic', 150],
    ]);
    // No cross-organisation leakage: each doctor is in the company that owns their territory.
    const meera = await clinicsOf('Dr Meera Iyer');
    expect(meera.rows).toHaveLength(1);
    expect(meera.rows[0]?.territory).toBe(`BN-W-PUN-${runId}`);
    for (const r of [...asha.rows, ...meera.rows]) expect(r.doctor_org).toBe(r.territory_org);
    expect(asha.rows[0]?.doctor_org).not.toBe(meera.rows[0]?.doctor_org);
  });

  it('reloading the same sheet inserts nothing and changes nothing', async () => {
    const again = await load(sheet(rowsFor()));
    expect(again.counts).toMatchObject({
      organisations: 0,
      territories: 0,
      doctors: 0,
      clinicAddresses: 0,
    });
  });

  it('a CHANGED clinic on reload fails loudly and changes nothing', async () => {
    const moved = sheet(rowsFor({ latitude: '18.6000' }));
    await expect(load(moved)).rejects.toThrow(/clinic .* already exists with different latitude/u);
    const asha = await clinicsOf('Dr Asha Rao');
    expect(asha.rows.find((r) => r.label === 'Main clinic')?.latitude).toBe(18.5204);
  });

  it('a CHANGED doctor on reload fails loudly', async () => {
    await expect(load(sheet(rowsFor({ specialty: 'Nephrology' })))).rejects.toThrow(
      /doctor .* already exists with different specialty/u,
    );
  });

  it('a doctor labelled with another company than its territory is refused, nothing written', async () => {
    const reference = sheet(rowsFor());
    const forged: ReferenceData = {
      ...reference,
      doctors: reference.doctors.map((d) => ({
        ...d,
        key: `${d.key}:FORGED`,
        organisationKey: `company:Beta Labs-${runId}`,
      })),
      clinicAddresses: [],
    };
    await expect(load(forged)).rejects.toThrow(/contradicts the organisation/u);
    const count = await withClient((client) =>
      client.query<{ n: number }>(
        `select count(*)::int as n from public.doctors d join public.territories t on t.id = d.territory_id
          where t.code like $1`,
        [`%-${runId}`],
      ),
    );
    expect(count.rows[0]?.n).toBe(2);
  });
});
