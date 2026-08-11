/**
 * Types for the post-restore reconciliation worker.
 *
 * Same arrangement as the retention worker: plain JS because it is a script, typed
 * here because the suite drives the real thing rather than a reimplementation of it.
 */

export interface ReconcileRowFinding {
  kind: 'recording' | 'voice_note' | 'upload_partial';
  id: string;
  visitId: string;
}

export interface ReconcileResult {
  runId: string;
  applied: boolean;
  rowsChecked: number;
  objectsSeen: number;
  /** The database claimed these were live. Storage did not have them. */
  rowsWithoutObject: ReconcileRowFinding[];
  /** Storage held these. No live row referenced them. */
  objectsWithoutRow: string[];
}

export interface ReconcileOptions {
  dbUrl?: string;
  apiUrl?: string;
  serviceKey?: string;
  bucket?: string;
  runId?: string;
  /** False by default. Nothing is changed unless this is explicitly true. */
  apply?: boolean;
  note?: string | null;
}

export declare const reconcileAfterRestore: (
  overrides?: ReconcileOptions,
) => Promise<ReconcileResult>;
