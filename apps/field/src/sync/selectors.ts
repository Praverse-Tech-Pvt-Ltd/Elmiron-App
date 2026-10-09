import type { Doctor, SyncQueueItem, Visit } from '@fieldforce/core';
import { doctorWithAddresses } from './pull';
import type { LocalStore } from './pull';

/**
 * The pulled store, in the shapes the screens already take — MR-14 B2.
 *
 * **This is where the cost of the separate-entity design is paid.** `summariseDay`,
 * `buildDoctorRows` and `buildDoctorProfile` all take `Doctor`, which requires
 * `clinicAddresses`. A pull payload is `to_jsonb(row)` — the table and nothing else — so
 * what actually arrives is `DoctorRecord` plus an independent `clinic_address` stream, and
 * `pull.ts`'s header is explicit that the aggregate "cannot be built from a pull".
 *
 * The join belongs here rather than in `pull.ts` (which must stay a faithful record of what
 * the server said) or in the screens (where three of them would each write their own).
 * `doctorWithAddresses` already does the per-doctor half and reports `addressesPending`;
 * this maps it across the store.
 *
 * **Nothing here decides what the MR may see.** Scope is the server's, through RLS and the
 * `former_*` columns on `sync_events`. This assembles what was sent and nothing more.
 */

/**
 * Every doctor in the store, with whatever addresses have arrived for them.
 *
 * A doctor whose addresses have not arrived yet gets an EMPTY array rather than being
 * omitted. Omitting them would hide a doctor the server has sent, which is a worse lie than
 * an incomplete one — and the emptiness is reported separately by `doctorsPendingAddresses`
 * so a screen can say "still syncing" rather than presenting the absence as fact.
 */
export const doctorsFromStore = (store: LocalStore): readonly Doctor[] =>
  [...store.doctor.keys()]
    .map((id) => doctorWithAddresses(store, id))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    // Copied into a mutable array because `DoctorSchema.clinicAddresses` is `z.array`,
    // which infers mutable, while `doctorWithAddresses` hands back a readonly view. The
    // copy is the honest conversion; widening the contract type to satisfy this would
    // loosen a schema for the convenience of one caller.
    .map((entry) => ({ ...entry.doctor, clinicAddresses: [...entry.clinicAddresses] }));

/**
 * The doctors whose addresses have not arrived — B4.
 *
 * A doctor and their addresses are independent rows in one cursor-ordered stream, so a
 * doctor can legitimately be known before any address for them is. That window is real and
 * a screen must be able to say so.
 */
export const doctorsPendingAddresses = (store: LocalStore): ReadonlySet<string> => {
  const pending = new Set<string>();
  for (const id of store.doctor.keys()) {
    const entry = doctorWithAddresses(store, id);
    if (entry !== null && entry.addressesPending) pending.add(id);
  }
  return pending;
};

/** Every visit in the store. Ordering is the caller's concern. */
export const visitsFromStore = (store: LocalStore): readonly Visit[] => [...store.visit.values()];

/**
 * `BE-W176` — an unplanned visit this phone made and has not yet seen come back in a pull.
 *
 * Until the server's copy arrives (the next pull replaces this, by id), the screens still need the
 * visit: to check in to it, to write its report -- offline above all. So a queued `visit` item is
 * read back as a Visit. Every field is what the phone itself sent; nothing the server decides is
 * claimed: no `visitDay` (the server's to give), status `planned` (not started), and the three
 * timestamps are the moment it was queued, which is all the phone knows.
 */
export const phoneMadeVisit = (
  id: string,
  items: readonly SyncQueueItem[],
  mrId: string | null,
): Visit | null => {
  // Every status, `synced` included: a sent visit is still read from here until the pull brings
  // the server's copy, which screens look up first. A `failed` one is shown too, so the screen
  // that opened it can say it was refused rather than that it does not exist.
  const item = items.find((candidate) => candidate.entity === 'visit' && candidate.entityId === id);
  if (item === undefined || mrId === null) return null;
  const payload = item.payload as {
    doctorId?: unknown;
    clinicAddressId?: unknown;
    scheduledFor?: unknown;
    unplannedReason?: unknown;
  };
  if (typeof payload.doctorId !== 'string' || typeof payload.unplannedReason !== 'string') {
    return null;
  }
  return {
    id,
    mrId,
    doctorId: payload.doctorId,
    beatPlanId: null,
    origin: 'unplanned',
    plannedDate: null,
    unplannedReason: payload.unplannedReason,
    clinicAddressId: typeof payload.clinicAddressId === 'string' ? payload.clinicAddressId : null,
    status: 'planned',
    notMetReason: null,
    scheduledFor: typeof payload.scheduledFor === 'string' ? payload.scheduledFor : null,
    startedAt: null,
    completedAt: null,
    visitDay: null,
    receivedAt: item.clientCreatedAt,
    createdAt: item.clientCreatedAt,
    updatedAt: item.clientCreatedAt,
  };
};

/**
 * The visit a screen shows for `id`: the server's copy when the pull has it, else the one this
 * phone made and queued. Keyed by the same id on both sides, so a visit is never shown twice --
 * the server's copy simply replaces the phone's when it arrives.
 */
export const visitFor = (
  id: string,
  pulled: readonly Visit[],
  items: readonly SyncQueueItem[],
  mrId: string | null,
): Visit | null =>
  pulled.find((candidate) => candidate.id === id) ?? phoneMadeVisit(id, items, mrId);
