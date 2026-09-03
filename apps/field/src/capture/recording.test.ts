import { describe, expect, it } from 'vitest';
import { ConsentRecordSchema, CreateRecordingRequestSchema } from '@fieldforce/core';
import type { ConsentRecord } from '@fieldforce/core';
import {
  authorisingConsent,
  blockReason,
  elapsedLabel,
  recordingBlock,
  recordingLabel,
  recordingRequest,
  voiceNoteRequest,
} from './recording';

const uuid = (suffix: string): string => `88888888-8888-4888-8888-8888888888${suffix}`;

const consent = (over: Record<string, unknown> = {}): ConsentRecord =>
  ConsentRecordSchema.parse({
    id: uuid('01'),
    visitId: uuid('11'),
    doctorId: uuid('22'),
    capturedByMrId: uuid('33'),
    outcome: 'consented',
    notAskedReason: null,
    consentTextVersionId: uuid('44'),
    displayedLanguage: 'en-IN',
    supersedesConsentRecordId: null,
    isWithdrawal: false,
    capturedAt: '2026-08-14T11:58:00+05:30',
    receivedAt: '2026-08-14T11:58:01+05:30',
    createdAt: '2026-08-14T11:58:01+05:30',
    ...over,
  });

/**
 * The most consequential gate in the product: whether a microphone may open in a
 * room with a doctor in it. The server checks the same thing and that is the check
 * that counts — but a recording made and then rejected is a recording that existed
 * on a phone in that room, and deleting it afterwards does not undo that.
 */
describe('a consultation may be recorded only when a doctor said yes', () => {
  it('allows it after a consent', () => {
    expect(recordingBlock([consent()], true)).toBeNull();
  });

  it('refuses when the question was never put', () => {
    expect(recordingBlock([], true)).toEqual({ kind: 'never_asked' });
  });

  it('refuses a decline', () => {
    expect(recordingBlock([consent({ outcome: 'declined' })], true)).toEqual({ kind: 'refused' });
  });

  it('refuses `not_asked`, which is not a yes', () => {
    expect(
      recordingBlock([consent({ outcome: 'not_asked', notAskedReason: 'No time.' })], true),
    ).toEqual({ kind: 'refused' });
  });

  it('refuses once consent is withdrawn, whatever order the rows arrive in', () => {
    // The ledger is append-only: a withdrawal is a NEW row that supersedes. Reading
    // the earliest row would let a withdrawn consent authorise a recording.
    const withdrawal = consent({
      id: uuid('02'),
      isWithdrawal: true,
      outcome: 'declined',
      supersedesConsentRecordId: uuid('01'),
      capturedAt: '2026-08-14T12:20:00+05:30',
    });
    expect(recordingBlock([consent(), withdrawal], true)).toEqual({ kind: 'refused' });
    expect(recordingBlock([withdrawal, consent()], true)).toEqual({ kind: 'refused' });
  });

  it('refuses without the microphone, whatever the doctor said', () => {
    expect(recordingBlock([consent()], false)).toEqual({ kind: 'no_microphone' });
  });

  it('returns the record that authorises it, and null when none does', () => {
    expect(authorisingConsent([consent()])?.id).toBe(uuid('01'));
    expect(authorisingConsent([consent({ outcome: 'declined' })])).toBeNull();
    expect(authorisingConsent([])).toBeNull();
  });
});

describe('what the MR is told', () => {
  it('sends them to ask, when nobody has been asked', () => {
    expect(blockReason({ kind: 'never_asked' })).toMatch(/Ask the doctor first/u);
  });

  it('closes the subject when the doctor said no', () => {
    // No nudge, no retry path, no "are you sure". A decline is the end of it.
    const reason = blockReason({ kind: 'refused' });
    expect(reason).toMatch(/that is the end of it/u);
    expect(reason).not.toMatch(/try again|ask again|retry/iu);
  });

  it('names the remedy for a missing microphone', () => {
    expect(blockReason({ kind: 'no_microphone' })).toMatch(/Settings/u);
  });

  it('puts the agreement time beside the fact of recording, with no gendered pronoun', () => {
    const label = recordingLabel('11:58');
    expect(label).toBe('Recording · agreed at 11:58');
    expect(label).not.toMatch(/\b(he|she|his|her)\b/iu);
  });
});

describe('the requests', () => {
  it('carries the authorising consent id, which the server rejects without', () => {
    const request = recordingRequest({
      id: uuid('55'),
      visitId: uuid('11'),
      consentRecordId: uuid('01'),
      durationSeconds: 251,
      bitrateKbps: 128,
      sizeBytes: 4_016_000,
      recordedAt: '2026-08-14T11:58:00+05:30',
    });
    expect(() => CreateRecordingRequestSchema.parse(request)).not.toThrow();
    expect(request.consentRecordId).toBe(uuid('01'));
  });

  it('gives a voice note no consent record at all', () => {
    // Not an omission. A voice note is the MR dictating to themselves; requiring a
    // doctor's consent would make them a subject of their own notes.
    const request = voiceNoteRequest({
      id: uuid('66'),
      visitId: uuid('11'),
      durationSeconds: 23,
      sizeBytes: 368_000,
      recordedAt: '2026-08-14T12:10:00+05:30',
    });
    expect(Object.keys(request)).not.toContain('consentRecordId');
  });
});

describe('elapsed time', () => {
  it.each([
    [0, '00:00'],
    [23, '00:23'],
    [161, '02:41'],
    [3_601, '60:01'],
  ])('renders %i seconds as %s', (seconds, expected) => {
    expect(elapsedLabel(seconds)).toBe(expected);
  });

  it('never renders a negative clock', () => {
    expect(elapsedLabel(-5)).toBe('00:00');
  });
});
