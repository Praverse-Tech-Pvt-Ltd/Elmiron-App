import { t } from '@fieldforce/ui/i18n';
import { failureDetail } from './plain';

/**
 * `FE-W186` — what a rep reads when sign-in is refused: one of our own sentences, never the auth
 * server's string.
 *
 * Sign-in used to print the server's message as it came — "Invalid login credentials" on the
 * emulator — on the reasoning that a friendlier sentence turns a specific failure into "something
 * went wrong". That reasoning holds, and it is kept: each failure the auth server NAMES gets its
 * own specific sentence here, so "wrong password" still says wrong password. What changes is that
 * the words are the app's, in plain English and on the catalogue for the translators, rather than
 * an English server string shown under a Hindi screen.
 *
 * Matched on the error's `code` first (the auth server's stable identifier, e.g.
 * `invalid_credentials`), then on the message for an older server that sends none. Anything not
 * recognised is a plain sentence with the HTTP status as a reference for support, as `plain.ts`
 * does with a SQLSTATE — never the server's own text.
 */
type Known = 'wrongDetails' | 'notConfirmed' | 'tooMany' | 'switchedOff';

const BY_CODE: Readonly<Record<string, Known>> = {
  invalid_credentials: 'wrongDetails',
  user_not_found: 'wrongDetails',
  email_not_confirmed: 'notConfirmed',
  over_request_rate_limit: 'tooMany',
  over_email_send_rate_limit: 'tooMany',
  user_banned: 'switchedOff',
};

const BY_MESSAGE: readonly (readonly [RegExp, Known])[] = [
  [/invalid login credentials|invalid (email|password)/iu, 'wrongDetails'],
  [/email not confirmed/iu, 'notConfirmed'],
  [/rate limit|too many/iu, 'tooMany'],
  [/banned/iu, 'switchedOff'],
];

const SENTENCE = {
  wrongDetails: 'signIn.wrongDetails',
  notConfirmed: 'signIn.notConfirmed',
  tooMany: 'signIn.tooMany',
  switchedOff: 'signIn.switchedOff',
} as const;

const field = (error: unknown, name: string): unknown =>
  typeof error === 'object' && error !== null
    ? (error as Record<string, unknown>)[name]
    : undefined;

export const signInFailure = (error: unknown): string => {
  const code = field(error, 'code');
  const message = error instanceof Error ? error.message : '';
  const known =
    (typeof code === 'string' ? BY_CODE[code] : undefined) ??
    BY_MESSAGE.find(([pattern]) => pattern.test(message))?.[1];
  if (known !== undefined) return t(SENTENCE[known]);

  // No answer at all — no signal, or the server did not reply — is said as that.
  const status = field(error, 'status');
  if (/network|fetch|timed? ?out|abort|offline/iu.test(message) || status === 0) {
    return failureDetail(new Error('network'));
  }
  const reference =
    typeof status === 'number' && status >= 400
      ? ` ${t('errors.reference', { code: status })}`
      : '';
  return `${t('signIn.otherProblem')}${reference}`;
};
