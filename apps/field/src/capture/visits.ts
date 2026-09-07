import {
  fromMileageRow,
  fromVisitRow,
  refusalForSqlState,
  toCreateVisitBody,
} from '@fieldforce/core';
import type { CreateVisitRequest, MileageDay, Refusal, Visit, VisitStatus } from '@fieldforce/core';
import { resolveClient } from './client';
import type { RpcCaller, TableWriter } from './client';

/**
 * FE-W16, the unblocked half: visits and mileage against the real server.
 *
 * **Consent and samples are deliberately not here.** Consent waits on the offline-capture
 * decision — `capture_consent` evaluates staleness against `now()`, which refuses every
 * queued capture from a day when the notice changed, and choosing between that and
 * trusting a client clock is a product decision rather than an engineering one. Samples
 * wait because nothing server-side counts UCPMP caps, and converting the write while the
 * screen still tells the MR the app is not counting would make the screen the only honest
 * part of the feature.
 *
 * **Visits are written to the table, not through an RPC**, because `visits` carries
 * INSERT, SELECT and UPDATE policies that already say everything the server needs to say.
 * Check-in needed an RPC because work-hours, geofence and duration are enforced inside it
 * and a client must not be able to skip them; nothing equivalent applies here.
 *
 * `mr_id` is never sent. The column defaults to `auth.uid()` (migration `20260907000600`)
 * and the insert policy still checks it, so the caller cannot assert an identity at all.
 */
export type VisitOutcome =
  | { readonly kind: 'saved'; readonly visit: Visit }
  | { readonly kind: 'refused'; readonly refusal: Refusal };

export type MileageOutcome =
  | { readonly kind: 'loaded'; readonly days: readonly MileageDay[] }
  | { readonly kind: 'refused'; readonly refusal: Refusal };

export const createVisit = async (
  input: CreateVisitRequest,
  client?: TableWriter,
): Promise<VisitOutcome> => {
  const db = await resolveClient(client);
  const { data, error } = await db
    .from('visits')
    .insert(toCreateVisitBody(input))
    .select()
    .single();

  if (error !== null) return { kind: 'refused', refusal: refusalForSqlState(error.code) };
  return { kind: 'saved', visit: fromVisitRow(data) };
};

/**
 * The only fields a client may move.
 *
 * `started_at` and `completed_at` are the visit's own clock and the MR owns them.
 * `received_at`, `mr_id` and `created_at` are the server's and are not offered here —
 * the update policy would refuse a change of `mr_id` anyway, and there is no reason to
 * send a value whose only correct answer the server already holds.
 */
export interface VisitProgress {
  readonly status?: VisitStatus;
  readonly startedAt?: string | null;
  readonly completedAt?: string | null;
}

export const updateVisit = async (
  id: string,
  progress: VisitProgress,
  client?: TableWriter,
): Promise<VisitOutcome> => {
  const patch: Record<string, unknown> = {};
  if (progress.status !== undefined) patch['status'] = progress.status;
  if (progress.startedAt !== undefined) patch['started_at'] = progress.startedAt;
  if (progress.completedAt !== undefined) patch['completed_at'] = progress.completedAt;

  const db = await resolveClient(client);
  const { data, error } = await db.from('visits').update(patch).eq('id', id).select().single();

  if (error !== null) return { kind: 'refused', refusal: refusalForSqlState(error.code) };
  return { kind: 'saved', visit: fromVisitRow(data) };
};

/**
 * Mileage, through `daily_mileage` rather than the `GET /mileage` the contract declares.
 *
 * There is no `mileage` table or view — FIX-03 found the declared path has no backend at
 * all and registered it as `BE-W52`. The distance is summed server-side from stored
 * coordinates ordered by `occurred_at`; a client-computed figure would be an expense
 * claim the claimant wrote for themselves.
 */
export const listMileage = async (
  from: string,
  to: string,
  client?: RpcCaller,
): Promise<MileageOutcome> => {
  const db = await resolveClient(client);
  const { data, error } = await db.rpc('daily_mileage', { p_from: from, p_to: to });

  if (error !== null) return { kind: 'refused', refusal: refusalForSqlState(error.code) };
  const rows: unknown[] = Array.isArray(data) ? data : [];
  return { kind: 'loaded', days: rows.map(fromMileageRow) };
};
