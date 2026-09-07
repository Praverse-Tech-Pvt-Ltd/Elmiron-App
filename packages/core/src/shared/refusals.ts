import { z } from 'zod';

/**
 * What a database refusal means to the person holding the phone.
 *
 * The rule this exists to keep: **a denial renders as a denial.** Until FIX-06 no client
 * code mapped a SQLSTATE anywhere — `grep -rn "sqlstate\|errcode" apps/ packages/`
 * returned nothing — so every deliberate refusal the schema raises arrived as one generic
 * failure. That satisfies the letter of the rule and defeats its purpose: the single thing
 * a refusal exists to produce is an action the user can take, and "something went wrong"
 * is not an action.
 *
 * **This maps codes, never messages.** The English is not the contract; copy has to be
 * changeable without breaking a client, and the same refusal has to survive translation.
 *
 * **Only codes the schema actually raises appear here.** Inventory taken across all
 * migrations:
 *
 * | SQLSTATE | raises | meaning here |
 * | -------- | -----: | ------------ |
 * | `22023`  |     64 | invalid parameter — **overloaded, see below** |
 * | `42501`  |     43 | insufficient privilege |
 * | `28000`  |     31 | not authenticated |
 * | `23514`  |     16 | check constraint |
 * | `23503`  |      4 | foreign key |
 * | `0A000`  |      2 | feature not supported |
 * | `23001`  |      2 | append-only violation |
 * | `23505`  |      1 | unique violation |
 * | `45001`  |      1 | consent notice superseded |
 * | `45002`  |      1 | no shift window configured |
 * | `45003`  |      1 | outside the shift window |
 * | `45004`  |      1 | UCPMP sample cap exceeded (BE-W21) |
 * | `45005`  |      1 | sync cursor not recognised (BE-W61) |
 * | `45006`  |      1 | sync cursor too old, re-sync (BE-W61) |
 * | `45007`  |      1 | consent captured in the future (FIX-12) |
 * | `45008`  |      1 | consent older than the maximum sync lag (FIX-12) |
 *
 * **`45004` was minted in FIX-09 and never reached this table.** A server-side code with
 * no client-side mapping renders as `unrecognised`, which is honest and useless: the MR is
 * told the app does not know why, when the server said something specific and actionable.
 * Added here with the five that follow it, and the lesson is that minting a SQLSTATE is
 * half the work.
 *
 * **`22023` deliberately carries no specific meaning.** It is raised sixty-four times for
 * unrelated reasons, so any specific message attached to it would be a guess dressed as a
 * fact. Where a refusal needs its own action, it gets its own code in the `450xx` range —
 * `45001` established that in FIX-02 and `45002`/`45003` follow it in FIX-06. If a future
 * refusal needs to be actionable, mint a code; do not widen `22023`.
 */
export const RefusalCodeSchema = z.enum([
  'not_authenticated',
  'not_permitted',
  'consent_notice_superseded',
  'shift_window_not_configured',
  'outside_shift_window',
  'ucpmp_sample_cap_exceeded',
  'sync_cursor_unrecognised',
  'sync_cursor_expired',
  'consent_captured_in_future',
  'consent_too_old_to_accept',
  'append_only',
  'invalid_for_this_record',
  'references_missing_record',
  'already_exists',
  'not_supported',
  'invalid_request',
  /** The server refused and this contract does not know why. Never guessed at. */
  'unrecognised',
]);
export type RefusalCode = z.infer<typeof RefusalCodeSchema>;

export interface Refusal {
  readonly code: RefusalCode;
  /** The SQLSTATE that produced it, kept for logs and for reporting an unmapped code. */
  readonly sqlState: string;
  /**
   * Whether the person holding the phone can do something about it now.
   *
   * `true` means there is a next step for the user — re-read the notice, wait until the
   * shift starts. `false` means it needs somebody else: a manager, an admin, an engineer.
   * The UI uses this to decide between offering an action and explaining a wall.
   */
  readonly actionable: boolean;
}

