import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BeatPlanEntrySchema,
  BeatPlanRecordSchema,
  ClinicAddressSchema,
  PulledConsentTextVersionSchema,
  DoctorRecordSchema,
  VisitSchema,
} from '@fieldforce/core';
import { emptyStore } from './pull';
import type { LocalStore } from './pull';
import type { PullCursorStore } from './pull-cursor';
import type { DayAnchor } from '../today/day-anchor';

/**
 * Where the PULLED records live between app launches — MR-14 B1.
 *
 * **This exists because the cursor already survived a restart and the records did not.**
 * `pull-cursor.ts` persists the cursor; `pull.ts`'s `LocalStore` is four in-memory `Map`s
 * and `store.ts` persists only the OUTBOX. So a restart loaded a valid cursor over an
 * empty store, `sync_pull` correctly returned only the changes SINCE that cursor — nothing,
 * on a quiet morning — and the MR got a blank day with no error, no retry and nothing on
 * screen saying why. The server was right, the client was right, and the day was gone.
 *
 * That is the silent-loss failure the whole snapshot design exists to prevent, reappearing
 * on the client side, and it is the same shape as the per-user cursor key: two pieces of
 * state that must move together and did not.
 *
 * **So the invariant is: the store and the cursor advance together or neither does.**
 * `save` below writes the records and the cursor is written by the caller in the same step;
 * `load` returns null when it cannot produce a trustworthy store, and the caller's response
 * to null is to CLEAR THE CURSOR and take a full sweep. Losing the cursor is safe and
 * expensive — `pull-cursor.ts` says so — while keeping a cursor whose store is gone is
 * neither.
 *
 * **Keyed per user, for the reason the cursor is.** A shared device that switched MRs and
 * kept the previous MR's records would show one person another person's day.
 */

const key = (userId: string): string => `sync.pull.store.v1.${userId}`;

/**
 * The on-disk shape.
 *
 * Arrays of records rather than the `Map`s the store holds, because a `Map` does not
 * survive `JSON.stringify` — it serialises as `{}`, which would persist an empty store
 * that looks successful. Written as entity-keyed arrays so a future entity is an added key
 * rather than a positional change.
 */
interface StoredShape {
  readonly version: 1;
  readonly visit: readonly unknown[];
  readonly doctor: readonly unknown[];
  readonly beat_plan: readonly unknown[];
  readonly beat_plan_entry: readonly unknown[];
  readonly clinic_address: readonly unknown[];
  readonly consent_text_version: readonly unknown[];
}

export interface PulledStorePersistence {
  /** The stored records, or null when there is nothing trustworthy to return. */
  readonly load: (userId: string) => Promise<LocalStore | null>;
  readonly save: (userId: string, store: LocalStore) => Promise<void>;
  /**
   * **Clears the records AND the day anchor, and that is the invariant, not a convenience.**
   *
   * `FE-W40` B3. An anchor that outlived the records it describes is the
   * cursor-ahead-of-records failure at the top of this file wearing new clothes: Today would
   * render a DATE, from a real server instant, over a store holding nothing — *"0 of 0 visits
   * attended"* presented as the MR's plan for the day. That is a false statement assembled
   * from two true ones.
   *
   * Putting both behind one `clear` means the two cannot be separated by a caller who forgets.
   */
  readonly clear: (userId: string) => Promise<void>;
  /** The last server instant this device heard, or null. See `day-anchor.ts`. */
  readonly loadAnchor: (userId: string) => Promise<DayAnchor | null>;
  readonly saveAnchor: (userId: string, anchor: DayAnchor) => Promise<void>;
}

/**
 * The anchor's own key, beside the records' and keyed per user for the same reason.
 *
 * Separate from the records' key rather than folded into `StoredShape`, deliberately. The
 * records are written after EVERY page of a sweep; the anchor is one small value written
 * beside them. Bumping `StoredShape` to version 2 would make every existing install fail
 * `deserialise`, clear its cursor and take a full sweep — a correct but expensive way to add
 * a field that a missing key already handles safely.
 *
 * **Both failure directions are safe, which is why they may be written separately.** A missing
 * anchor means no day on a cold start, which is exactly the behaviour before this existed. A
 * STALE anchor means an older `asOf`, which is bounded by the territory day boundary and
 * renders nothing once it is crossed. Neither can produce a day the server never gave.
 */
const anchorKey = (userId: string): string => `sync.pull.anchor.v1.${userId}`;

