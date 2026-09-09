import {
  SyncPullResponseSchema,
  fromBeatPlanRow,
  fromClinicAddressRow,
  fromDoctorRow,
  fromVisitRow,
  refusalForSqlState,
} from '@fieldforce/core';
import type {
  BeatPlanRecord,
  ClinicAddress,
  DoctorRecord,
  Refusal,
  SyncCompleteness,
  SyncPullResponse,
  Visit,
} from '@fieldforce/core';
import { resolveClient } from '../capture/client';
import type { RpcCaller } from '../capture/client';
import type { PullCursorStore } from './pull-cursor';

/**
 * FE-W22 — the first client in this product to receive a real server response.
 *
 * Every response-side divergence found so far was found by something trying to use one.
 * `PROJECT-OVERVIEW.md` states the finding as a prediction: *the characteristic defect of
 * this codebase is unexercised code that looks exercised, and the only detector that has
 * ever worked is trying to use it.* What this file found on first contact is recorded in
 * FIX-14 §C4; the shape below is the answer to it.
 *
 * **Rows, not aggregates.** A pull payload is `to_jsonb(row)` — the table and nothing
 * else. `Doctor` requires `clinicAddresses` and `BeatPlan` requires `entries`, and neither
 * is a column, so neither aggregate can be built from a pull. The mappers produce
 * `DoctorRecord` and `BeatPlanRecord`, which is what actually arrives.
 *
 * **Nothing here decides what the MR may see.** Scope is the server's, through RLS and
 * through the `former_*` columns on `sync_events`; this applies what it is given. A client
 * that filtered would be implementing permission logic in the client, and would also be
 * wrong, since it cannot see what it was not sent.
 */

/** What a change means for the local store. Deletion and scope-loss are NOT the same. */
export type PullChange =
  | { readonly kind: 'upsert'; readonly entity: 'visit'; readonly record: Visit }
  | { readonly kind: 'upsert'; readonly entity: 'doctor'; readonly record: DoctorRecord }
  | { readonly kind: 'upsert'; readonly entity: 'beat_plan'; readonly record: BeatPlanRecord }
  /**
   * MR-11 / BE-W87. Its own entity, because a doctor payload is the row and nothing else.
   * The aggregate `Doctor.clinicAddresses` is assembled from these on the client.
   */
  | {
      readonly kind: 'upsert';
      readonly entity: 'clinic_address';
      readonly record: ClinicAddress;
    }
  | {
      readonly kind: 'remove';
      readonly entity: 'visit' | 'doctor' | 'beat_plan' | 'clinic_address';
      readonly id: string;
      /**
       * Why it is going. `deleted` means the record is gone; `out_of_scope` means it still
       * exists and is somebody else's now. **The app must never render the second as the
       * first** — "deleted" is false, and for a consent record it would be dangerously so.
       */
      readonly reason: 'deleted' | 'out_of_scope';
    };

/**
 * What, if anything, the user must be told about this response's completeness.
 *
 * `null` when the server omits nothing, and that silence is load-bearing: a notice that
 * appears on every pull teaches people to dismiss it, and then it is not there on the pull
 * where it mattered.
 */
export interface PullNotice {
  readonly title: string;
  readonly body: string;
}

export type PullOutcome =
  | {
      readonly kind: 'pulled';
      readonly changes: readonly PullChange[];
      readonly notice: PullNotice | null;
      readonly hasMore: boolean;
      readonly cursor: string;
      /** True when a too-old cursor forced this pull to start over. */
      readonly resynced: boolean;
    }
  | { readonly kind: 'refused'; readonly refusal: Refusal };

/**
 * The completeness field, in words an MR can act on.
 *
 * Deliberately not a code and not the server's `note` verbatim — the note is written for
 * whoever reads the response, and this is written for somebody standing in a clinic.
 */
export const noticeFor = (completeness: SyncCompleteness): PullNotice | null => {
  if (completeness.omits.length === 0) return null;

  const omitsRemovals =
    completeness.omits.includes('delete') || completeness.omits.includes('out_of_scope');
  if (!omitsRemovals) return null;

  return {
    title: 'Your list has been rebuilt',
    body:
      'This was a full refresh, so anything that was removed since you last synced has ' +
      'simply gone rather than being marked as removed. Everything below is what the ' +
      'server has for you right now.',
  };
};

