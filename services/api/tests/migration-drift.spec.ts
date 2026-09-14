import { describe, expect, it } from 'vitest';
import { compareMigrations, versionsFromFilenames } from '../scripts/check-migration-drift.mjs';

/**
 * `BE-W40` — the two directions a hand-run `supabase db push` shows up in.
 *
 * The comparator is pure so both failures can be asserted without arranging a real
 * divergence against a real database. The end-to-end behaviour was exercised separately in
 * MR-32 C2 against the local stack, in both directions, with a clean baseline before and
 * after — a check that reports drift on a clean database would be worse than none.
 */
describe('BE-W40 — migration drift', () => {
  it('is clean when the applied set matches the files exactly', () => {
    const result = compareMigrations(
      ['20260101000000', '20260102000000'],
      ['20260101000000', '20260102000000'],
    );
    expect(result.drifted).toBe(false);
    expect(result.appliedWithoutFile).toEqual([]);
    expect(result.fileNotApplied).toEqual([]);
  });

  it('catches a version APPLIED with no file here — a hand-run push', () => {
    const result = compareMigrations(['20260101000000'], ['20260101000000', '20260199000000']);
    expect(result.drifted).toBe(true);
    expect(result.appliedWithoutFile).toEqual(['20260199000000']);
    expect(result.fileNotApplied).toEqual([]);
  });

  it('catches a file that was NEVER applied — the quiet direction', () => {
    // This one looks like nothing at all until a query hits a column that does not exist.
    const result = compareMigrations(['20260101000000', '20260199000000'], ['20260101000000']);
    expect(result.drifted).toBe(true);
    expect(result.fileNotApplied).toEqual(['20260199000000']);
    expect(result.appliedWithoutFile).toEqual([]);
  });

  it('reports BOTH directions at once rather than stopping at the first', () => {
    // A deploy that applied one thing and missed another is one incident, and an operator
    // who fixes only the half they were shown will run the check again and be surprised.
    const result = compareMigrations(
      ['20260101000000', '20260103000000'],
      ['20260101000000', '20260102000000'],
    );
    expect(result.appliedWithoutFile).toEqual(['20260102000000']);
    expect(result.fileNotApplied).toEqual(['20260103000000']);
  });

  it('reads the version off a filename and ignores anything that is not a migration', () => {
    expect(
      versionsFromFilenames([
        '20260101000000_first.sql',
        '20260102000000_second_with_underscores.sql',
        'README.md',
        '.gitkeep',
        'not_a_migration.sql',
      ]),
    ).toEqual(['20260101000000', '20260102000000']);
  });

  it('sorts, so a directory listing order cannot change the answer', () => {
    expect(
      versionsFromFilenames([
        '20260103000000_c.sql',
        '20260101000000_a.sql',
        '20260102000000_b.sql',
      ]),
    ).toEqual(['20260101000000', '20260102000000', '20260103000000']);
  });
});
