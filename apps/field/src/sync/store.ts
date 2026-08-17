import type { SyncQueueItem } from '@fieldforce/core';
import type { SyncQueueState } from './reducer';

/**
 * Where the queue is persisted.
 *
 * **Nothing implements this yet, on purpose.** PowerSync is a native module and
 * needs a development build, which needs an Expo account and a device — neither of
 * which exists yet. Writing the adapter now would mean shipping code that has never
 * been executed, and this project has caught that twice already
 * (`close_stale_upload_sessions()`, and a purge worker nothing ran).
 *
 * The interface exists now so the reducer can be written against a boundary rather
 * than against an assumption. When PowerSync arrives it implements this; the state
 * machine does not change.
 *
 * Two properties any implementation must hold, stated here because they are the ones
 * a storage layer can quietly break:
 *
 * - **A write survives process death.** The MR is offline for a full working day and
 *   Android will kill this app. An in-memory queue that looks correct in a test is
 *   the failure this whole sprint exists to prevent.
 * - **`id` is the idempotency key and is never regenerated.** The server dedupes on
 *   it, which is what makes a retry safe. A store that mints a new id on rewrite
 *   turns one visit into two.
 */
export interface SyncQueueStore {
  /** Everything still on the device, oldest first by `clientCreatedAt`. */
  load: () => Promise<readonly SyncQueueItem[]>;
  /** Persist the whole state after a transition. Must be atomic. */
  save: (state: SyncQueueState) => Promise<void>;
}
