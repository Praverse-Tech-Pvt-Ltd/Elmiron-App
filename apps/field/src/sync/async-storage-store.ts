import AsyncStorage from '@react-native-async-storage/async-storage';
import { SyncQueueItemSchema } from '@fieldforce/core';
import type { SyncQueueItem } from '@fieldforce/core';
import { emptyQueue } from './reducer';
import type { SyncQueueState } from './reducer';
import type { SyncQueueStore } from './store';

/**
 * `SyncQueueStore`, on AsyncStorage.
 *
 * **Why this exists now rather than waiting for PowerSync.** `store.ts` deferred
 * the adapter because PowerSync is a native module needing a development build
 * "which needs an Expo account and a device — neither of which exists yet". A
 * development build exists now, but PowerSync still is not installed, and the queue
 * having *no* implementation meant nothing was ever enqueued: an MR who lost signal
 * lost the work. That is the gap FE-G2 gates on, and it does not need PowerSync to
 * close.
 *
 * **It meets both invariants `store.ts` names.**
 *
 * - *A write survives process death.* AsyncStorage is SQLite-backed on Android, so
 *   a queued check-in is on disk before the promise resolves and is still there
 *   after Android kills the app mid-shift. Verified on the emulator by force-stop.
 * - *`id` is never regenerated.* Items are stored as they arrive and parsed back
 *   through the contract's own schema. Nothing here mints an id.
 *
 * **What it is not.** PowerSync gives conflict resolution and server-driven
 * reconciliation; this gives a durable outbox. For an append-only queue of
 * device-generated, idempotent writes that is the whole requirement — but a future
 * entity needing real merge semantics needs the real thing, and this file should be
 * replaced rather than extended.
 */
const KEY = 'sync.queue.v1';

/**
 * Rows are parsed back through `SyncQueueItemSchema` rather than cast.
 *
 * A queue is exactly where a shape drift becomes invisible: the item was written by
 * a previous version of the app, sits on disk for a day, and is pushed to a server
 * that rejects it for a reason nobody can reconstruct. Parsing on read turns that
 * into a dropped row here, with the rest of the day still intact.
 */
const parseItems = (raw: unknown): readonly SyncQueueItem[] => {
  if (!Array.isArray(raw)) return [];
  const items: SyncQueueItem[] = [];
  for (const candidate of raw) {
    const parsed = SyncQueueItemSchema.safeParse(candidate);
    if (parsed.success) items.push(parsed.data);
  }
  return items;
};

export const asyncStorageQueueStore: SyncQueueStore = {
  load: async (): Promise<readonly SyncQueueItem[]> => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw === null) return [];
      const parsed: unknown = JSON.parse(raw);
      // Tolerates both shapes: the full state object this module writes, and a bare
      // array, which is what an older build stored.
      return parseItems(
        typeof parsed === 'object' && parsed !== null && 'items' in parsed ? parsed.items : parsed,
      );
    } catch {
      // An unreadable queue reads as empty rather than throwing. The MR still gets
      // their day; what they lose is the outbox, and a screen that will not render
      // loses that too plus everything else.
      return [];
    }
  },

  save: async (state: SyncQueueState): Promise<void> => {
    // One key, one write. AsyncStorage has no transaction across keys, so the whole
    // state goes in a single value — which is what makes the write atomic in the
    // sense `store.ts` asks for: a reader sees the state before or after, never a
    // half-applied transition.
    await AsyncStorage.setItem(KEY, JSON.stringify(state));
  },
};

/** The full state, for a screen that needs rejections and warnings as well as items. */
export const loadQueueState = async (): Promise<SyncQueueState> => {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw === null) return emptyQueue;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return emptyQueue;
    const shape = parsed as Partial<Record<keyof SyncQueueState, unknown>>;
    return {
      items: parseItems(shape.items),
      // These three are the server's answers about items. They are stored as written
      // and read back defensively: a malformed map must not take the queue with it.
      rejections: (shape.rejections ?? {}) as SyncQueueState['rejections'],
      reinstatements: (shape.reinstatements ?? {}) as SyncQueueState['reinstatements'],
      warnings: (shape.warnings ?? {}) as SyncQueueState['warnings'],
    };
  } catch {
    return emptyQueue;
  }
};

/** Test seam. */
export const clearQueue = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Nothing to do.
  }
};
