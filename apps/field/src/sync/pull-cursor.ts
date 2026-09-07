import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Where the pull cursor lives between app launches.
 *
 * **The cursor is the only thing that must survive a restart**, and it is the one piece of
 * sync state a client must not invent. `docs/adr-sync-pull.md` §7 and the FIX-12 migration
 * both say it: it is opaque, its shape changes when the server's does, and a client that
 * parses it will depend on a shape it does not own. So this stores a string and never
 * looks inside it.
 *
 * Losing it is safe and expensive, not unsafe: a missing cursor means a full re-sync,
 * which the server will happily serve and which carries no tombstones — so the client must
 * replace rather than merge, which is what `completeness.note` tells it to do.
 *
 * Keyed per user. A shared device that switched MRs and kept the cursor would hand the
 * second MR a sweep that starts from the first MR's position, and every row between the
 * two would simply never arrive — the silent-loss failure the whole snapshot design exists
 * to prevent, reintroduced on the client side.
 */
export interface PullCursorStore {
  load: (userId: string) => Promise<string | null>;
  save: (userId: string, cursor: string) => Promise<void>;
  /** Used when the server refuses a cursor as too old: forget it and start again. */
  clear: (userId: string) => Promise<void>;
}

const key = (userId: string): string => `sync.pull.cursor.v1.${userId}`;

export const asyncStoragePullCursorStore: PullCursorStore = {
  load: async (userId) => {
    // A read that throws must not stop a pull. A missing cursor and an unreadable one
    // have the same remedy — start a full sweep — and an exception here would instead
    // leave the app never pulling at all.
    try {
      return await AsyncStorage.getItem(key(userId));
    } catch {
      return null;
    }
  },
  save: async (userId, cursor) => {
    await AsyncStorage.setItem(key(userId), cursor);
  },
  clear: async (userId) => {
    try {
      await AsyncStorage.removeItem(key(userId));
    } catch {
      // Already gone, or storage is unavailable. Either way the next load returns null
      // and the next pull is a full sweep, which is what clearing it was for.
    }
  },
};

/** In-memory, for tests and for a first launch before storage is available. */
export const memoryPullCursorStore = (): PullCursorStore => {
  const held = new Map<string, string>();
  return {
    load: (userId) => Promise.resolve(held.get(userId) ?? null),
    save: (userId, cursor) => {
      held.set(userId, cursor);
      return Promise.resolve();
    },
    clear: (userId) => {
      held.delete(userId);
      return Promise.resolve();
    },
  };
};
