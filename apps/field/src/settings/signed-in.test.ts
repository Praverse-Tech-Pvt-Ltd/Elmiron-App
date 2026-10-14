import { describe, expect, it } from 'vitest';
import { signedInWho } from './signed-in';

/** `FE-W192`. Me says whose account is open on a shared phone. */
describe('signedInWho', () => {
  it('names the account and its email', () => {
    expect(
      signedInWho({ email: 'asha@example.in', user_metadata: { full_name: 'Asha Patil' } }),
    ).toBe('Asha Patil · asha@example.in');
  });

  it('falls back to the email alone when the account has no name', () => {
    expect(signedInWho({ email: 'asha@example.in', user_metadata: {} })).toBe('asha@example.in');
  });

  it('says nothing when the session names nobody', () => {
    expect(signedInWho(null)).toBeNull();
    expect(signedInWho({ email: '  ', user_metadata: { full_name: 3 } })).toBeNull();
  });
});
