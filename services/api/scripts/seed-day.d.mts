/**
 * Types for `seed-day.mjs`, which is plain `.mjs` like every script in this directory.
 *
 * The scripts deliberately do not import `packages/core` — `scripts-convention.spec.ts`
 * guards that, because the retention workflows run them with no build step. A declaration
 * file is how the suite gets types without the script gaining a compile step.
 */

export declare const DEMO_MARKER: string;

/** Throws unless the URL's host is 127.0.0.1, ::1 or localhost. */
export declare const assertLocalhostOnly: (dbUrl: string) => void;

export interface SeedDayOptions {
  email?: string;
  password?: string;
  apiUrl?: string;
  dbUrl?: string;
  serviceRoleKey?: string;
  /** Create a SECOND demo tenant instead of refusing. */
  another?: boolean;
}

export interface SeedDayResult {
  runId: string;
  email: string;
  password: string;
  managerEmail: string;
  adminEmail: string;
  organisationId: string;
  territoryId: string;
  doctorIds: string[];
  visitIds: string[];
  consentTextVersionId: string;
}

export declare const seedDay: (options?: SeedDayOptions) => Promise<SeedDayResult>;
