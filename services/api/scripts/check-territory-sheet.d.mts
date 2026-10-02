/**
 * Types for the territory-template checker (W1-N A3). Pure functions, so the suite proves every
 * refusal without a database.
 */

export declare const TERRITORY_COLUMNS: readonly string[];
export declare const MR_COLUMNS: readonly string[];

export interface SheetError {
  sheet: string;
  row: number;
  code: string;
  detail: string;
}

export interface ReferenceData {
  organisations: { key: string; name: string }[];
  territories: {
    key: string;
    name: string;
    code: string;
    parentKey: string | null;
    organisationKey: string;
  }[];
  doctors: never[];
  consentTextVersions: never[];
}

export declare const parseCsv: (text: string) => string[][];

export declare const checkTerritorySheet: (input: { territoriesCsv: string; mrsCsv: string }) => {
  errors: SheetError[];
  reference: ReferenceData | null;
};
