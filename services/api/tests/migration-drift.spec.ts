import { describe, expect, it } from 'vitest';
import {
  classifyRun,
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

/**
 * MR-42 C1/C2 — the three states, and the control that makes the green one trustworthy.
 *
 * The job was red on every commit, reporting that production has applied 19 of 60 migrations
 * because the schema is not deployed. **A red that is correct every day is indistinguishable
 * from a red that is broken**, so the known state is now green-with-a-notice and only the two
 * genuine failures are red.
 *
 * **C2 is the reason this file matters more than the workflow change.** Accepting a state is
 * only safe if the acceptance cannot swallow a real finding, so the controls below are not
 * decoration: each asserts that something which LOOKS similar is still refused.
 */
/** A drifted result with nothing applied out of band — the clean trailing-shortfall shape. */
const clean = { drifted: true, appliedWithoutFile: [] as readonly string[] };

describe('MR-42 C1 — three states, not two', () => {
  it('is green for the known pre-deploy state before the date', () => {
    expect(
      classifyRun({
        result: clean,
        shortfall: 'partial-prefix',
        today: '2026-09-17',
        acceptUntil: '2026-10-31',
      }),
    ).toBe('accepted-not-deployed');
  });

  it('is red once the acceptance date has passed, and says the deferral lapsed', () => {
    expect(
      classifyRun({
        result: clean,
        shortfall: 'partial-prefix',
        today: '2026-11-01',
        acceptUntil: '2026-10-31',
      }),
    ).toBe('deferral-expired');
  });

  it('is green when there is no drift at all', () => {
    expect(
      classifyRun({
        result: { drifted: false, appliedWithoutFile: [] },
        shortfall: 'complete',
        today: '2026-09-17',
        acceptUntil: '2026-10-31',
      }),
    ).toBe('no-drift');
  });
});

describe('MR-42 C2 — the accepted state is distinguishable from a real finding', () => {
  it('REFUSES a version applied with no file here, on the very same day', () => {
    // The control that matters. Same date, same trailing-shortfall shape, one difference:
    // something was applied out of band. If acceptance swallowed this, the check would be
    // certifying the exact thing it exists to catch -- a hand-run `supabase db push`.
    expect(
      classifyRun({
        result: { drifted: true, appliedWithoutFile: ['20260899000100'] },
        shortfall: 'partial-prefix',
        today: '2026-09-17',
        acceptUntil: '2026-10-31',
      }),
    ).toBe('real-drift');
  });

  it('REFUSES an interleaved gap, which is not a deploy that stopped', () => {
    expect(
      classifyRun({
        result: clean,
        shortfall: 'interleaved',
        today: '2026-09-17',
        acceptUntil: '2026-10-31',
      }),
    ).toBe('real-drift');
  });

  it('REFUSES foreign versions', () => {
    expect(
      classifyRun({
        result: clean,
        shortfall: 'foreign-versions',
        today: '2026-09-17',
        acceptUntil: '2026-10-31',
      }),
    ).toBe('real-drift');
  });

  it('accepts NOTHING when no acceptance was granted', () => {
    // Removing the flag from the workflow must restore the old behaviour exactly, so that
    // the acceptance is opt-in rather than the default.
    expect(
      classifyRun({
        result: clean,
        shortfall: 'partial-prefix',
        today: '2026-09-17',
        acceptUntil: null,
      }),
    ).toBe('real-drift');
  });
});