const mapChange = (change: SyncPullResponse['changes'][number]): PullChange => {
  if (change.reason !== 'upserted') {
    return { kind: 'remove', entity: change.entity, id: change.entityId, reason: change.reason };
  }
  // A payload-free upsert would be a server defect rather than something to paper over:
  // parsing null through a row mapper produces a message nobody can act on.
  if (change.payload === null) {
    throw new Error(`sync_pull returned an upsert with no payload for ${change.entity}`);
  }
  switch (change.entity) {
    case 'visit':
      return { kind: 'upsert', entity: 'visit', record: fromVisitRow(change.payload) };
    case 'doctor':
      return { kind: 'upsert', entity: 'doctor', record: fromDoctorRow(change.payload) };
    case 'beat_plan':
      return { kind: 'upsert', entity: 'beat_plan', record: fromBeatPlanRow(change.payload) };
    case 'clinic_address':
      return {
        kind: 'upsert',
        entity: 'clinic_address',
        record: fromClinicAddressRow(change.payload),
      };
    default: {
      // **The same guard `applyChanges` got in MR-11, on the dispatcher directly above
      // it.** MR-11 fixed the bare `else` forty lines down and left this switch alone,
      // which is the audit-scoped-to-the-defect-site habit MR-12 exists to break.
      //
      // Without this, a fifth `SyncPullEntity` still fails the build -- but as TS2366,
      // "Function lacks ending return statement". That names the wrong problem, and the
      // obvious fix for it (a trailing `return` or `throw`) removes the guard for good.
      // It also disappears the moment the return type is widened to include null. A
      // `never` assignment says which branch is missing and survives both.
      // `change.entity`, not `change`. Unlike `PullChange` in `applyChanges`, the wire
      // type is a single object whose `entity` field is a union rather than a
      // discriminated union of objects, so narrowing the switch narrows the FIELD and
      // `change` itself never becomes `never`.
      const unhandled: never = change.entity;
      throw new Error(`unhandled pull entity: ${String(unhandled)}`);
    }
  }
};

export const mapChanges = (response: SyncPullResponse): readonly PullChange[] =>
  response.changes.map(mapChange);

export interface PullDeps {
  readonly userId: string;
  readonly cursors: PullCursorStore;
  readonly client?: RpcCaller;
  readonly limit?: number;
}

const callPull = async (
  db: RpcCaller,
  cursor: string | null,
  limit: number,
): Promise<{ data: unknown; error: { code?: string | null; message: string } | null }> =>
  db.rpc('sync_pull', { p_cursor: cursor, p_entities: null, p_limit: limit });

/**
 * One pull, with the full re-sync that a too-old cursor requires.
 *
 * **`45006` must not surface as a generic failure.** It means the cursor was valid and is
 * now older than the server will vouch for, and the remedy — start again with no cursor —
 * is something the app can simply do. Surfacing it would be the shift-window refusal
 * defect in a new place: a specific, actionable server answer rendered as "something went
 * wrong".
 *
 * `45005` is deliberately handled the same way. It means the cursor is one this server did
 * not issue — a client upgrade, a restored backup — and the remedy is identical. They stay
 * two codes because they are two different things to a person reading a log, which is the
 * reasoning the error contract already records.
 */
export const pullOnce = async (deps: PullDeps): Promise<PullOutcome> => {
  const db = await resolveClient<RpcCaller>(deps.client);
  const limit = deps.limit ?? 200;
  const stored = await deps.cursors.load(deps.userId);

  let resynced = false;
  let { data, error } = await callPull(db, stored, limit);

  if (error !== null) {
    const refusal = refusalForSqlState(error.code);
    if (refusal.code === 'sync_cursor_expired' || refusal.code === 'sync_cursor_unrecognised') {
      await deps.cursors.clear(deps.userId);
      resynced = true;
      ({ data, error } = await callPull(db, null, limit));
    }
    if (error !== null) {
      return { kind: 'refused', refusal: refusalForSqlState(error.code) };
    }
  }

  // Parsed, never cast. The response crosses a process boundary and a network, and this
  // is the only place that can notice the server changed shape.
  const response = SyncPullResponseSchema.parse(data);
  await deps.cursors.save(deps.userId, response.nextCursor);

  return {
    kind: 'pulled',
    changes: mapChanges(response),
    notice: noticeFor(response.completeness),
    hasMore: response.hasMore,
    cursor: response.nextCursor,
    resynced,
  };
};

