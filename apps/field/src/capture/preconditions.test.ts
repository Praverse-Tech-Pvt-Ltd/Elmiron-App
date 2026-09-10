import { describe, expect, it } from 'vitest';
import { DOCTOR_NOT_AVAILABLE, VISIT_NOT_AVAILABLE, unavailableReason } from './preconditions';

/**
 * MR-20 B3 — the tap must produce something.
 *
 * **This test is the only thing that will hold the behaviour.** MR-20 Part C converts the
 * three gating reads to the pulled store, after which `visit === null` stops happening in
 * the common case. The silent return was fixed FIRST precisely so that this exists before
 * the defect becomes unreachable by accident — the next unmet precondition (a visit
 * reassigned mid-session, a store not yet hydrated on a cold start) would otherwise swallow
 * the tap again with nothing to notice.
 */

describe('a sustained unmet precondition always has something to say', () => {
  it('names the missing VISIT rather than returning nothing', () => {
    expect(unavailableReason(null, { id: 'd' })).toBe(VISIT_NOT_AVAILABLE);
  });

  it('names the missing DOCTOR separately, because the remedy differs', () => {
    // A doctor and their visit are independent rows in one cursor-ordered stream, so a
    // visit can legitimately arrive first. That resolves on its own; a missing visit may
    // not.
    expect(unavailableReason({ id: 'v' }, null)).toBe(DOCTOR_NOT_AVAILABLE);
  });

  it('reports the VISIT first when both are missing', () => {
    // With no visit the doctor is not merely unsynced but unknown, so "give it a moment"
    // would be advice that cannot work.
    expect(unavailableReason(null, null)).toBe(VISIT_NOT_AVAILABLE);
  });

  it('is SILENT when both are present — the positive control', () => {
    // Without this, "always return a message" would satisfy every case above while putting
    // a permanent error on a screen that is working. A guard that fires on correct states
    // gets deleted, and its removal takes the real coverage with it.
    expect(unavailableReason({ id: 'v' }, { id: 'd' })).toBeNull();
  });
});

describe('what the messages may and may not claim', () => {
  it('never says the visit was DELETED', () => {
    // ADR §6 Q2. A record that moved territory has not been deleted, and for a consent
    // record saying so would be dangerously false. The app cannot tell "not synced yet"
    // from "no longer yours", so it names both and asserts neither.
    for (const message of [VISIT_NOT_AVAILABLE, DOCTOR_NOT_AVAILABLE]) {
      expect(`${message.title} ${message.detail}`).not.toMatch(/deleted|removed/i);
    }
  });

  it('offers the MR something to DO, not just a statement of fact', () => {
    // "This visit is not on your phone" alone leaves them holding a phone that will not
    // work, in front of a doctor. Each message names a next step.
    expect(VISIT_NOT_AVAILABLE.detail).toMatch(/sync|ask your manager/i);
    expect(DOCTOR_NOT_AVAILABLE.detail).toMatch(/try again|moment/i);
  });

  it('does not invent a server-sourced reason', () => {
    // The client knows the row is not in its store. It does not know WHY, and
    // `explanation.ts` exists because guessing at a refusal sends the MR to do the wrong
    // thing with no way to tell. These say what is actually known.
    expect(VISIT_NOT_AVAILABLE.detail).toMatch(
      /may still be syncing, or it may no longer be yours/i,
    );
  });
});
