import { describe, expect, it, vi } from 'vitest';
import { availabilityFrom, recordingAvailability } from './recording-permission';
import type { RecordingPermission } from '@fieldforce/core';

/**
 * MR-53 B1/B3 — the screen renders the server's answer, and nothing else.
 *
 * Every path that is not an explicit yes must draw no control. These cases exist because the
 * failure mode is silent and expensive: a control drawn on a wrong assumption is a doctor recorded
 * without a standing consent.
 */
const answer = (over: Partial<RecordingPermission> = {}): RecordingPermission => ({
  allowed: false,
  reason: 'never_asked',
  featureEnabled: true,
  consentRecordId: null,
  consentCapturedAt: null,
  ...over,
});

describe('MR-53 B1 — the server’s answer becomes what the screen does', () => {
  it('allowed, with the consent row and the time the doctor agreed', () => {
    const result = availabilityFrom(
      answer({
        allowed: true,
        reason: 'allowed',
        consentRecordId: '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a01',
        consentCapturedAt: '2026-09-23T06:00:00.000Z',
      }),
    );
    expect(result).toEqual({
      kind: 'allowed',
      consentRecordId: '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a01',
      consentCapturedAt: '2026-09-23T06:00:00.000Z',
    });
  });

  it('allowed with no consent row is NOT allowed — the yes must name its authority', () => {
    expect(availabilityFrom(answer({ allowed: true, reason: 'allowed' })).kind).not.toBe('allowed');
  });

  it('B3: each "no" gets its own sentence, and they are different sentences', () => {
    const sentences = (['never_asked', 'declined', 'withdrawn', 'quarantined'] as const).map(
      (reason) => {
        const result = availabilityFrom(answer({ reason }));
        expect(result.kind, reason).toBe('blocked');
        expect(result.kind === 'blocked' ? result.why : null, reason).toBe(reason);
        return result.kind === 'blocked' ? result.sentence : '';
      },
    );
    expect(new Set(sentences).size).toBe(4);
    expect(sentences[0]).toMatch(/ask the doctor first/iu);
    expect(sentences[1]).toMatch(/said no/iu);
    // A withdrawal is not a refusal, and saying "they said no" of somebody who agreed first is
    // false in the one direction that matters.
    expect(sentences[2]).toMatch(/changed their mind/iu);
    expect(sentences[2]).not.toMatch(/said no/iu);
  });

  it('feature_off and not_your_visit say NOTHING about the doctor', () => {
    for (const reason of ['feature_off', 'not_your_visit'] as const) {
      expect(availabilityFrom(answer({ reason })), reason).toEqual({ kind: 'off' });
    }
  });
});

describe('MR-53 B2 — a build that may not record does not even ask', () => {
  it('answers off without calling the server, because the flag is off in this build', async () => {
    const rpc = vi.fn();
    // `appConfig.recordingEnabled` is false under the test environment, which is the shipping
    // state: C3 stands until the named PV/DPDP signatory exists.
    expect(await recordingAvailability('0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f01', { rpc })).toEqual({
      kind: 'off',
    });
    expect(rpc, 'a disabled build must leave no trace of asking').not.toHaveBeenCalled();
  });
});
