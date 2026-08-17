import type {
  ServerSyncStatus,
  SyncItemReinstatement,
  SyncQueueItem,
  SyncRejectionCode,
  SyncWarning,
} from '@fieldforce/core';

/**
 * Everything that can happen to the offline queue, as data.
 *
 * The queue is a pure reducer over these — `(state, event) => state` — with no
 * knowledge of where rows live. PowerSync arrives later as an adapter behind
 * `SyncQueueStore`, not as a rewrite of this logic. **If a transition ever needs to
 * know how something is persisted, that is the signal the boundary has been crossed
 * and the work should stop there.**
 */

/**
 * The server's verdict on one item. A subset of `SyncItemExplained` — the fields a
 * transition actually turns on, and no more.
 *
 * `receivedAt` is the server's clock. It is the only timestamp allowed to mark an
 * item as landed; the device clock is not trusted for anything with a compliance
 * meaning, and "when did my work reach the server" is one of those.
 */
export interface ServerVerdict {
  readonly id: string;
  readonly status: ServerSyncStatus;
  readonly rejectionCode: SyncRejectionCode | null;
  /** The sentence Backend wrote. Displayed verbatim, never rephrased or invented. */
  readonly explanation: string | null;
  readonly warnings: readonly SyncWarning[];
  readonly attemptsRemaining: number;
  /** Server clock. */
  readonly receivedAt: string;
}

export type SyncEvent =
  /** The MR did something offline. */
  | { readonly type: 'enqueued'; readonly item: SyncQueueItem }
  /** A push started for these ids. */
  | { readonly type: 'batch_started'; readonly ids: readonly string[] }
  /** The server answered about one item. Each item is isolated from the others. */
  | { readonly type: 'verdict_received'; readonly verdict: ServerVerdict }
  /** The push never reached the server — no verdict, nothing decided. */
  | {
      readonly type: 'attempt_failed';
      readonly ids: readonly string[];
      readonly error: string;
    }
  /** A dead letter reversed by an authorised person. */
  | { readonly type: 'reinstated'; readonly reinstatement: SyncItemReinstatement };
