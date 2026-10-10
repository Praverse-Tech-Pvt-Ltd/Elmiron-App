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

/** BE-W179: one clinic of one doctor in the same file. Coordinates are never invented. */
export interface ReferenceClinicAddress {
  key: string;
  doctorKey: string;
  label: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  latitude?: number | null;
  longitude?: number | null;
  /** Default 150. */
  geofenceRadiusMetres?: number;
}

export interface ReferenceConsentTextVersion {
  key: string;
  /** MR-07 / BE-W79: a consent notice belongs to a tenant, like a doctor or a territory. */
  organisationKey: string;
  versionLabel: string;
  language: string;
  fullText: string;
}

export interface ReferenceData {
  organisations: ReferenceOrganisation[];
  territories: ReferenceTerritory[];
  doctors: ReferenceDoctor[];
  /** BE-W179. Optional: files written before it have none. */
  clinicAddresses?: ReferenceClinicAddress[];
  consentTextVersions: ReferenceConsentTextVersion[];
}

export interface SeedResult {
  applied: boolean;
  counts: {
    organisations: number;
    territories: number;
    doctors: number;
    clinicAddresses: number;
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