/**
 * Applies changes to a keyed local store.
 *
 * Pure and store-shaped rather than a screen: the state machine is the part worth testing,
 * and every screen that consumes it is a `.tsx` this runner cannot render.
 */
export type LocalStore = {
  readonly visit: ReadonlyMap<string, Visit>;
  readonly doctor: ReadonlyMap<string, DoctorRecord>;
  readonly beat_plan: ReadonlyMap<string, BeatPlanRecord>;
  /**
   * MR-11 / BE-W87. Held separately and joined to a doctor on read, because that is how
   * the server sends them and inventing an aggregate here would put back the coupling the
   * separate entity exists to avoid.
   */
  readonly clinic_address: ReadonlyMap<string, ClinicAddress>;
};

export const emptyStore = (): LocalStore => ({
  visit: new Map(),
  doctor: new Map(),
  beat_plan: new Map(),
  clinic_address: new Map(),
});

export const applyChanges = (store: LocalStore, changes: readonly PullChange[]): LocalStore => {
  const next = {
    visit: new Map(store.visit),
    doctor: new Map(store.doctor),
    beat_plan: new Map(store.beat_plan),
    clinic_address: new Map(store.clinic_address),
  };
  for (const change of changes) {
    if (change.kind === 'remove') {
      // Both reasons remove the row. They differ in what the user is told, not in what
      // the store does -- a record that is no longer yours must not stay on the handset
      // any more than a deleted one, which is the privacy half of ADR §6 Q2.
      next[change.entity].delete(change.id);
      continue;
    }

    // **A switch with a `never` default, not an if/else chain.** The chain this replaces
    // ended in a bare `else` that wrote to `beat_plan`, so adding a fourth entity without
    // touching this line would have stored every clinic address as a beat plan -- the
    // same misroute MR-08 found in `sendFor`, where a check-out was replayed as a
    // check-in because the dispatch fell off the end. Here the compiler stops it.
    switch (change.entity) {
      case 'visit':
        next.visit.set(change.record.id, change.record);
        break;
      case 'doctor':
        next.doctor.set(change.record.id, change.record);
        break;
      case 'beat_plan':
        next.beat_plan.set(change.record.id, change.record);
        break;
      case 'clinic_address':
        next.clinic_address.set(change.record.id, change.record);
        break;
      default: {
        const unhandled: never = change;
        throw new Error(`unhandled pull entity: ${JSON.stringify(unhandled)}`);
      }
    }
  }
  return next;
};

/**
 * A doctor with their addresses, assembled from the two streams.
 *
 * **This is where the cost of the separate-entity design is paid, and where B4's honesty
 * requirement lives.** A doctor can arrive before their addresses -- they are independent
 * rows in one cursor-ordered stream -- so `clinicAddresses` may legitimately be empty for
 * a while. That is reported as `addressesPending`, never as an address of `null` and never
 * as a wrong one: the product's rule is that the app does not present what the server has
 * not said.
 *
 * A caller that wants to render a clinic line checks `addressesPending` first. A caller
 * that wants to geofence has no address, and `record_check_in` records
 * `geofence_status = 'unavailable'` rather than refusing -- decided in MR-11 B3.
 */
export interface DoctorWithAddresses {
  readonly doctor: DoctorRecord;
  readonly clinicAddresses: readonly ClinicAddress[];
  /** True while the doctor is known and no address for them has arrived yet. */
  readonly addressesPending: boolean;
}

export const doctorWithAddresses = (
  store: LocalStore,
  doctorId: string,
): DoctorWithAddresses | null => {
  const doctor = store.doctor.get(doctorId);
  if (doctor === undefined) return null;
  const clinicAddresses = [...store.clinic_address.values()].filter(
    (address) => address.doctorId === doctorId,
  );
  return { doctor, clinicAddresses, addressesPending: clinicAddresses.length === 0 };
};

/**
 * What to say when a record leaves. **Never "deleted" for `out_of_scope`.**
 *
 * ADR §6 Q2: the app must never say "deleted" for a record that was reassigned. It is
 * false, and for a consent record dangerously so. `sync-pull.test.ts` asserts the word
 * cannot appear for that reason.
 */
export const removalWording = (reason: 'deleted' | 'out_of_scope'): string =>
  reason === 'deleted'
    ? 'This record was removed on the server.'
    : 'This is no longer yours. It has moved to another territory.';
