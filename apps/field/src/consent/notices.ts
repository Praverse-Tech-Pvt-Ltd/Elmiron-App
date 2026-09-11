import { fromConsentTextVersionRow } from '@fieldforce/core';
import type { ConsentTextVersion } from '@fieldforce/core';
import { resolveClient } from '../capture/client';
import type { RpcCaller } from '../capture/client';

/**
 * The consent notices, from Supabase — MR-23 B1.
 *
 * **The last read on the last gating screen.** `app/consent/[visitId].tsx` fetched its
 * versions through `createClientForScenario()` — the mock at `:4010` — so an MR standing in
 * front of a doctor was shown a fixture, and a capture made against it would have named a
 * notice id that does not exist in Supabase.
 *
 * ---
 *
 * **TENANCY IS THE SERVER'S AND THIS FILE DOES NOT FILTER.**
 *
 * BE-W79 made notices tenant-scoped after MR-06 found that a tenant could display another
 * company's legal document to a doctor and capture against it. Two policies enforce it:
 * `consent_text_versions_select_own_tenant` (permissive) and
 * `consent_text_versions_tenant_boundary` (**RESTRICTIVE**, so it cannot be widened by
 * adding a permissive policy beside it). `authenticated` holds SELECT and nothing more.
 *
 * So a row that arrives here is already scoped, and there is deliberately no
 * `organisation_id` in the mapper and no `.eq('organisation_id', …)` below. A client-side
 * tenant filter would be permission logic in the client — it would look like defence in
 * depth and would in fact be a second, unguarded copy of a rule the database owns.
 */

/**
 * The notices this tenant has published, FROM THE PULLED STORE — MR-26 B1.
 *
 * **Why this exists beside the two network functions below.** MR-25 D1 measured that consent
 * could not be captured with no signal: `fetchConsentNotices` calls PostgREST, so an MR in a
 * basement clinic saw *"the app could not reach the server"* and the visit ended with the
 * doctor never asked either way. A question that cannot be put is not a consent flow.
 *
 * Since MR-26 B1 the consent text version travels in `sync_pull` as its own entity, so the
 * rows are on the handset already — server-issued, tenant-scoped by the RESTRICTIVE policy,
 * and refreshed by the same cursor as everything else. Reading them here is not the client
 * deciding anything; it is the client using what it was sent.
 *
 * Synchronous and total. There is no failure mode to model: an empty store is an empty list,
 * which `blockedReason` already words as *"there is no consent notice for this language yet"*
 * — and that sentence is now TRUE when it appears, which it was not when a dead network could
 * produce it.
 */
export const noticesFromStore = (store: {
  readonly consent_text_version: ReadonlyMap<string, ConsentTextVersion>;
}): readonly ConsentTextVersion[] => [...store.consent_text_version.values()];

/** `select` on one table. Narrow on purpose, like `RpcCaller` beside it. */
export interface TableReader {
  from(table: string): {
    select(columns: string): PromiseLike<{
      data: unknown;
      error: { code?: string | null; message: string } | null;
    }>;
  };
}

/**
 * Every notice this MR's tenant holds.
 *
 * Returned unfiltered and unsorted: `offerableVersions` decides which are still in force
 * and in what order, and it is tested. Doing either here would put the retirement rule in
 * two places.
 *
 * **Throws rather than returning empty.** An empty list and an unreachable server mean
 * completely different things to this screen — `blockedReason` says *"there is no consent
 * notice for this language yet"* for the first and *"the notice could not be loaded"* for
 * the second, and the MR is told to carry on for different reasons. Collapsing them would
 * tell a doctor their company has published nothing when the truth is that the phone could
 * not ask.
 */
export const fetchConsentNotices = async (
  client?: TableReader,
): Promise<readonly ConsentTextVersion[]> => {
  const db = await resolveClient<TableReader>(client);
  const { data, error } = await db
    .from('consent_text_versions')
    // Named columns, not `*`. `organisation_id` is not read, and asking for it would
    // suggest this file has some use for it.
    .select('id,version_label,language,full_text,hash,effective_from,effective_until,created_at');

  if (error !== null) throw new Error(error.message);
  if (!Array.isArray(data)) throw new Error('consent_text_versions did not return a list');
  // Parsed, never cast — one bad row fails loudly rather than reaching a doctor.
  return data.map(fromConsentTextVersionRow);
};

/**
 * The version in force for a language, as the SERVER decides it.
 *
 * `active_consent_text(p_language)` calls `active_consent_text_at(language, now(), org)`,
 * whose `and v.language = p_language` clause MR-16 made falsifiable by adding a second
 * language to the fixtures — and whose `order by effective_from desc` decides which of
 * several live versions is the current one.
 *
 * **The client must not make this choice.** It holds the whole list already and could pick
 * the newest itself, which is exactly the FIX-12 defect: the record would then attest to
 * whichever version the client's list happened to contain rather than the one the server
 * says was in force. `capture_consent` re-resolves it at `captured_at` and refuses with
 * `45001` when the two disagree, so a client that guessed would simply be refused later,
 * in front of a doctor.
 *
 * `null` when the tenant has no live notice in that language — a real answer, not an error.
 */
export const fetchActiveNotice = async (
  language: string,
  client?: RpcCaller,
): Promise<ConsentTextVersion | null> => {
  const db = await resolveClient<RpcCaller>(client);
  const { data, error } = await db.rpc('active_consent_text', { p_language: language });
  if (error !== null) throw new Error(error.message);
  if (data === null || data === undefined) return null;
  // The RPC returns the row itself, or a one-element array depending on how PostgREST
  // renders a table-returning function. Both are handled rather than assumed.
  // `Array.isArray` narrows `unknown` to `any[]`, so the element has to be re-typed as
  // unknown or it arrives as `any` and every check below it becomes decorative.
  const row: unknown = Array.isArray(data) ? (data as readonly unknown[])[0] : data;
  if (row === undefined || row === null) return null;
  return fromConsentTextVersionRow(row);
};
