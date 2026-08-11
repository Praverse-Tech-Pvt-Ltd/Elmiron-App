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
  'no `TranscriptV1Schema` is exported from @elmiron/core/field.',
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
    const expired = new Date() > CONTRACT_I3_DEADLINE;

    // Written as a single assertion carrying the whole message, because a bare
    // `expect(false).toBe(true)` tells whoever hits this nothing about why.
    expect(hasV1 || !expired, OWNER).toBe(true);
  });

  it('still exports the placeholder it is guarding, so this cannot pass vacuously', () => {
    // If TranscriptV0 were renamed or removed, the test above would keep passing
    // while guarding nothing at all.
    expect('TranscriptV0Schema' in field).toBe(true);
  });

  it('names a deadline that is a real date', () => {
    expect(Number.isNaN(CONTRACT_I3_DEADLINE.getTime())).toBe(false);
  });
});
