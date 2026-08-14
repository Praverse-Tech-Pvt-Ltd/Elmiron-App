/** Types for the reference-data seed script. */

export interface ReferenceOrganisation {
  key: string;
  name: string;
}

export interface ReferenceTerritory {
  key: string;
  name: string;
  code: string;
  parentKey?: string | null;
  organisationKey: string;
}

export interface ReferenceDoctor {
  key: string;
  organisationKey: string;
  territoryKey: string;
  fullName: string;
  registrationNumber?: string | null;
  specialty?: string | null;
  qualification?: string | null;
}

export interface ReferenceConsentTextVersion {
  key: string;
  versionLabel: string;
  language: string;
  fullText: string;
}

export interface ReferenceData {
  organisations: ReferenceOrganisation[];
  territories: ReferenceTerritory[];
  doctors: ReferenceDoctor[];
  consentTextVersions: ReferenceConsentTextVersion[];
}

export interface SeedResult {
  applied: boolean;
  counts: {
    organisations: number;
    territories: number;
    doctors: number;
    consentTextVersions: number;
  };
}

export declare const seedReferenceData: (
  data: ReferenceData,
  overrides?: { apply?: boolean; dbUrl?: string },
) => Promise<SeedResult>;

export interface SeedCliArgs {
  apply: boolean;
  dataPath: string;
  dbUrl: string | undefined;
}

export declare const parseSeedCliArgs: (argv: string[]) => SeedCliArgs;
