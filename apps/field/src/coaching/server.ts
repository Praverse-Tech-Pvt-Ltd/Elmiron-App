import {
  ListAnalysesPageSchema,
  ListConsentRecordsPageSchema,
  ReadAnalysisResponseSchema,
  refusalForSqlState,
} from '@fieldforce/core';
import type { Analysis, ConsentRecord, Refusal } from '@fieldforce/core';
import { resolveClient } from '../capture/client';
import type { RpcCaller } from '../capture/client';

/**
 * FE-D16 — coaching on the real server, the way FE-D14 moved Day end and Mileage.
 *
 * The three reads are the functions the console already uses (latest definitions:
 * `20260923000100_console_reads_contract_shape.sql:31, 103, 144`). An MR may call them: each is
 * scoped by `visible_user_ids()`, which for an MR is themselves (`20260908000900`), and an MR needs
 * no reason (`p_reason` is required only for an admin). They were reached through the mock's REST
 * paths at `127.0.0.1:4010` before, which a phone cannot reach.
 *
 * **Every response is parsed with `packages/core`'s own schema.** One that does not parse is a
 * `mismatch`, shown as a failure. It is never reshaped here to fit: a gap in the contract is
 * backend's to close, and the FE-CR says so.
 */
export type ServerRead<T> =
  | { readonly kind: 'loaded'; readonly value: T }
  | { readonly kind: 'refused'; readonly refusal: Refusal }
  | { readonly kind: 'mismatch'; readonly detail: string };

/** The one method of a core schema this module uses. Structural, so `zod` is not a dependency here. */
interface EnvelopeSchema<T> {
  safeParse(
    value: unknown,
  ): { readonly success: true; readonly data: { readonly data: T } } | { readonly success: false };
}

const read = async <T>(
  fn: string,
  args: Record<string, unknown>,
  schema: EnvelopeSchema<T>,
  client?: RpcCaller,
): Promise<ServerRead<T>> => {
  const db = await resolveClient(client);
  const { data, error } = await db.rpc(fn, args);
  if (error !== null) return { kind: 'refused', refusal: refusalForSqlState(error.code) };
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    return {
      kind: 'mismatch',
      detail: `The server's answer to ${fn} is not the shape this app expects.`,
    };
  }
  return { kind: 'loaded', value: parsed.data.data };
};

/** The MR's own analyses. No `p_mr_id` and no reason: an MR sees only their own. */
export const listMyAnalyses = (client?: RpcCaller): Promise<ServerRead<readonly Analysis[]>> =>
  read('list_analyses', { p_mr_id: null, p_reason: null }, ListAnalysesPageSchema, client);

/** One analysis. `null` when it is not the MR's: the server answers an out-of-scope id that way. */
export const readMyAnalysis = (
  analysisId: string,
  client?: RpcCaller,
): Promise<ServerRead<Analysis | null>> =>
  read(
    'read_analysis',
    { p_analysis_id: analysisId, p_reason: null },
    ReadAnalysisResponseSchema,
    client,
  );

/** The consent records for one visit, for the "they agreed to recording" line. */
export const listConsentForVisit = (
  visitId: string,
  client?: RpcCaller,
): Promise<ServerRead<readonly ConsentRecord[]>> =>
  read(
    'list_consent_records',
    { p_visit_id: visitId, p_reason: null },
    ListConsentRecordsPageSchema,
    client,
  );

export type ReplyOutcome =
  { readonly kind: 'sent' } | { readonly kind: 'refused'; readonly refusal: Refusal };

/**
 * The MR's reply, through `respond_to_analysis` (`20260811000300_audit_log.sql:461`), which
 * updates only the caller's own analysis (`:488-489`).
 *
 * **Its return value is not read.** It returns a raw snake_case row (`:496`), not the `Analysis`
 * contract, and the screen does not need it: on success it goes back to the analysis, which
 * re-reads through `read_analysis`. FE-CR-10 asks backend about the shape.
 *
 * **It is not queued.** The sync queue has no entity for a reply (`packages/core/src/field/sync.ts:12-21`),
 * so a reply sent with no signal fails and stays on the screen. FE-CR-10 asks for one.
 */
export const respondToMyAnalysis = async (
  analysisId: string,
  response: string,
  client?: RpcCaller,
): Promise<ReplyOutcome> => {
  const db = await resolveClient(client);
  const { error } = await db.rpc('respond_to_analysis', {
    p_analysis_id: analysisId,
    p_response: response.trim(),
  });
  return error === null
    ? { kind: 'sent' }
    : { kind: 'refused', refusal: refusalForSqlState(error.code) };
};
