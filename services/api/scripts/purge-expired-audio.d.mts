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
}

export interface PurgeOptions {
  dbUrl?: string;
  apiUrl?: string;
  serviceKey?: string;
  bucket?: string;
  limit?: number;
  runId?: string;
}

export declare const runPurge: (overrides?: PurgeOptions) => Promise<PurgeResult>;