/**
 * Is this string a timezone `Intl` will actually accept?
 *
 * **MR-31 B3. Checking the SHAPE of a value is not checking that it is USABLE, and this one
 * wedged sync rather than merely rendering wrong.** `deserialiseAnchor` originally required
 * `timeZone` to be a non-empty string, which `"garbage"` satisfies. `Intl.DateTimeFormat`
 * does not throw on a bad locale but **does** throw `RangeError: Invalid time zone specified`
 * on a bad zone, so the first `dayIn` inside `resolveAnchoredDay` threw — inside the sync
 * effect's `try`, which reported it as `{ kind: 'unreachable' }`.
 *
 * The consequence was not a wrong clock. It was that hydration threw **before the pull ran**,
 * so nothing rewrote the bad anchor, so every subsequent launch did the same thing: sync
 * permanently wedged and reported to the MR as *"the app could not reach the server"*.
 *
 * A value that crossed a process boundary is input. This is the cheapest possible check that
 * it is input this app can use, and a rejected anchor costs a cold start its day and nothing
 * else — the pull then runs and writes a good one.
 */
const usableTimeZone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
    return true;
  } catch {
    return false;
  }
};

/**
 * Parsed, never cast — the same rule the records follow.
 *
 * An anchor written by an older build with a missing `timeZone` would otherwise reckon the
 * day boundary against `undefined`, and `resolveAnchoredDay` would compare a real day against
 * `"Invalid Date"`. Refusing the whole value costs a cold start its day and claims nothing.
 */
const deserialiseAnchor = (raw: unknown): DayAnchor | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const shape = raw as Partial<DayAnchor>;
  if (typeof shape.serverTime !== 'string' || shape.serverTime === '') return null;
  if (typeof shape.receivedAt !== 'number' || !Number.isFinite(shape.receivedAt)) return null;
  if (typeof shape.timeZone !== 'string' || shape.timeZone === '') return null;
  if (!usableTimeZone(shape.timeZone)) return null;
  if (shape.zoneSource !== 'territory' && shape.zoneSource !== 'fallback_utc') return null;
  return {
    serverTime: shape.serverTime,
    receivedAt: shape.receivedAt,
    timeZone: shape.timeZone,
    zoneSource: shape.zoneSource,
  };
};

const serialise = (store: LocalStore): StoredShape => ({
  version: 1,
  visit: [...store.visit.values()],
  doctor: [...store.doctor.values()],
  beat_plan: [...store.beat_plan.values()],
  beat_plan_entry: [...store.beat_plan_entry.values()],
  clinic_address: [...store.clinic_address.values()],
  consent_text_version: [...store.consent_text_version.values()],
});

/**
 * Back to a store — PARSED, never cast.
 *
 * The records crossed a process boundary and a version of this app that may not be this
 * one. Casting would let a record written by an older build reach a screen with a field
 * missing, which is how a plausible-looking wrong value gets rendered as fact. A row that
 * does not parse is dropped and the whole load is refused, because a partially-restored day
 * is indistinguishable on screen from a complete one.
 */
const deserialise = (raw: unknown): LocalStore | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const shape = raw as Partial<StoredShape>;
  if (shape.version !== 1) return null;
  if (
    !Array.isArray(shape.visit) ||
    !Array.isArray(shape.doctor) ||
    !Array.isArray(shape.beat_plan) ||
    // MR-44 / `BE-W89`. Same mechanism as the notices below, and it is what makes the
    // new entity actually reach an existing handset. The pull's cursor is a SNAPSHOT,
    // so entries that already existed keep their original `xmin` and an incremental
    // sweep would never send them. A store written before this key existed fails here,
    // the cursor is cleared with it, and the next pull is a full re-sync that does.
    !Array.isArray(shape.beat_plan_entry) ||
    !Array.isArray(shape.clinic_address) ||
    // MR-26 B1. A store written before the notices joined the pull has no such key, so it
    // fails here and `loadPulledStore` clears the cursor with it -- P1's rule, that records
    // and the cursor move together. The next pull is a full re-sync that fetches them.
    !Array.isArray(shape.consent_text_version)
  ) {
    return null;
  }

  const next = emptyStore();
  const visit = new Map(next.visit);
  const doctor = new Map(next.doctor);
  const beatPlan = new Map(next.beat_plan);
  const beatPlanEntry = new Map(next.beat_plan_entry);
  const clinicAddress = new Map(next.clinic_address);
  const consentTextVersion = new Map(next.consent_text_version);

  for (const row of shape.visit) {
    const parsed = VisitSchema.safeParse(row);
    if (!parsed.success) return null;
    visit.set(parsed.data.id, parsed.data);
  }
  for (const row of shape.doctor) {
    const parsed = DoctorRecordSchema.safeParse(row);
    if (!parsed.success) return null;
    doctor.set(parsed.data.id, parsed.data);
  }
  for (const row of shape.beat_plan) {
    const parsed = BeatPlanRecordSchema.safeParse(row);
    if (!parsed.success) return null;
    beatPlan.set(parsed.data.id, parsed.data);
  }
  for (const row of shape.beat_plan_entry) {
    const parsed = BeatPlanEntrySchema.safeParse(row);
    if (!parsed.success) return null;
    beatPlanEntry.set(parsed.data.id, parsed.data);
  }
  for (const row of shape.clinic_address) {
    const parsed = ClinicAddressSchema.safeParse(row);
    if (!parsed.success) return null;
    clinicAddress.set(parsed.data.id, parsed.data);
  }
  for (const row of shape.consent_text_version) {
    const parsed = PulledConsentTextVersionSchema.safeParse(row);
    if (!parsed.success) return null;
    consentTextVersion.set(parsed.data.id, parsed.data);
  }

  return {
    visit,
    doctor,
    beat_plan: beatPlan,
    beat_plan_entry: beatPlanEntry,
    clinic_address: clinicAddress,
    consent_text_version: consentTextVersion,
  };
};

