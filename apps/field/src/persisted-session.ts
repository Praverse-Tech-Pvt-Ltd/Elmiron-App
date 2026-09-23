import type { Session } from '@supabase/supabase-js';

/**
 * MR-52 B2 — `FE-W67`: being offline must not sign a rep out.
 *
 * **What happens without this.** `supabase-js` keeps the session in storage and refreshes the access
 * token a margin (90 seconds) before it expires. Offline the refresh fails with a network error,
 * which the library treats as RETRYABLE: it keeps the session in storage — but `getSession()` still
 * answers `{ session: null }`, because the access token has expired. `session.tsx` read that null and
 * showed the sign-in screen. So the rep's credentials were on the device the whole time, and the app
 * said they were signed out — measured on the emulator, about an hour offline, at the next cold
 * start (MR-52 B1).
 *
 * **What this does.** When the library answers null, ask storage whether a session is still there.
 * If it is, the rep is signed in with a stale token: every screen keeps working from the pulled
 * store, every write queues, and `autoRefreshToken` renews the moment there is signal.
 *
 * **Why this is not re-deriving a server rule.** It decides nothing about permission. An expired
 * token is refused by the server exactly as before; what changes is only whether the DEVICE throws
 * away credentials it still holds. And the distinction between "cannot reach the server" and "the
 * server rejected this session" is the library's, not ours: on a non-retryable refusal — a revoked
 * or expired refresh token — `_callRefreshToken` REMOVES the session from storage, so this read
 * finds nothing and the rep is signed out, with the signal, as `FE-W56` requires (MR-52 B3).
 */
export const SESSION_STORAGE_KEY = 'fieldforce.auth.v1';

/** The narrow slice of AsyncStorage this needs, so the rule is testable without a device. */
export interface SessionStorage {
  getItem: (key: string) => Promise<string | null>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * The session `supabase-js` persisted, or null.
 *
 * Parsed defensively and never trusted into shape: a half-written or older entry yields null, which
 * means the sign-in screen — the same outcome as no session at all, and the safe direction.
 */
export const readPersistedSession = async (storage: SessionStorage): Promise<Session | null> => {
  let raw: string | null = null;
  try {
    raw = await storage.getItem(SESSION_STORAGE_KEY);
  } catch {
    // A storage that cannot be read is a session this app does not have.
    return null;
  }
  if (raw === null || raw === '') return null;

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  // `supabase-js` may wrap the session, depending on the storage adapter in use.
  const candidate = isRecord(parsed) && isRecord(parsed['session']) ? parsed['session'] : parsed;
  if (!isRecord(candidate)) return null;

  const { access_token: accessToken, refresh_token: refreshToken, user } = candidate;
  // A session with no refresh token can never come back, so it is not one worth restoring.
  if (typeof accessToken !== 'string' || accessToken === '') return null;
  if (typeof refreshToken !== 'string' || refreshToken === '') return null;
  if (!isRecord(user) || typeof user['id'] !== 'string' || user['id'] === '') return null;

  return candidate as unknown as Session;
};
