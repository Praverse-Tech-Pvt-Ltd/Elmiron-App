import { describe, expect, it } from 'vitest';
import * as field from './index.js';

/**
 * A hard expiry on the `TranscriptV0` placeholder.
 *
 * BE-W6 published `TranscriptV0` so that the week-8 storage layer could be designed
 * against something, and flagged the obvious risk in its own review: publishing it
 * removes the most visible symptom of a late contract, and a placeholder that works
 * is a placeholder that stays. A header comment saying "this is temporary" does not
 * stop that. Nothing does, except a build that goes red.
 *
 * So this fails on a fixed date unless a real `TranscriptV1` exists.
 *
 * A CI break on a date is a blunt instrument, and that is the point — it is the only
 * mechanism that survives everybody forgetting. Extending it is deliberately a
 * one-line change that shows up in a diff with somebody's name on it, which is the
 * difference between a decision and a drift.
 */

// ─────────────────────────────────────────────────────────────────────────────
// TO EXTEND THIS DEADLINE: change the date on the next line, and say in the
// commit message who agreed to the new one. That is the whole mechanism.
// ─────────────────────────────────────────────────────────────────────────────
const CONTRACT_I3_DEADLINE = new Date('2026-09-30T23:59:59+05:30');

/**
 * **MR-38 A1. Twenty-one days, and the number is not a coincidence.**
 *
 * `BE-W21` gave the UCPMP cap decision a warning window and wrote the reasoning into
 * `20260907001000_ucpmp_cap_decision_warning.sql`: *"a warning arriving three weeks earlier is
 * treated as a question"*, where a red build on the day *"is treated as an obstacle to get
 * past"*. It uses `warn_days := 21` and the warning deliberately does **not** fail the build.
 *
 * This deadline had two states where that one has three, in the same repository, for the same
 * class of problem. Now it has three.
 */
const WARN_DAYS = 21;

/**
 * `clear` | `warn` | `overdue`, from the same inputs `ucpmp_cap_decision_status()` computes.
 *
 * Pure and exported so all three states are asserted at fixed dates rather than waiting for a
 * calendar. That is the same technique `decision-debt.spec.ts` uses on the UCPMP side — it
 * backdates a row instead of waiting for November.
 *
 * **Why this lives here and not in `check:decision-debt`.** That script is the obvious place to
 * reuse, and `FIX-08 B2` forbids it: `scripts-convention.spec.ts` fails the build if anything in
 * `services/api/scripts/` imports `packages/core`, because no workflow builds workspace
 * dependencies before running those scripts directly. The fact this turns on — whether
 * `TranscriptV1Schema` is really exported — is a runtime property of this package. Checking it
 * here reads the actual export; checking it there would have meant grepping source for a symbol.
 */
export const contractDeadlineState = (input: {
  readonly now: Date;
  readonly deadline: Date;
  readonly hasV1: boolean;
  readonly warnDays: number;
}): 'clear' | 'warn' | 'overdue' => {
  if (input.hasV1) return 'clear';
  if (input.now.getTime() > input.deadline.getTime()) return 'overdue';
  const warnFrom = input.deadline.getTime() - input.warnDays * 24 * 60 * 60 * 1000;
  return input.now.getTime() >= warnFrom ? 'warn' : 'clear';
};

const OWNER = [
  'CONTRACT I3 — the transcript schema — IS OWNED BY AI/ML AND IS PAST DUE.',
  '',
  'It was due at the end of week 2. Backend published `TranscriptV0` in week 6 as a',
  'placeholder so the storage layer could be designed against something; it does not',
  'close I3. AI/ML still owes the measured word error rate on real Hinglish MR-doctor',
  'audio, and the vendor decision that follows from it. Those are what decide whether',
  'the AI layer ships at all.',
  '',
  'This test fails because the deadline for replacing the placeholder has passed and',
  'no `TranscriptV1Schema` is exported from @fieldforce/core/field.',
  '',
  'There are exactly two honest ways to make it pass:',
  '  1. Publish TranscriptV1 alongside V0, so consumers migrate deliberately.',
  '  2. Move CONTRACT_I3_DEADLINE in packages/core/src/field/transcript-v0.expiry.test.ts,',
  '     and put the person who agreed the new date in the commit message.',
  '',
  'Deleting this test is a third way and it is not one of the honest ones.',
].join('\n');

