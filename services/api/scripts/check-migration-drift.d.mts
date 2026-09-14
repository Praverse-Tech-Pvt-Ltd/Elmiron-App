/**
 * Types for the migration drift check — `BE-W40`.
 *
 * `compareMigrations` and `versionsFromFilenames` are pure and exported separately from the
 * database call, so the suite can prove BOTH failure directions without arranging a real
 * divergence against a real database — which would otherwise mean applying something to a
 * database and then hiding the file, or the reverse.
 *
 * The end-to-end behaviour against a live database was exercised in MR-32 C2, both
 * directions, with a clean baseline before and after.
 */

/** The comparison, in both directions, of what a database has applied against what is here. */
export interface MigrationDrift {
  /** True when either list below is non-empty. */
  drifted: boolean;
  /**
   * Versions the database has applied with no matching file in this repository — something
   * reached it from a branch, a working copy, or a hand-run `supabase db push`.
   */
  appliedWithoutFile: string[];
  /**
   * Versions present here and never applied. The quiet direction: it looks like nothing at
   * all until a query hits a column that does not exist.
   */
  fileNotApplied: string[];
}

/** `<version>_<name>.sql` -> `<version>`, sorted, ignoring anything that is not a migration. */
export declare const versionsFromFilenames: (filenames: readonly string[]) => readonly string[];

export declare const compareMigrations: (
  fileVersions: readonly string[],
  appliedVersions: readonly string[],
) => MigrationDrift;