/**
 * Exported so a test can derive the other side of this mapping from the DATABASE and
 * compare, rather than from a list somebody maintains. `45004` was minted in FIX-09 and
 * never reached this table, so a UCPMP cap refusal rendered to an MR as `unrecognised` --
 * the server said something specific and actionable and the app said it did not know.
 * Minting a SQLSTATE and wiring it are two steps, and one of them is silently skippable.
 * `error-contract.spec.ts` is the mechanism that stops that happening again.
 */
export const BY_SQLSTATE: Readonly<Record<string, { code: RefusalCode; actionable: boolean }>> = {
  '28000': { code: 'not_authenticated', actionable: true },
  '42501': { code: 'not_permitted', actionable: false },
  '45001': { code: 'consent_notice_superseded', actionable: true },
  '45002': { code: 'shift_window_not_configured', actionable: false },
  '45003': { code: 'outside_shift_window', actionable: true },
  // Not actionable by the MR: the remedy is to stop and speak to a manager, which is
  // somebody else's decision, not a next step the app can offer.
  '45004': { code: 'ucpmp_sample_cap_exceeded', actionable: false },
  // Both sync-cursor codes are actionable, and this is the reason they are two codes
  // rather than one. `45005` means the cursor is wrong and the client must start again
  // with a null one; `45006` means it was right and is now too old for the server to
  // vouch for, and the client must do the same thing for a different reason. A client
  // that logs them together loses the difference between a bug and a handset in a drawer.
  '45005': { code: 'sync_cursor_unrecognised', actionable: true },
  '45006': { code: 'sync_cursor_expired', actionable: true },
  // The device clock is ahead of the server. Actionable, and NOT by re-asking the doctor
  // -- telling an MR to repeat a consent conversation because their phone thinks it is
  // Thursday would be both useless and slightly insulting.
  '45007': { code: 'consent_captured_in_future', actionable: true },
  // Sync sooner. Distinct from `45001` precisely because the remedy differs: this consent
  // was valid when it was taken and arrived too late to be accepted on the device's word.
  '45008': { code: 'consent_too_old_to_accept', actionable: true },
  '23001': { code: 'append_only', actionable: false },
  '23514': { code: 'invalid_for_this_record', actionable: false },
  '23503': { code: 'references_missing_record', actionable: false },
  '23505': { code: 'already_exists', actionable: false },
  '0A000': { code: 'not_supported', actionable: false },
  // Overloaded sixty-four ways. Deliberately generic — see the table above.
  '22023': { code: 'invalid_request', actionable: false },
};

/**
 * Maps a SQLSTATE to a refusal, or reports that it is unrecognised.
 *
 * **Never invents a meaning.** An unmapped code returns `unrecognised`, which the UI
 * renders as an honest "the server refused this and the app does not recognise the
 * reason". Guessing at a refusal is worse than admitting the app does not know: a wrong
 * explanation sends the MR to do the wrong thing, and they have no way to tell.
 */
export const refusalForSqlState = (sqlState: string | null | undefined): Refusal => {
  const state = sqlState ?? '';
  const known = BY_SQLSTATE[state];
  return known === undefined
    ? { code: 'unrecognised', sqlState: state, actionable: false }
    : { code: known.code, sqlState: state, actionable: known.actionable };
};

/**
 * PostgREST's error envelope, which is **not** this repo's `ApiErrorResponseSchema`.
 *
 * Measured against the running stack rather than assumed:
 *
 * ```
 * POST /rest/v1/rpc/record_check_in  ->
 *   {"code":"22023","details":null,"hint":null,
 *    "message":"check-in at ... is outside the configured shift window for territory ..."}
 * ```
 *
 * `code` is the SQLSTATE. The mock returns the other envelope, so anything reading errors
 * has to handle both for as long as both are in use — which is a consequence of the
 * contract/schema drift recorded in FIX-03, not of this file.
 */
export const PostgrestErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.string().nullable().optional(),
  hint: z.string().nullable().optional(),
});
export type PostgrestError = z.infer<typeof PostgrestErrorSchema>;

/** Reads a refusal out of an unknown error payload. Returns `null` if it is not one. */
export const refusalFromPayload = (payload: unknown): Refusal | null => {
  const parsed = PostgrestErrorSchema.safeParse(payload);
  return parsed.success ? refusalForSqlState(parsed.data.code) : null;
};
