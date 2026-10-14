import { refusalForSqlState } from '@fieldforce/core';
import { t } from '@fieldforce/ui/i18n';
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
  const reference = state === '' ? '' : ` ${t('errors.reference', { code: state })}`;
  switch (refusalForSqlState(state).code) {
    case 'not_authenticated':
      return `${t('errors.signInExpired')}${reference}`;
    case 'not_permitted':
      return `${t('errors.notPermitted')}${reference}`;
    default:
      return `${t('errors.turnedDown')}${reference}`;
  }
};

/** A request that never got an answer, or failed in a way the app cannot name. */
export const failureDetail = (error: unknown): string => {
  const message = error instanceof Error ? error.message : '';
  return /network|fetch|timed? ?out|abort|offline/iu.test(message)
    ? t('errors.noSignal')
    : t('errors.ourSide');
};

/** For the rare screen that names the account rather than the request. */
export const notPermittedDetail = (): string => t('errors.notPermitted');
