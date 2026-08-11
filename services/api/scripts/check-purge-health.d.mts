/**
 * Types for the retention watchdog.
 *
 * `evaluatePurgeHealth` is pure and exported separately from the database call so
 * the suite can prove the failure path without arranging a genuinely stopped purge —
 * which would otherwise mean waiting out a 48-hour silence window.
 */

export interface PurgeHealth {
  lastSuccessfulRunAt: string | null;
  lastRunAt: string | null;
  overdueObjectCount: number;
  abandonedPartialCount: number;
  openSessionCount: number;
  liveObjectCount: number;
  stalled: boolean;
  destroyedTotal: number;
}

export interface PurgeHealthVerdict {
  healthy: boolean;
  reasons: string[];
}

export declare const evaluatePurgeHealth: (
  health: Partial<PurgeHealth> & Record<string, unknown>,
  options?: { maxSilenceHours?: number; now?: Date },
) => PurgeHealthVerdict;

export declare const checkPurgeHealth: (overrides?: {
  dbUrl?: string;
  maxSilenceHours?: number;
}) => Promise<PurgeHealthVerdict & { health: PurgeHealth }>;
