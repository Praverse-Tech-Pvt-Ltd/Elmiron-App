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

/**
 * MR-35 C1. The check's own preconditions.
 *
 * A drift verdict is only meaningful if the ledger and the schema are describing the same
 * database. `verify:rollbacks` leaves a database with every version still recorded as applied
 * and no tables at all, and against that the comparison above agrees perfectly — about a
 * database that is gone.
 */
export interface DriftPreconditions {
  /** True when a drift verdict may be given at all. */
  ok: boolean;
  /** Why not, in a form that names the state rather than the symptom. Empty when `ok`. */
  reasons: string[];
}

export declare const evaluatePreconditions: (facts: {
  migrationFileCount: number;
  appliedCount: number;
  publicTableCount: number;
}) => DriftPreconditions;

/**
 * MR-35 C1. HOW the applied set falls short, not how far — a count cannot tell a deploy that
 * stopped from versions applied out of band, and the two need different responses.
 *
 * - `complete` — every file is applied.
 * - `partial-prefix` — the applied set is exactly the first N files in order: a deploy that
 *   stopped. `supabase db push` resumes.
 * - `interleaved` — the gaps are not a trailing run, so versions were applied individually.
 * - `foreign-versions` — the database has applied a version with no file here.
 */
export declare const classifyShortfall: (
  fileVersions: readonly string[],
  appliedVersions: readonly string[],
) => 'complete' | 'partial-prefix' | 'interleaved' | 'foreign-versions';

/**
 * MR-42 C1. WHICH of three states a run is in, so a red means something.
 *
 * `foreign-versions` and `interleaved` are never accepted, at any date: those are the findings
 * the check exists for.
 */
export declare const classifyRun: (facts: {
  result: { drifted: boolean; appliedWithoutFile: readonly string[] };
  shortfall: 'complete' | 'partial-prefix' | 'interleaved' | 'foreign-versions';
  /** `YYYY-MM-DD`, UTC. */
  today: string;
  /** `YYYY-MM-DD`, or `null` when no acceptance was granted. */
  acceptUntil: string | null;
}) => 'no-drift' | 'accepted-not-deployed' | 'deferral-expired' | 'real-drift';
