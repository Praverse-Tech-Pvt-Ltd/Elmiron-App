import { fromConsentTextVersionRow } from '@fieldforce/core';
import type { ConsentTextVersion } from '@fieldforce/core';

/** The shape of the one call this needs, so the reader is testable without Supabase. */
export interface TableReader {
  from: (table: string) => {
    select: (columns: string) => {
      order: (
        column: string,
        options: { ascending: boolean },
      ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
    };
  };
}

/**
 * MR-52 A2 — the consent notices, read from the table rather than an RPC.
 *
 * **Why this one is different from the other three reads.** `consent_text_versions` is one of the
 * seven tables that carry a tenant, with SELECT for `authenticated` behind a RESTRICTIVE
 * organisation boundary (`20260908001300`) — so a signed-in admin reading it directly gets their own
 * organisation's rows and nothing else, decided by the server. There is no RPC to add and no
 * scoping for this client to do; PostgREST returns the table's own column names, which
 * `fromConsentTextVersionRow` (MR-23 B1) already maps to the contract.
 *
 * A row that does not fit the contract throws rather than being dropped: this list is what an
 * auditor reads to see which notice was live when, and a silently shortened one is worse than none.
 */
export const consentTextVersions = async (db: TableReader): Promise<ConsentTextVersion[]> => {
  const { data, error } = await db
    .from('consent_text_versions')
    .select('id,version_label,language,full_text,hash,effective_from,effective_until,created_at')
    .order('effective_from', { ascending: false });
  if (error !== null) throw new Error(error.message);
  return (data ?? []).map(fromConsentTextVersionRow);
};
