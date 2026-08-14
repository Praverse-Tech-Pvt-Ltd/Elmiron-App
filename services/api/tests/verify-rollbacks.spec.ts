import { describe, expect, it } from 'vitest';
import { assertLocalhostOnly } from '../scripts/verify-rollbacks.mjs';

/**
 * BE-W8 — `verify:rollbacks` drops the entire public schema. `handover.md` documented
 * the remote-URL hazard three times and every mitigation was a rule for a human to
 * follow. This proves the refusal fires in code, without a real remote database.
 */

describe('assertLocalhostOnly', () => {
  it.each([
    ['127.0.0.1', 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'],
    ['::1', 'postgresql://postgres:postgres@[::1]:54322/postgres'],
    ['localhost', 'postgresql://postgres:postgres@localhost:54322/postgres'],
  ])('allows %s', (_host, dbUrl) => {
    expect(() => {
      assertLocalhostOnly(dbUrl);
    }).not.toThrow();
  });

  it('refuses a remote-looking host', () => {
    expect(() => {
      assertLocalhostOnly('postgresql://postgres:secret@db.abcxyzprod.supabase.co:5432/postgres');
    }).toThrow(/refuses to run against host "db\.abcxyzprod\.supabase\.co"/);
  });

  it('refuses a pooler host', () => {
    expect(() => {
      assertLocalhostOnly(
        'postgresql://postgres.abcxyz:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres',
      );
    }).toThrow(/refuses to run against host/);
  });

  it('refuses an unparseable URL rather than defaulting anywhere', () => {
    expect(() => {
      assertLocalhostOnly('not-a-url');
    }).toThrow(/could not parse database URL/);
  });
});