describe('TranscriptV0 is a placeholder with a deadline', () => {
  it('fails once the deadline passes unless TranscriptV1 exists', () => {
    const hasV1 = 'TranscriptV1Schema' in field;
    const state = contractDeadlineState({
      now: new Date(),
      deadline: CONTRACT_I3_DEADLINE,
      hasV1,
      warnDays: WARN_DAYS,
    });

    if (state === 'warn') {
      const days = Math.ceil((CONTRACT_I3_DEADLINE.getTime() - Date.now()) / 86_400_000);
      // `::warning::` is a GitHub Actions annotation, so this reaches the run summary rather
      // than only a log nobody opens on a green build. Same surface `check:decision-debt` uses
      // for the UCPMP cap -- the mechanism is reused, not rebuilt.
      console.log(
        `::warning title=Decision due::CONTRACT I3 -- the transcript schema -- is due on ` +
          `2026-09-30 (${String(days)} day(s) left). After that this test fails the build. ` +
          `See docs/blocked-on-you.md.`,
      );
    }

    // Written as a single assertion carrying the whole message, because a bare
    // `expect(false).toBe(true)` tells whoever hits this nothing about why.
    expect(state !== 'overdue', OWNER).toBe(true);
  });

  it('still exports the placeholder it is guarding, so this cannot pass vacuously', () => {
    // If TranscriptV0 were renamed or removed, the test above would keep passing
    // while guarding nothing at all.
    expect('TranscriptV0Schema' in field).toBe(true);
  });

  it('names a deadline that is a real date', () => {
    expect(Number.isNaN(CONTRACT_I3_DEADLINE.getTime())).toBe(false);
  });

  it('is WARNING right now, which is the whole point of adding the state', () => {
    // Not a tautology: it asserts the window is wide enough to already be open. If WARN_DAYS
    // were shortened to something that leaves today outside it, this fails and says so.
    const state = contractDeadlineState({
      now: new Date(),
      deadline: CONTRACT_I3_DEADLINE,
      hasV1: 'TranscriptV1Schema' in field,
      warnDays: WARN_DAYS,
    });
    expect(state).toBe('warn');
  });
});

/**
 * MR-38 A1 — the three states, at fixed dates.
 *
 * Nothing here depends on today. `decision-debt.spec.ts` exercises the UCPMP side by backdating
 * a row rather than waiting for November; this does the same by passing `now` in, which is why
 * the evaluator takes it as an argument instead of calling `new Date()` itself.
 */
describe('the deadline has three states, not two', () => {
  const deadline = new Date('2026-09-30T23:59:59+05:30');
  const at = (iso: string) => ({ now: new Date(iso), deadline, hasV1: false, warnDays: 21 });

  it('is clear well before the window opens', () => {
    expect(contractDeadlineState(at('2026-09-01T00:00:00Z'))).toBe('clear');
  });

  it('warns inside the window', () => {
    expect(contractDeadlineState(at('2026-09-16T00:00:00Z'))).toBe('warn');
  });

  it('is overdue after the deadline', () => {
    expect(contractDeadlineState(at('2026-10-01T00:00:00Z'))).toBe('overdue');
  });

  it('opens the window exactly 21 days out, tested from BOTH sides', () => {
    // A boundary tested from one side is a boundary that has not been tested -- the rule this
    // repo's own `dayMonthIn` midnight test is written to.
    expect(contractDeadlineState(at('2026-09-09T18:29:58Z'))).toBe('clear');
    expect(contractDeadlineState(at('2026-09-09T18:30:00Z'))).toBe('warn');
  });

  it('fires exactly at the deadline, tested from BOTH sides', () => {
    expect(contractDeadlineState(at('2026-09-30T18:29:59Z'))).toBe('warn');
    expect(contractDeadlineState(at('2026-09-30T18:30:00Z'))).toBe('overdue');
  });

  it('is clear at every date once TranscriptV1 exists, which is the way OUT', () => {
    // The positive control. Without it, a function that returned 'overdue' unconditionally
    // would satisfy the overdue assertion above.
    for (const iso of ['2026-09-01T00:00:00Z', '2026-09-16T00:00:00Z', '2027-01-01T00:00:00Z']) {
      expect(contractDeadlineState({ ...at(iso), hasV1: true })).toBe('clear');
    }
  });
});
