import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkTerritorySheet, parseCsv } from '../scripts/check-territory-sheet.mjs';

/**
 * W1-N A3 -- the territory template's checker. Pure: no database, so it runs everywhere.
 *
 * Each refusal the template document promises is a test here, so the document cannot claim a
 * rejection the code does not make. The first test reads the SHIPPED template's example rows, so
 * the template and the checker cannot drift apart without a red build.
 */

const TEMPLATE = join(__dirname, '..', '..', '..', 'docs', 'operator', 'territory-template');
const HEADER_T = 'level,name,code,parent_code,company';
const HEADER_M = 'name,email,mobile,territory_code,company';

const good = [
  HEADER_T,
  'National,India,IN,,Acme Pharma',
  'Region,West,IN-W,IN,Acme Pharma',
  'Area,Pune,IN-W-PUN,IN-W,Acme Pharma',
].join('\n');
const goodMrs = [HEADER_M, 'Asha Rao,asha@example.test,9000000001,IN-W-PUN,Acme Pharma'].join('\n');

const codes = (territoriesCsv: string, mrsCsv = `${HEADER_M}\n`) =>
  checkTerritorySheet({ territoriesCsv, mrsCsv }).errors.map((e) => e.code);

describe('W1-N A3 — the territory sheet checker', () => {
  it('the shipped template’s example rows are well-formed, and refused ONLY because they are examples', () => {
    // Two-sided in one sheet: if the template drifted from the checker -- a renamed column, a
    // wrong level -- a code other than `example_row` would appear here. And the examples can never
    // be loaded by accident, because each is refused by name.
    const territoriesCsv = readFileSync(join(TEMPLATE, 'Territories.csv'), 'utf8');
    const mrsCsv = readFileSync(join(TEMPLATE, 'MRs.csv'), 'utf8');
    const result = checkTerritorySheet({ territoriesCsv, mrsCsv });
    expect(new Set(result.errors.map((e) => e.code))).toEqual(new Set(['example_row']));
    expect(result.reference).toBeNull();
    // With the prefix removed, the same rows load.
    const renamed = checkTerritorySheet({
      territoriesCsv: territoriesCsv.replace(/EXAMPLE-/gu, ''),
      mrsCsv: mrsCsv.replace(/EXAMPLE-/gu, ''),
    });
    expect(renamed.errors).toEqual([]);
  });

  it('a clean sheet becomes seed:reference JSON, parents first, whatever the row order', () => {
    const shuffled = [HEADER_T, ...good.split('\n').slice(1).reverse()].join('\n');
    const result = checkTerritorySheet({ territoriesCsv: shuffled, mrsCsv: goodMrs });
    expect(result.errors).toEqual([]);
    expect(result.reference).toMatchObject({
      organisations: [{ key: 'company:Acme Pharma', name: 'Acme Pharma' }],
      doctors: [],
      consentTextVersions: [],
    });
    const territories = (
      result.reference as { territories: { code: string; parentKey: string | null }[] }
    ).territories;
    expect(territories.map((t) => t.code)).toEqual(['IN', 'IN-W', 'IN-W-PUN']);
    expect(territories[0]?.parentKey).toBeNull();
  });

  it('refuses a parent that does not exist', () => {
    expect(codes(`${good}\nArea,Nagpur,IN-W-NAG,IN-X,Acme Pharma`)).toEqual(['parent_missing']);
  });

  it('refuses a duplicate code — even in another company, because codes are unique database-wide', () => {
    expect(codes(`${good}\nNational,India,IN,,Other Pharma`)).toEqual(['duplicate_code']);
  });

  it('refuses a missing company', () => {
    expect(codes(`${good}\nArea,Nagpur,IN-W-NAG,IN-W,`)).toEqual(['missing_company']);
  });

  it('refuses a parent in another company', () => {
    expect(
      codes(`${good}\nNational,Bharat,BH,,Other Pharma\nRegion,East,BH-E,IN,Other Pharma`),
    ).toEqual(['parent_other_company']);
  });

  it('refuses a level that skips a step, a National with a parent, and an unknown level', () => {
    expect(codes(`${good}\nArea,Nagpur,IN-W-NAG,IN,Acme Pharma`)).toEqual(['level_mismatch']);
    expect(codes(`${good}\nNational,Again,IN2,IN,Acme Pharma`)).toEqual(['level_mismatch']);
    expect(codes(`${good}\nZone,Odd,IN-Z,IN,Acme Pharma`)).toEqual(['unknown_level']);
  });

  it('refuses an empty name or code', () => {
    expect(codes(`${good}\nArea,,IN-W-NAG,IN-W,Acme Pharma`)).toEqual(['missing_field']);
  });

  it('refuses a missing column outright, rather than failing every row', () => {
    expect(codes('level,name,code,company\nNational,India,IN,Acme Pharma')).toEqual([
      'missing_column',
    ]);
  });

  it('MRs: refuses a duplicate email, an unknown territory, a non-Area territory and another company', () => {
    const mrs = (line: string) =>
      checkTerritorySheet({ territoriesCsv: good, mrsCsv: `${goodMrs}\n${line}` }).errors.map(
        (e) => e.code,
      );
    expect(mrs('Asha Two,ASHA@example.test,,IN-W-PUN,Acme Pharma')).toEqual(['duplicate_email']);
    expect(mrs('Ravi,ravi@example.test,,IN-W-XXX,Acme Pharma')).toEqual(['mr_territory_missing']);
    expect(mrs('Ravi,ravi@example.test,,IN-W,Acme Pharma')).toEqual(['mr_territory_level']);
    expect(mrs('Ravi,ravi@example.test,,IN-W-PUN,Other Pharma')).toEqual(['mr_other_company']);
  });

  it('reads what Excel writes: a byte-order mark, CRLF, and quoted commas', () => {
    expect(parseCsv('﻿a,"b, c","d ""e"""\r\n1,2,3\r\n\r\n')).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['1', '2', '3'],
    ]);
  });
});
