/**
 * Types for the plain-JS retention worker.
 *
 * The worker is JavaScript because it is a script, not a module API — but the test
 * suite drives it directly rather than shelling out, so it needs a shape. Declaring
 * it here keeps the suite type-safe without turning the script into a build target.
 */

export interface PurgeResult {
  runId: string;
  claimed: number;
  destroyed: number;
  failed: number;
  /**
   * Sessions closed as stale before the claim ran.
   *
   * Without this sweep an upload the MR simply never returned to stays `open`
   * forever, and `claim_expired_audio` only collects partials that are `abandoned`
   * or `revoked` — so its object would never be destroyed.
   */
  abandoned: number;
  /** `BE-W181`. Live-tracking positions deleted because their `purge_after` had passed. */
  pingsPurged: number;
  /** `BE-W181`. Why deleting expired positions failed, or null. A failure fails the CLI run. */
  pingPurgeError: string | null;
}

export interface PurgeOptions {
  dbUrl?: string;
  apiUrl?: string;
  serviceKey?: string;
  bucket?: string;
  limit?: number;
  /** `BE-W181`. Positions deleted per run; 10,000 unless a caller says otherwise. */
  locationPingLimit?: number;
  runId?: string;
}

export declare const runPurge: (overrides?: PurgeOptions) => Promise<PurgeResult>;
