import { cache } from 'react';
import { signedIn } from './session';
import type { SignedIn } from './session';
import { asConsoleRole } from './nav-items';
import type { ConsoleRole } from './nav-items';

/**
 * `FE-W164` — the signed-in user's role, read on the server for this request.
 *
 * **Read the way the pages already read it**: `user_profiles.role` for the caller's own row, as the
 * caller, under RLS (`/planning/access` and `/practice-feedback` did exactly this before). Not the
 * JWT's `app_role` claim: that is fixed until the token refreshes, so an admin who has just changed
 * someone's role would see the old navigation for up to an hour, while this read sees the change.
 *
 * **What it decides is presentation only** — which entries the sidebar offers, the word beside the
 * brand mark, and whether a page draws a form the database would refuse. It decides nothing about
 * access: every read and write still goes to the database as the signed-in user, and the policies
 * there are the boundary.
 */
export const roleOf = async (
  session: Pick<SignedIn, 'db' | 'userId'>,
): Promise<ConsoleRole | null> => {
  const { data, error } = await session.db
    .from('user_profiles')
    .select('role')
    .eq('id', session.userId)
    .maybeSingle();
  if (error !== null || data === null) return null;
  return asConsoleRole((data as { role?: unknown }).role);
};

/**
 * The role for THIS request, read once: the layout (for the sidebar) and the page (for its forms)
 * both ask, and React's `cache` makes the second ask free. `null` when nobody is signed in or the
 * read failed — which callers treat as "unknown", never as a refusal.
 */
export const callerRole = cache(async (): Promise<ConsoleRole | null> => {
  const session = await signedIn();
  return session === null ? null : roleOf(session);
});
