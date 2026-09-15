import { describe, expect, it } from 'vitest';
import {
  classifyShortfall,
  compareMigrations,
  evaluatePreconditions,
  versionsFromFilenames,
} from '../scripts/check-migration-drift.mjs';

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

/**
 * MR-35 C1/C2 — the check's own preconditions.
 *
 * MR-34 measured a database with `public tables = 0` and `schema_migrations rows = 56` after a
 * full `verify:rollbacks`, and this check reported **no drift** against it. The ledger and the
 * files agreed perfectly; they were agreeing about a database that no longer existed.
 *
 * Every guard in this repository is held to asserting its own preconditions — `verify:rollbacks`
 * refuses a non-localhost URL, `check:decision-debt` fails closed on an unreadable status. This
 * is the same rule applied to the one guard that was answering "healthy" from a claim rather
 * than from the database.
 */
describe('BE-W40 — the drift check asserts its own preconditions', () => {
  it('refuses to report on a database the rollbacks emptied', () => {
    // The exact state MR-34 produced and measured.
    const result = evaluatePreconditions({
      migrationFileCount: 56,
      appliedCount: 56,
      publicTableCount: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/NO TABLES/u);
  });

  it('passes on a healthy database, so the refusal above is not just always-on', () => {
    // The positive control. Without this, a function that returned `ok: false` unconditionally
    // would satisfy every other assertion in this block.
    expect(
      evaluatePreconditions({ migrationFileCount: 56, appliedCount: 56, publicTableCount: 36 }).ok,
    ).toBe(true);
  });

  it('passes on a genuinely fresh database — empty ledger AND empty schema', () => {
    // Nothing applied and nothing there is consistent, and drift should go on to report all
    // files as unapplied. Refusing here would make the check unusable on a new database.
    expect(
      evaluatePreconditions({ migrationFileCount: 56, appliedCount: 0, publicTableCount: 0 }).ok,
    ).toBe(true);
  });

  it('refuses when a schema exists that no ledger explains', () => {
    const result = evaluatePreconditions({
      migrationFileCount: 56,
      appliedCount: 0,
      publicTableCount: 36,
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/outside the migration path/u);
  });

  it('refuses when it read no migration files at all — that is this check, not the database', () => {
    const result = evaluatePreconditions({
      migrationFileCount: 0,
      appliedCount: 56,
      publicTableCount: 36,
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/wrong working directory/u);
  });
});

/**
 * MR-35 C1/C2 — 17-of-37 distinguished from 56-of-56 by SHAPE, not by count.
 *
 * MR-34's failed push left the first 17 of 37 applied, and the resulting database had 36 tables
 * and `rls_forced = 36` — identical to a complete one. No structural count separates them. The
 * version SET does, and the shape of the gap says which of two very different things happened.
 */
describe('BE-W40 — how the applied set falls short', () => {
  const files = ['1', '2', '3', '4', '5'];

  it('calls a complete application complete', () => {
    expect(classifyShortfall(files, files)).toBe('complete');
  });

  it('calls a deploy that stopped part-way a partial prefix', () => {
    // The MR-34 shape: applied in order, stopped. `db push` resumes from here.
    expect(classifyShortfall(files, ['1', '2', '3'])).toBe('partial-prefix');
  });

  it('distinguishes cherry-picked versions from a deploy that stopped', () => {
    // Same COUNT as the partial prefix above — three of five — and a different situation:
    // somebody applied versions out of band, so the repository is not the record of this
    // database. A count cannot tell these apart; this is the assertion that they are not.
    expect(classifyShortfall(files, ['1', '3', '5'])).toBe('interleaved');
    expect(classifyShortfall(files, ['1', '3', '5'])).not.toBe(
      classifyShortfall(files, ['1', '2', '3']),
    );
  });

  it('names a version the database has that this repository does not', () => {
    expect(classifyShortfall(files, ['1', '2', '99'])).toBe('foreign-versions');
  });
});