export const asyncStoragePulledStore: PulledStorePersistence = {
  load: async (userId) => {
    try {
      const raw = await AsyncStorage.getItem(key(userId));
      if (raw === null) return null;
      return deserialise(JSON.parse(raw));
    } catch {
      // Unreadable storage and absent storage have the same remedy — a full sweep — and
      // an exception here must not stop the app from pulling at all.
      return null;
    }
  },
  save: async (userId, store) => {
    await AsyncStorage.setItem(key(userId), JSON.stringify(serialise(store)));
  },
  clear: async (userId) => {
    try {
      // Both, always. See the note on `clear` in the interface above.
      await AsyncStorage.multiRemove([key(userId), anchorKey(userId)]);
    } catch {
      // Already gone, or storage is unavailable. The next load returns null and the next
      // pull is a full sweep, which is what clearing it was for.
    }
  },
  loadAnchor: async (userId) => {
    try {
      const raw = await AsyncStorage.getItem(anchorKey(userId));
      if (raw === null) return null;
      return deserialiseAnchor(JSON.parse(raw));
    } catch {
      // An unreadable anchor is the same as none: the cold start shows no day and says so.
      return null;
    }
  },
  saveAnchor: async (userId, anchor) => {
    await AsyncStorage.setItem(anchorKey(userId), JSON.stringify(anchor));
  },
};

/** In-memory, for tests and for a first launch before storage is available. */
export const memoryPulledStore = (): PulledStorePersistence => {
  const held = new Map<string, string>();
  const anchors = new Map<string, string>();
  return {
    load: (userId) => {
      const raw = held.get(userId);
      if (raw === undefined) return Promise.resolve(null);
      return Promise.resolve(deserialise(JSON.parse(raw)));
    },
    save: (userId, store) => {
      held.set(userId, JSON.stringify(serialise(store)));
      return Promise.resolve();
    },
    clear: (userId) => {
      // Both, so the in-memory double cannot pass a test the real one would fail.
      held.delete(userId);
      anchors.delete(userId);
      return Promise.resolve();
    },
    loadAnchor: (userId) => {
      const raw = anchors.get(userId);
      if (raw === undefined) return Promise.resolve(null);
      return Promise.resolve(deserialiseAnchor(JSON.parse(raw)));
    },
    saveAnchor: (userId, anchor) => {
      anchors.set(userId, JSON.stringify(anchor));
      return Promise.resolve();
    },
  };
};

/**
 * Load the records, and keep the cursor honest about them.
 *
 * **The whole point of this function is the `clear` call.** A cursor without its records is
 * the defect described at the top of this file, and the only safe response is to forget the
 * cursor so the next pull is a full sweep. Callers must use this rather than
 * `persistence.load` directly, which is why the cursor store is a parameter here.
 */
export const loadPulledStore = async (
  userId: string,
  persistence: PulledStorePersistence,
  cursors: PullCursorStore,
): Promise<LocalStore> => {
  const restored = await persistence.load(userId);
  if (restored !== null) return restored;
  // `FE-W40` B3. The cursor AND the anchor go with the records. `persistence.clear` drops
  // both keys, so an anchor can never outlive the store it describes -- see the note on
  // `clear`. Without this line a corrupt store would leave a perfectly valid anchor behind
  // and Today would render a real date over nothing.
  await cursors.clear(userId);
  await persistence.clear(userId);
  return emptyStore();
};
