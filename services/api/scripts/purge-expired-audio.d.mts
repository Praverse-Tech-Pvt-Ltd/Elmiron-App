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
