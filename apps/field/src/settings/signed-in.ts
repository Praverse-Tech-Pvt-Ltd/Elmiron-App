/**
 * `FE-W192` — who is signed in, as the rep would recognise it, for the line under Me's title.
 *
 * These are SHARED handsets: Me is where a phone changes hands, and it said nothing about whose
 * account was open. The name is the one the company gave the account (`full_name` in the account's
 * metadata, when it was set), then the email address the rep signs in with. The territory is not
 * shown: the token carries only its id, and an id is not something a rep can recognise.
 */
export interface SignedInUser {
  readonly email?: string | null;
  readonly user_metadata?: Readonly<Record<string, unknown>> | null;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** "Asha Patil · asha@company.in", the email alone, or null when the session names nobody. */
export const signedInWho = (user: SignedInUser | null | undefined): string | null => {
  if (user === null || user === undefined) return null;
  const name = text(user.user_metadata?.['full_name']) || text(user.user_metadata?.['name']);
  const email = text(user.email);
  const parts = [name, email].filter((part) => part !== '');
  return parts.length === 0 ? null : parts.join(' · ');
};
