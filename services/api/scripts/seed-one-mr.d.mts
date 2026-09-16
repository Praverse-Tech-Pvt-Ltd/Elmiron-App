/** Types for the one-user seed script. */

export type SeedRole = 'mr' | 'field_manager' | 'admin';

export interface SeedMrCliArgs {
  email: string | undefined;
  password: string | undefined;
  role: SeedRole;
  dbUrl: string | undefined;
}

export interface SeedMrOptions {
  email?: string;
  password?: string;
  role?: SeedRole;
  apiUrl?: string;
  dbUrl?: string;
  serviceRoleKey?: string;
}

export interface SeededUser {
  runId: string;
  userId: string;
  email: string;
  password: string;
  role: SeedRole;
  organisationId: string;
  territoryId: string;
}

export interface StackOptions {
  apiUrl: string;
  serviceRoleKey: string;
}

export declare const DEFAULT_DB_URL: string;
export declare const DEFAULT_API_URL: string;
export declare const DEFAULT_SERVICE_ROLE_KEY: string;

export declare const parseSeedMrArgs: (argv: string[]) => SeedMrCliArgs;
export declare const createAuthUser: (
  email: string,
  password: string,
  stack: StackOptions,
) => Promise<string>;
export declare const seedOneMr: (options?: SeedMrOptions) => Promise<SeededUser>;
export declare const verifySignIn: (
  email: string,
  password: string,
  stack: StackOptions,
) => Promise<string>;

/**
 * MR-37 C3. Refuses a non-localhost target for either URL.
 *
 * `seed:day` and `seed:synthetic` have both refused one since they were written; this seeder
 * did not, and it is the one that mints an `auth.users` identity and a `user_profiles` row —
 * a fabricated person inside a real tenant, in the table the tenant boundary is expressed in.
 *
 * Both URLs are checked because the identity is created over HTTP before the database
 * connection is opened.
 */
export declare const assertLocalhostOnly: (label: string, url: string) => void;
