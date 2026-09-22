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
/**
 * **MR-49 — `FE-W61`. The queue belongs to the MR who made it.**
 *
 * This was ONE key, `sync.queue.v1`, for everyone who signs in on the phone, and nothing cleared
 * it at sign-out. Measured on the Pixel 10: rep A queued a check-in and a consent answer offline
 * and signed out; rep B signed in, B's queue screen listed A's two writes and offered "Try again
 * now", and B's app sent them under B's sign-in. The server refused both (`not_your_record`),
 * so nothing false was recorded -- but the sync ledger now holds two rejected items attributed to
 * B for A's visit, B was shown A's work, and A's check-in and the doctor's answer were lost.
 *
 * Now keyed per user, the way the pulled store and its cursor have been since MR-15. The owner is
 * set by `SessionProvider` from the signed-in session. With no owner there is no queue to read or
 * write: reads answer `unreadable`, so every writer refuses rather than guessing (`FE-W44`'s
 * path), and nothing is ever filed under nobody.
 *
 * **The old shared key is never read again.** Its items cannot be attributed to anyone, and
 * sending them as whoever signs in next is exactly the defect. They stay on disk untouched.
 */
const LEGACY_SHARED_KEY = 'sync.queue.v1';
const keyFor = (userId: string): string => `${LEGACY_SHARED_KEY}.${userId}`;

let owner: string | null = null;

/** Called by `SessionProvider` whenever the signed-in user changes. */
export const setQueueOwner = (userId: string | null): void => {
  owner = userId;
};

/** Whose queue is being read and written right now. */
export const queueOwner = (): string | null => owner;

/** Exported for the test that pins it: the shared key is not a key this module reads. */
export const QUEUE_KEYS = { legacyShared: LEGACY_SHARED_KEY, forUser: keyFor } as const;

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
    if (owner === null) return [];
    try {
      const raw = await AsyncStorage.getItem(keyFor(owner));
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
    if (owner === null) throw new Error('No one is signed in, so there is no queue to write.');
    await AsyncStorage.setItem(keyFor(owner), JSON.stringify(state));
  },
};

/**
 * The outcome of reading the queue — **`FE-W44`, MR-33 D1.**
 *
 * **An empty queue and an unreadable one are not the same fact, and this used to return the
 * same value for both.** A parse failure or an AsyncStorage rejection answered `emptyQueue`,
 * and every caller then acted on "there is nothing outstanding" — which is a claim about the
 * MR's work, not about storage.
 *
 * What that produced, at each of the four call sites:
 *
 * | Screen | Said |
 * | --- | --- |
 * | `home.tsx`, `day-end.tsx` | **"Everything sent"** — asserting the writes reached the server |
 * | `queue.tsx` | an empty list, on the screen an MR opens when they already suspect something is wrong |
 * | `visit/[id].tsx` | fed `witnessedStage` an empty queue, so a queued check-in was invisible — **MR-28's defect 12 by another route** |
 *
 * A discriminated result rather than `null`, for the reason MR-31 recorded: the caller has to
 * open it, so the number of call sites that read the discriminant is structurally all of
 * them. A discriminant with zero readers is a sentinel with extra steps.
 */
export type QueueLoad =
  { readonly kind: 'loaded'; readonly state: SyncQueueState } | { readonly kind: 'unreadable' };

/** The full state, for a screen that needs rejections and warnings as well as items. */
export const loadQueueState = async (): Promise<QueueLoad> => {
  // No owner, no queue. `unreadable` rather than empty: an empty answer would let a writer
  // start a queue that belongs to nobody, and would tell a screen "everything sent".
  if (owner === null) return { kind: 'unreadable' };
  try {
    const raw = await AsyncStorage.getItem(keyFor(owner));
    // Genuinely absent is genuinely empty: nothing has ever been queued on this device.
    // That is an answer, and it is different from the catch below.
    if (raw === null) return { kind: 'loaded', state: emptyQueue };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { kind: 'unreadable' };
    const shape = parsed as Partial<Record<keyof SyncQueueState, unknown>>;
    return {
      kind: 'loaded',
      state: {
        items: parseItems(shape.items),
        // These three are the server's answers about items. They are stored as written
        // and read back defensively: a malformed map must not take the queue with it.
        rejections: (shape.rejections ?? {}) as SyncQueueState['rejections'],
        reinstatements: (shape.reinstatements ?? {}) as SyncQueueState['reinstatements'],
        warnings: (shape.warnings ?? {}) as SyncQueueState['warnings'],
      },
    };
  } catch {
    return { kind: 'unreadable' };
  }
};

/**
 * What every screen says when the queue cannot be read.
 *
 * One sentence, exported, so four screens cannot drift into four. **Engineering's default**,
 * in the shape `FE-W39` settled: it names the missing thing and claims nothing either way
 * about whether the work was sent, because that is exactly what is unknown.
 */
export const QUEUE_UNREADABLE =
  'This app could not read your queue, so it cannot tell you what has been sent. Nothing has been lost from the server — but nothing on this screen is confirmed either. Tell your manager if it persists.';

/** Test seam. */
export const clearQueue = async (): Promise<void> => {
  if (owner === null) return;
  try {
    await AsyncStorage.removeItem(keyFor(owner));
  } catch {
    // Nothing to do.
  }
};
