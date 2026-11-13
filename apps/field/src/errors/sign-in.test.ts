import { describe, expect, it } from 'vitest';
import { signInFailure } from './sign-in';

/** A stand-in for the auth library's error: an Error with the server's `code` and `status`. */
const authError = (message: string, code?: string, status?: number): Error =>
  Object.assign(new Error(message), { code, status });

/**
 * `FE-W186`. Sign-in showed the auth server's own string, "Invalid login credentials". Each failure
 * the server names gets the app's own specific sentence; nothing the server wrote reaches the rep.
 */
describe('signInFailure', () => {
  it('a wrong email or password says so, by code or by the older message', () => {
    expect(signInFailure(authError('Invalid login credentials', 'invalid_credentials', 400))).toBe(
      'That email and password don’t match. Check them and try again.',
    );
    expect(signInFailure(authError('Invalid login credentials'))).toMatch(
      /^That email and password/u,
    );
  });

  it('names an unconfirmed account, too many tries and a switched-off account', () => {
    expect(signInFailure(authError('Email not confirmed', 'email_not_confirmed', 400))).toMatch(
      /not been set up/u,
    );
    expect(
      signInFailure(authError('Request rate limit reached', 'over_request_rate_limit', 429)),
    ).toMatch(/^Too many tries/u);
    expect(signInFailure(authError('User is banned', 'user_banned', 400))).toMatch(/switched off/u);
  });

  it('no signal reads as no signal', () => {
    expect(signInFailure(new TypeError('Network request failed'))).toMatch(/^No signal/u);
    expect(signInFailure(authError('Failed to fetch', undefined, 0))).toMatch(/^No signal/u);
  });

  it('anything else is a plain sentence with the status as a reference, never the server text', () => {
    const text = signInFailure(
      authError('Database error querying schema', 'unexpected_failure', 500),
    );
    expect(text).toMatch(/^Sign-in did not go through/u);
    expect(text.endsWith('Reference: 500.')).toBe(true);
    expect(text).not.toMatch(/Database|schema|unexpected_failure/u);
    expect(signInFailure('nope')).not.toMatch(/Reference/u);
  });
});
