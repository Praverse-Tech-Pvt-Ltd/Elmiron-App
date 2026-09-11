import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BeatPlanRecordSchema,
  ClinicAddressSchema,
  ConsentTextVersionSchema,
  DoctorRecordSchema,
  VisitSchema,
} from '@fieldforce/core';
import { emptyStore } from './pull';
import type { LocalStore } from './pull';
import type { PullCursorStore } from './pull-cursor';

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
  readonly clinic_address: readonly unknown[];
  readonly consent_text_version: readonly unknown[];
}

export interface PulledStorePersistence {
  /** The stored records, or null when there is nothing trustworthy to return. */
  readonly load: (userId: string) => Promise<LocalStore | null>;
  readonly save: (userId: string, store: LocalStore) => Promise<void>;
  readonly clear: (userId: string) => Promise<void>;
}

const serialise = (store: LocalStore): StoredShape => ({
  version: 1,
  visit: [...store.visit.values()],
  doctor: [...store.doctor.values()],
  beat_plan: [...store.beat_plan.values()],
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
  for (const row of shape.clinic_address) {
    const parsed = ClinicAddressSchema.safeParse(row);
    if (!parsed.success) return null;
    clinicAddress.set(parsed.data.id, parsed.data);
  }
  for (const row of shape.consent_text_version) {
    const parsed = ConsentTextVersionSchema.safeParse(row);
    if (!parsed.success) return null;
    consentTextVersion.set(parsed.data.id, parsed.data);
  }

  return {
    visit,
    doctor,
    beat_plan: beatPlan,
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
      await AsyncStorage.removeItem(key(userId));
    } catch {
      // Already gone, or storage is unavailable. The next load returns null and the next
      // pull is a full sweep, which is what clearing it was for.
    }
  },
};

/** In-memory, for tests and for a first launch before storage is available. */
export const memoryPulledStore = (): PulledStorePersistence => {
  const held = new Map<string, string>();
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
      held.delete(userId);
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
  await cursors.clear(userId);
  return emptyStore();
};
