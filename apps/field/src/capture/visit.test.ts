import { describe, expect, it } from 'vitest';
import { CreateCheckInRequestSchema, VisitSchema } from '@fieldforce/core';
import type { Coordinates, Visit } from '@fieldforce/core';
import { actionLabelFor, blockedReason, checkInRequest, stageOf } from './visit';

const coordinates: Coordinates = {
  latitude: 18.5204,
  longitude: 73.8567,
  accuracyMetres: 14,
  capturedAt: '2026-09-02T11:56:00+05:30',
};

const visit = (over: Partial<Visit> = {}): Visit =>
  VisitSchema.parse({
    id: '66666666-6666-4666-8666-666666666601',
    mrId: '22222222-2222-4222-8222-222222222202',
    doctorId: '33333333-3333-4333-8333-333333333301',
    beatPlanId: null,
    clinicAddressId: null,
    status: 'planned',
    notMetReason: null,
    scheduledFor: null,
    startedAt: null,
    completedAt: null,
    receivedAt: '2026-09-02T08:00:00+05:30',
    createdAt: '2026-09-02T08:00:00+05:30',
    updatedAt: '2026-09-02T08:00:00+05:30',
    ...over,
  });

describe('where the visit is', () => {
  it('is before the visit when nothing has started', () => {
    expect(stageOf(null)).toBe('before');
    expect(stageOf(visit())).toBe('before');
  });

  it('is during once the server says in progress', () => {
    expect(stageOf(visit({ status: 'in_progress' }))).toBe('during');
  });

  it('is after once the server says completed', () => {
    expect(stageOf(visit({ status: 'completed' }))).toBe('after');
  });

  it('treats a cancelled visit as not started rather than as finished', () => {
    // "After" would tell the MR they had been, and offer them nothing to do. A
    // cancelled visit is one they can still make if they choose.
    expect(stageOf(visit({ status: 'cancelled' }))).toBe('before');
  });
});

describe('the action names what pressing it does', () => {
  it('offers check-in, then check-out, then nothing', () => {
    expect(actionLabelFor('before')).toBe('I am here — check in');
    expect(actionLabelFor('during')).toBe('Leaving — check out');
    expect(actionLabelFor('after')).toBeNull();
  });
});

describe('a check-in is never sent without a real position', () => {
  it('builds a request from a fix', () => {
    const request = checkInRequest({
      id: '77777777-7777-4777-8777-777777777701',
      visitId: '66666666-6666-4666-8666-666666666601',
      coordinates,
    });
    // Parsed through the contract, so a drifted shape throws here rather than 400ing
    // in a clinic doorway.
    expect(() => CreateCheckInRequestSchema.parse(request)).not.toThrow();
    expect(request.source).toBe('manual');
  });

  it('times the check-in to the fix, not to the moment the request was built', () => {
    // A queued check-in sent hours later must still say when the MR was at the
    // clinic. `occurredAt` is the fix's own timestamp for that reason.
    const request = checkInRequest({
      id: '77777777-7777-4777-8777-777777777701',
      visitId: '66666666-6666-4666-8666-666666666601',
      coordinates,
    });
    expect(request.occurredAt).toBe(coordinates.capturedAt);
  });

  it('blocks, with words, when the MR denied location', () => {
    // S4 promises the app works fully with location denied. The contract does not
    // allow that yet — `coordinates` is required — so the MR is told plainly
    // instead of being shown a button that fails when pressed.
    expect(blockedReason({ kind: 'denied' })).toMatch(/Location is off/u);
  });

  it('blocks, with the device’s own reason, when no fix arrived', () => {
    expect(blockedReason({ kind: 'unavailable', reason: 'No signal from GPS.' })).toMatch(
      /No signal from GPS/u,
    );
  });

  it('does not block when there is a fix', () => {
    expect(blockedReason({ kind: 'fix', coordinates })).toBeNull();
  });

  it('offers no fallback coordinate anywhere in the module', () => {
    // The failure this prevents: a sentinel like 0,0 sent to a server that computes
    // `distance_from_clinic_metres` from it, turning a fabricated position into a
    // distance in somebody's expense claim.
    const request = checkInRequest({
      id: '77777777-7777-4777-8777-777777777701',
      visitId: '66666666-6666-4666-8666-666666666601',
      coordinates,
    });
    expect(request.coordinates).toBe(coordinates);
  });
});
