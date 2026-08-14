import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '../scripts/reconcile-after-restore.mjs';

/**
 * BE-W8 §1.2 — `reconcile:restore --apply` deletes storage objects and writes
 * permanent `audit_log` rows, so its target must be named on the command line
 * rather than inherited from `SUPABASE_DB_URL`. This proves the refusal without a
 * real restore.
 */

describe('parseCliArgs', () => {
  it('refuses --apply without --db-url', () => {
    expect(() => {
      parseCliArgs(['--apply']);
    }).toThrow(/refuses to run without --db-url/);
  });

  it('refuses --apply with an empty --db-url', () => {
    expect(() => {
      parseCliArgs(['--apply', '--db-url', '']);
    }).toThrow(/refuses to run without --db-url/);
  });

  it('allows --apply with --db-url given explicitly', () => {
    const args = parseCliArgs(['--apply', '--db-url', 'postgresql://user:pass@pooler/postgres']);
    expect(args).toEqual({
      apply: true,
      dbUrl: 'postgresql://user:pass@pooler/postgres',
      note: null,
    });
  });

  it('allows a dry run with no --db-url, falling back to the environment', () => {
    const args = parseCliArgs([]);
    expect(args).toEqual({ apply: false, dbUrl: undefined, note: null });
  });

  it('carries --note through in both modes', () => {
    expect(parseCliArgs(['--note', 'PITR to 14 Aug']).note).toBe('PITR to 14 Aug');
    expect(
      parseCliArgs(['--apply', '--db-url', 'postgresql://x', '--note', 'PITR to 14 Aug']).note,
    ).toBe('PITR to 14 Aug');
  });
});
