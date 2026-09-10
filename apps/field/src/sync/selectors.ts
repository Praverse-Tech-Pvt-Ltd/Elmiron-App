import type { Doctor, Visit } from '@fieldforce/core';
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
