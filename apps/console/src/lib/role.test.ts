import { describe, expect, it, vi } from 'vitest';

/**
 * `FE-W164` — the caller's role, read from their own profile row. `next/headers` does not exist
 * outside a request, so the session is mocked; what is asserted is the read and its fallbacks.
 */
const signedIn = vi.fn();
vi.mock('./session', () => ({ signedIn }));

const { callerRole, roleOf } = await import('./role');

/** A stand-in for `session.db` that records the read it was asked for. */
const fakeDb = (answer: { data: unknown; error: unknown }) => {
  const calls: unknown[][] = [];
  const chain = {
    from: (...args: unknown[]) => (calls.push(['from', ...args]), chain),
    select: (...args: unknown[]) => (calls.push(['select', ...args]), chain),
    eq: (...args: unknown[]) => (calls.push(['eq', ...args]), chain),
    maybeSingle: () => Promise.resolve(answer),
  };
  return { db: chain, calls };
};

describe('FE-W164 — roleOf', () => {
  it('reads the role from the caller’s own profile row', async () => {
    const { db, calls } = fakeDb({ data: { role: 'field_manager' }, error: null });
    await expect(roleOf({ db: db as never, userId: 'u-1' })).resolves.toBe('field_manager');
    expect(calls).toEqual([
      ['from', 'user_profiles'],
      ['select', 'role'],
      ['eq', 'id', 'u-1'],
    ]);
  });

  it('is unknown (null) when the row is missing, unreadable or holds something else', async () => {
    for (const answer of [
      { data: null, error: null },
      { data: null, error: { message: 'permission denied' } },
      { data: { role: 'superuser' }, error: null },
    ]) {
      const { db } = fakeDb(answer);
      await expect(roleOf({ db: db as never, userId: 'u-1' })).resolves.toBeNull();
    }
  });
});

describe('FE-W164 — callerRole', () => {
  it('is null with nobody signed in, and reads the role of whoever is', async () => {
    signedIn.mockResolvedValueOnce(null);
    await expect(callerRole()).resolves.toBeNull();

    const { db } = fakeDb({ data: { role: 'admin' }, error: null });
    signedIn.mockResolvedValueOnce({ db, userId: 'u-2' });
    await expect(callerRole()).resolves.toBe('admin');
  });
});
