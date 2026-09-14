/**
 * Types for the database backup producer — `BE-W11`.
 *
 * The pure parts are exported separately from the `pg_dump` call so the refusal, the
 * comparison and the command construction can be asserted without a database, a container or
 * a 17 MB artefact. The end-to-end behaviour — produce, then restore from it and query the
 * restored copy — was exercised in MR-33 B4, with two failure controls.
 */

/** Counts taken from one database, in the shape the manifest records and the verifier compares. */
export interface BackupCounts {
  migrations: number;
  tables: number;
  rlsTables: number;
  policies: number;
  /** Row counts per qualified table name. `-1` means the table did not exist. */
  rows: Record<string, number>;
}

/** The tables whose row counts go in the manifest. */
export declare const MANIFEST_TABLES: readonly string[];

/**
 * The URL to dump from, or a thrown refusal.
 *
 * Throws when `SUPABASE_DB_URL` points somewhere non-local and no `--db-url` was given: a
 * dump of this database is a package of personal data, and producing one must never happen
 * because an environment variable was left set.
 */
export declare const resolveTarget: (input: { dbUrlFlag?: string; envUrl?: string }) => string;

/** What a restored database must match for the restore to be believed. */
export declare const compareCounts: (
  a: BackupCounts,
  b: BackupCounts,
) => { ok: boolean; differences: string[] };

/** Counts read from a live database. */
export declare const readCounts: (dbUrl: string) => Promise<BackupCounts>;

/**
 * The `pg_dump` invocation: on PATH, or inside a named container.
 *
 * The container form connects over the local socket rather than the URL, because the host
 * URL names the published port and the container's own localhost does not have it.
 */
export declare const pgDumpCommand: (input: {
  dbUrl: string;
  sqlPath: string;
  container?: string;
}) => {
  command: string;
  args: string[];
  copyOut?: { container: string; inner: string };
};
