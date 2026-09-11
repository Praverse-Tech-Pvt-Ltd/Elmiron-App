import type { PulledConsentTextVersion } from '@fieldforce/core';

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
  readonly consent_text_version: ReadonlyMap<string, PulledConsentTextVersion>;
}): readonly PulledConsentTextVersion[] => [...store.consent_text_version.values()];
