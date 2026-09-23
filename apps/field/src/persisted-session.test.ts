import { describe, expect, it } from 'vitest';
import { SESSION_STORAGE_KEY, readPersistedSession } from './persisted-session';
import type { SessionStorage } from './persisted-session';

/**
 * MR-52 B2 — `FE-W67`: offline is not signed out, and a rejected session still is.
 *
 * The two cases are told apart by what `supabase-js` LEFT IN STORAGE, which is the library's own
 * decision: it keeps the entry when a refresh fails for a network reason and removes it when the
 * refresh token itself is refused. This module only reads that.
 */
const stored = (value: string | null): SessionStorage => ({
  getItem: (key) => Promise.resolve(key === SESSION_STORAGE_KEY ? value : null),
});

const session = {
  access_token: 'an.expired.token',
  refresh_token: 'still-good',
  expires_at: 1_700_000_000,
  user: { id: '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a01', email: 'rep@example.test' },
};

describe('MR-52 B2 — the session the library persisted', () => {
  it('restores a rep whose token expired while they were offline', async () => {
    const restored = await readPersistedSession(stored(JSON.stringify(session)));
    expect(restored?.user.id).toBe(session.user.id);
    expect(restored?.refresh_token).toBe('still-good');
  });

  it('restores it from the wrapped shape some storage adapters write', async () => {
    const restored = await readPersistedSession(stored(JSON.stringify({ session })));
    expect(restored?.user.id).toBe(session.user.id);
  });

  it('B3: a session the SERVER rejected is gone from storage, so nobody is restored', async () => {
    // Not a special case in this module, and that is the point: a non-retryable refusal makes the
    // library remove the entry, and an absent entry is the sign-in screen.
    expect(await readPersistedSession(stored(null))).toBeNull();
  });

  it('refuses a session with no refresh token — it could never come back', async () => {
    const { refresh_token: _dropped, ...withoutRefresh } = session;
    expect(await readPersistedSession(stored(JSON.stringify(withoutRefresh)))).toBeNull();
  });

  it('refuses half-written or foreign entries rather than trusting them into shape', async () => {
    for (const raw of ['', '{', 'null', '[]', '{"user":{"id":""}}', JSON.stringify({ user: {} })]) {
      expect(await readPersistedSession(stored(raw)), raw).toBeNull();
    }
  });

  it('a storage that throws is a session this app does not have', async () => {
    const throwing: SessionStorage = {
      getItem: () => Promise.reject(new Error('keychain locked')),
    };
    await expect(readPersistedSession(throwing)).resolves.toBeNull();
  });

  it('reads the key the client actually writes, not a guessed one', async () => {
    const seen: string[] = [];
    await readPersistedSession({
      getItem: (key) => {
        seen.push(key);
        return Promise.resolve(null);
      },
    });
    expect(seen).toEqual([SESSION_STORAGE_KEY]);
  });
});
