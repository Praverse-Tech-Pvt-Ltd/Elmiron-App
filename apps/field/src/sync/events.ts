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
 *
 * **That paragraph was true and the code did the opposite.** `flushOutbox` filled this
 * field with `new Date().toISOString()` under the comment *"the server answered, so this
 * is the server's clock by definition"*, and `QueueScreen` rendered it as "Server
 * recorded this at …". The rule was written down, in this file, above the field it
 * describes, and the one call site that populated it ignored it.
 *
 * It is **nullable** since MR-08 C5. A response that carries no `received_at` produces
 * `null`, and nothing is rendered — because a field that is sometimes the server's clock
 * and sometimes the device's, with no way to tell which, is worse than one that is
 * sometimes absent.
 */
export interface ServerVerdict {
  readonly id: string;
  readonly status: ServerSyncStatus;
  readonly rejectionCode: SyncRejectionCode | null;
  /**
   * The SQLSTATE the server refused with — MR-17 B1 / BE-W75.
   *
   * **The contract has carried this since BE-W75 and the client dropped it.**
   * `SyncPushResultSchema` says so in its own comment: *"Prefer this over `rejectionCode`
   * when it is present, and pass it to `refusalForSqlState`, which is the one derivation
   * `error-contract.spec.ts` guards in both directions."* This type did not have the field,
   * so every `450xx` collapsed to `internal_error` and all four consent remedies plus the
   * UCPMP refusal reached the MR as one generic failure.
   *
   * `rejectionCode` stays beside it and is NOT widened. MR-04 settled why: the client
   * already holds a complete SQLSTATE map guarded in both directions, and extending the
   * enum would derive the same meaning twice with only one copy guarded.
   *
   * `null` on an accepted item, and `null` on a dead-letter replay where the code is read
   * back from `sync_items` and the original SQLSTATE was never stored.
   */
  readonly sqlState: string | null;
  /** The sentence Backend wrote. Displayed verbatim, never rephrased or invented. */
  readonly explanation: string | null;
  readonly warnings: readonly SyncWarning[];
  readonly attemptsRemaining: number;
  /** Server clock, or null when the response carried none. Never the device's. */
  readonly receivedAt: string | null;
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
