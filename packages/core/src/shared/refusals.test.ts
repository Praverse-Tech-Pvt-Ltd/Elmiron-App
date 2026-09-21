import { describe, expect, it } from 'vitest';
import { refusalForSqlState } from './refusals.js';

/**
 * MR-48 / `FE-W56`. PostgREST's own codes for a bad sign-in, measured against the local stack:
 * an expired token answers 401 `PGRST303` "JWT expired", a malformed one 401 `PGRST301`. Both
 * are `not_authenticated` — the MR's remedy is to sign in again — and neither is a refusal the
 * app does not recognise.
 */
describe('FE-W56 — an expired sign-in is named as one', () => {
  it.each(['PGRST303', 'PGRST301'])('maps %s to not_authenticated, actionable', (code) => {
    expect(refusalForSqlState(code)).toEqual({
      code: 'not_authenticated',
      sqlState: code,
      actionable: true,
    });
  });

  it('POSITIVE CONTROL: a permission refusal is still a permission refusal', () => {
    expect(refusalForSqlState('42501').code).toBe('not_permitted');
  });

  it('NEGATIVE CONTROL: an unknown PostgREST code is still unrecognised, not swept in', () => {
    expect(refusalForSqlState('PGRST999').code).toBe('unrecognised');
  });
});
