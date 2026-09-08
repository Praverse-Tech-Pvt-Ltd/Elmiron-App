import type { SyncQueueItem, SyncRejectionCode, SyncWarning } from '@fieldforce/core';
import type { ServerVerdict, SyncEvent } from './events';

/**
 * The offline queue as a pure reducer.
 *
 * `my_upload_queue()` is the MR's only proof that their day's work is safe, so the
 * rules below are the ones that decide whether they trust the app. Three of them are
 * easy to get backwards:
 *
 * 1. **`duplicate` is success.** The item id is the server's idempotency key, so a
 *    retry of something already accepted comes back `duplicate`. Treating that as a
 *    failure shows an MR a red row for work that landed perfectly.
 * 2. **A failed attempt decides nothing.** No verdict means the server never saw it.
 *    The item returns to `queued`; it is never dropped and never marked failed.
 * 3. **A rejection is not a toast.** It stays in the state until it is resolved or
 *    reinstated, because a rejection the MR did not happen to be looking at is a
 *    lost day's work.
 */

export interface RejectionRecord {
  readonly code: SyncRejectionCode;
  /** Backend's sentence, verbatim. `null` when the server sent none. */
  readonly explanation: string | null;
  readonly attemptsRemaining: number;
  /** True once no attempts remain — the item needs a person, not another retry. */
  readonly deadLettered: boolean;
  /**
   * The SERVER's clock, or null when the server sent none.
   *
   * Nullable since MR-08 C5, and the nullability is the fix — see `ServerVerdict` in
   * `events.ts`. Carry the server's value or carry none; never substitute the device's.
   */
  readonly receivedAt: string | null;
}

export interface ReinstatementRecord {
  readonly reinstatedByUserId: string;
  readonly reason: string;
  readonly createdAt: string;
}

export interface SyncQueueState {
  /** Oldest first by `clientCreatedAt`. Device order — the order work was done. */
  readonly items: readonly SyncQueueItem[];
  readonly rejections: Readonly<Record<string, RejectionRecord>>;
  readonly reinstatements: Readonly<Record<string, ReinstatementRecord>>;
  readonly warnings: Readonly<Record<string, readonly SyncWarning[]>>;
}

export const emptyQueue: SyncQueueState = {
  items: [],
  rejections: {},
  reinstatements: {},
  warnings: {},
};

const byClientCreatedAt = (a: SyncQueueItem, b: SyncQueueItem): number =>
  a.clientCreatedAt === b.clientCreatedAt
    ? a.id.localeCompare(b.id)
    : a.clientCreatedAt.localeCompare(b.clientCreatedAt);

const replace = (
  items: readonly SyncQueueItem[],
  id: string,
  change: (item: SyncQueueItem) => SyncQueueItem,
): readonly SyncQueueItem[] => items.map((item) => (item.id === id ? change(item) : item));

const applyVerdict = (state: SyncQueueState, verdict: ServerVerdict): SyncQueueState => {
  const known = state.items.some((item) => item.id === verdict.id);
  // A verdict for something this device is not holding is not an invitation to
  // invent a row. Nothing is known about its payload, so nothing can be shown.
  if (!known) return state;

  const warnings =
    verdict.warnings.length === 0
      ? state.warnings
      : { ...state.warnings, [verdict.id]: verdict.warnings };

  switch (verdict.status) {
    // `duplicate` means an earlier attempt already landed. Same outcome as
    // `accepted` for the MR, and deliberately not distinguished on screen.
    case 'accepted':
    case 'duplicate':
      return {
        ...state,
        items: replace(state.items, verdict.id, (item) => ({
          ...item,
          status: 'synced',
          // The server's clock, never the device's.
          syncedAt: verdict.receivedAt,
          lastError: null,
        })),
        warnings,
      };

    case 'rejected':
    case 'dead_lettered': {
      if (verdict.rejectionCode === null) {
        throw new Error(
          `Server rejected ${verdict.id} with no rejectionCode. The app cannot explain a refusal it was not given a reason for.`,
        );
      }
      return {
        ...state,
        items: replace(state.items, verdict.id, (item) => ({ ...item, status: 'failed' })),
        rejections: {
          ...state.rejections,
          [verdict.id]: {
            code: verdict.rejectionCode,
            explanation: verdict.explanation,
            attemptsRemaining: verdict.attemptsRemaining,
            deadLettered: verdict.status === 'dead_lettered',
            receivedAt: verdict.receivedAt,
          },
        },
        warnings,
      };
    }
  }
};

export const syncQueueReducer = (state: SyncQueueState, event: SyncEvent): SyncQueueState => {
  switch (event.type) {
    case 'enqueued': {
      // Re-enqueueing a known id is a no-op, not a second row. The id is the
      // idempotency key; duplicating it locally would duplicate the visit.
      if (state.items.some((item) => item.id === event.item.id)) return state;
      return { ...state, items: [...state.items, event.item].sort(byClientCreatedAt) };
    }

    case 'batch_started': {
      const ids = new Set(event.ids);
      return {
        ...state,
        items: state.items.map((item) =>
          ids.has(item.id) && item.status === 'queued' ? { ...item, status: 'in_flight' } : item,
        ),
      };
    }

    case 'verdict_received':
      return applyVerdict(state, event.verdict);

    case 'attempt_failed': {
      const ids = new Set(event.ids);
      return {
        ...state,
        items: state.items.map((item) =>
          ids.has(item.id) && item.status === 'in_flight'
            ? {
                ...item,
                // Back to queued, never to failed. Without a verdict the server
                // decided nothing, and the work is still the MR's to deliver.
                status: 'queued',
                attemptCount: item.attemptCount + 1,
                lastError: event.error,
              }
            : item,
        ),
      };
    }

    case 'reinstated': {
      const { reinstatement } = event;
      if (reinstatement.reason.trim() === '') {
        // Attribution plus a mandatory reason is the whole control on reversing a
        // dead letter — there is deliberately no fault taxonomy behind it.
        throw new Error(
          'A reinstatement requires a reason. Attribution without one proves nothing.',
        );
      }
      if (!state.items.some((item) => item.id === reinstatement.syncItemId)) return state;

      return {
        ...state,
        items: replace(state.items, reinstatement.syncItemId, (item) => ({
          ...item,
          status: 'queued',
          lastError: null,
        })),
        // The rejection record is kept. A reversed dead letter is a thing that
        // happened, and erasing it would erase why somebody had to intervene.
        reinstatements: {
          ...state.reinstatements,
          [reinstatement.syncItemId]: {
            reinstatedByUserId: reinstatement.reinstatedByUserId,
            reason: reinstatement.reason,
            createdAt: reinstatement.createdAt,
          },
        },
      };
    }
  }
};

/** What the queue screen counts. Derived, never stored — one source of truth. */
export interface QueueSummary {
  readonly total: number;
  readonly unsynced: number;
  readonly failed: number;
  readonly deadLettered: number;
  /**
   * Named for its provenance. This is the **device's** clock and must never be
   * rendered as when the server received anything.
   */
  readonly oldestUnsyncedClientCreatedAt: string | null;
}

export const summarise = (state: SyncQueueState): QueueSummary => {
  const unsynced = state.items.filter((item) => item.status !== 'synced');
  const oldest = unsynced[0];
  return {
    total: state.items.length,
    unsynced: unsynced.length,
    failed: state.items.filter((item) => item.status === 'failed').length,
    deadLettered: Object.values(state.rejections).filter((r) => r.deadLettered).length,
    oldestUnsyncedClientCreatedAt: oldest?.clientCreatedAt ?? null,
  };
};
