import {
  fromCheckInRow,
  fromCheckOutRow,
  refusalForSqlState,
  toRecordCheckInBody,
} from '@fieldforce/core';
import { resolveClient } from './client';
import type { RpcCaller } from './client';
import type {
  CheckIn,
  CheckOut,
  CreateCheckInRequest,
  CreateCheckOutRequest,
  Refusal,
} from '@fieldforce/core';

/**
 * FE-W15 — the first write in this product that reaches a real server.
 *
 * Everything else in `apps/field` still reads from `services/mock`, which accepts a
 * write, answers `201`, and forgets it. Check-in is the right first conversion because
 * one call exercises the whole chain: a real token, PostgREST, `SECURITY DEFINER`
 * scoping, the work-hours refusal, and a row that is still there afterwards.
 *
 * **Two things are deliberately absent from this file.**
 *
 * There is no shift-window check, no geofence calculation and no permission logic. All
 * three are computed server-side and the client is not told the rule — `record_check_in`
 * resolves the window from the *doctor's* territory, stamps `received_at` from the
 * server clock, and refuses outside working hours. A client that knew the rule could be
 * wrong about it, and a client that could be wrong about it is a second, softer copy of
 * the control.
 *
 * There is no retry and no queue here either. The offline outbox already exists in
 * `src/sync/`; wiring this into it is `FE-W18` and needs the pull half first, which does
 * not exist on either side yet.
 *
 * **The call goes through `supabase.rpc` rather than the contract's `ApiClient`.** The
 * client in `packages/core` targets a bare base URL and sends only `authorization`;
 * Supabase's gateway also requires `apikey`, and a request without it is refused with a
 * `401` before PostgREST is reached — measured, not assumed. `supabase-js` already holds
 * both the key and the live session, so using it avoids a second copy of the auth
 * plumbing that would drift from the first.
 */
export type CheckInOutcome =
  | { readonly kind: 'recorded'; readonly checkIn: CheckIn }
  /**
   * The server refused. This is not an error state in the UI sense — a refusal outside
   * working hours is the system behaving correctly, and the MR needs to be told which
   * refusal it was so they can act on it.
   */
  | { readonly kind: 'refused'; readonly refusal: Refusal };

export type CheckOutOutcome =
  | { readonly kind: 'recorded'; readonly checkOut: CheckOut }
  | { readonly kind: 'refused'; readonly refusal: Refusal };

export const recordCheckIn = async (
  input: CreateCheckInRequest,
  caller?: RpcCaller,
): Promise<CheckInOutcome> => {
  const rpc = await resolveClient(caller);
  const { data, error } = await rpc.rpc('record_check_in', toRecordCheckInBody(input));

  if (error !== null) {
    return { kind: 'refused', refusal: refusalForSqlState(error.code) };
  }

  // Parsed, not cast. A row that does not match the contract throws here rather than
  // surfacing as an undefined field on a screen three steps later.
  return { kind: 'recorded', checkIn: fromCheckInRow(data) };
};

export const recordCheckOut = async (
  input: CreateCheckOutRequest,
  caller?: RpcCaller,
): Promise<CheckOutOutcome> => {
  const rpc = await resolveClient(caller);
  const { data, error } = await rpc.rpc('record_check_out', toRecordCheckInBody(input));

  if (error !== null) {
    return { kind: 'refused', refusal: refusalForSqlState(error.code) };
  }

  return { kind: 'recorded', checkOut: fromCheckOutRow(data) };
};
