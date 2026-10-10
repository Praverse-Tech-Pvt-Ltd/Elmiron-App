import { refusalForSqlState } from '@fieldforce/core';
import { remedyForSqlState } from '../sync/explanation';

/**
 * What a rep reads when a request failed — one sentence that says what happened and what to do,
 * never a SQLSTATE or a JavaScript error string.
 *
 * Screens used to print `The server refused this request (42501).` and `Network request failed`.
 * Both are true and neither is something a rep can act on; both made the app look broken. The code
 * is still there for support, as a trailing "Reference: 42501." — the part a rep may be asked to
 * read out, and nothing else.
 */

/** Whose problem it is decides the sentence: a wall needs a manager, a session needs a sign-in. */
export const refusedDetail = (sqlState: string | null | undefined): string => {
  const state = sqlState?.trim() ?? '';
  const remedy = remedyForSqlState(state === '' ? null : state);
  if (remedy !== null) return remedy;
  const reference = state === '' ? '' : ` Reference: ${state}.`;
  switch (refusalForSqlState(state).code) {
    case 'not_authenticated':
      return `Your sign-in has expired. Sign out and sign in again from Me.${reference}`;
    case 'not_permitted':
      return `Your account can’t open this. If you think it should, tell your manager.${reference}`;
    default:
      return `This was turned down. If it keeps happening, tell your manager.${reference}`;
  }
};

/** A request that never got an answer, or failed in a way the app cannot name. */
export const failureDetail = (error: unknown): string => {
  const message = error instanceof Error ? error.message : '';
  return /network|fetch|timed? ?out|abort|offline/iu.test(message)
    ? 'No signal, or the server did not answer. Check your connection and try again.'
    : 'Something went wrong on our side. Try again — if it keeps happening, tell your manager.';
};

/** For the rare screen that names the account rather than the request. */
export const NOT_PERMITTED_DETAIL =
  'Your account can’t open this. If you think it should, tell your manager.';
