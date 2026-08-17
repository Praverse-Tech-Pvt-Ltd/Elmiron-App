import { describe, expect, it } from 'vitest';
import { SyncRejectionCodeSchema } from '@fieldforce/core';
import { presentRejection } from './explanation';
import type { RejectionRecord } from './reducer';

const record = (over: Partial<RejectionRecord> = {}): RejectionRecord => ({
  code: 'outside_shift_window',
  explanation: 'This visit was recorded outside your territory working hours.',
  attemptsRemaining: 2,
  deadLettered: false,
  receivedAt: '2026-08-14T10:00:00.000Z',
  ...over,
});

describe('presentRejection', () => {
  it("passes the server's sentence through unchanged", () => {
    // Backend's rejection sentences are tested server-side and rewording one breaks
    // a build deliberately. This asserts the client is a pipe, not an author.
    const sentence = 'This visit was recorded outside your territory working hours.';
    expect(presentRejection(record({ explanation: sentence })).explanation).toBe(sentence);
  });

  it('does not invent prose when the server sent no sentence', () => {
    const presented = presentRejection(record({ explanation: null }));
    expect(presented.explanation).toBeNull();
    // The fallback says the app does not have the reason — which is true — rather
    // than guessing at one, which might name the wrong cause.
    expect(presented.fallback).toMatch(/without a reason the app can show/);
    expect(presented.fallback).not.toMatch(/shift|geofence|territory|hours|location/iu);
  });

  it('offers no fallback when there is a real sentence to show', () => {
    expect(presentRejection(record()).fallback).toBeNull();
  });

  it('handles every code in the contract, so a new one cannot fall through', () => {
    // If Backend adds a rejection code, this fails rather than silently rendering
    // an undefined action for it.
    for (const code of SyncRejectionCodeSchema.options) {
      const presented = presentRejection(record({ code }));
      expect(presented.code).toBe(code);
      expect(['retry', 'escalate']).toContain(presented.action);
    }
  });

  it.each(['outside_shift_window', 'missing_reference', 'internal_error'] as const)(
    'offers a retry for %s, whose cause can change without the MR doing anything',
    (code) => {
      expect(presentRejection(record({ code })).action).toBe('retry');
    },
  );

  it.each(['outside_geofence', 'not_your_record', 'validation_failed', 'malformed_item'] as const)(
    'sends %s to a person rather than looping on a retry that cannot work',
    (code) => {
      expect(presentRejection(record({ code })).action).toBe('escalate');
    },
  );

  it('escalates a dead letter even when the code would otherwise be retryable', () => {
    // Attempts are exhausted. Offering a retry would be offering a button that
    // cannot do anything, which is worse than offering none.
    const presented = presentRejection(
      record({ code: 'outside_shift_window', deadLettered: true, attemptsRemaining: 0 }),
    );
    expect(presented.action).toBe('escalate');
    expect(presented.deadLettered).toBe(true);
  });
});
