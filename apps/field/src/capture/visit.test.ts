import { describe, expect, it } from 'vitest';
import { CreateCheckInRequestSchema, VisitSchema } from '@fieldforce/core';
import type { Coordinates, Visit } from '@fieldforce/core';
import { actionLabelFor, blockedReason, checkInRequest, stageOf, witnessedStage } from './visit';

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

describe('MR-26 B2: witnessedStage — facts the client saw itself record', () => {
  const visit = (status: Visit['status']): Visit =>
    ({
      id: '55555555-5555-4555-8555-555555555501',
      mrId: 'm',
      doctorId: 'd',
      beatPlanId: null,
      clinicAddressId: null,
      status,
      scheduledFor: null,
      startedAt: null,
      completedAt: null,
      notMetReason: null,
      receivedAt: '2026-09-11T00:00:00.000Z',
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
    }) satisfies Visit;

  const q = (entity: string, entityId: string): { entity: string; entityId: string } => ({
    entity,
    entityId,
  });
  const V = '55555555-5555-4555-8555-555555555501';

  it('a QUEUED check-in makes the visit `during`, and says it is pending', () => {
    // The defect this exists for. Offline, `record_check_in` never runs, `visit.status` stays
    // `planned`, and before this the screen offered nothing but check-in for the whole visit.
    const result = witnessedStage(visit('planned'), [q('check_in', V)]);
    expect(result.stage).toBe('during');
    expect(result.pending, 'the server has not confirmed this and the copy must say so').toBe(true);
  });

  it('a QUEUED check-out makes it `after`, pending', () => {
    const result = witnessedStage(visit('planned'), [q('check_in', V), q('check_out', V)]);
    expect(result.stage).toBe('after');
    expect(result.pending).toBe(true);
  });

  it('check-out WINS over check-in when both are queued', () => {
    // A departure is the later fact. Offering check-out again to an MR who has already taken
    // it is how a visit gets two departures.
    expect(witnessedStage(visit('planned'), [q('check_out', V), q('check_in', V)]).stage).toBe(
      'after',
    );
  });

  it('THE POSITIVE CONTROL: a SERVER-confirmed stage is never marked pending', () => {
    // Without this, "always pending" would satisfy every case above and put a pending marker
    // on every screen in the product, including ones the server has fully confirmed. That is
    // the inverse lie and it would be believed just as readily.
    const confirmed = witnessedStage(visit('in_progress'), []);
    expect(confirmed.stage).toBe('during');
    expect(confirmed.pending).toBe(false);
  });

  it('a queued row for ANOTHER visit changes nothing — the scoping control', () => {
    // `entityId` on a capture queue item is the VISIT id. A test that queued an item without
    // varying the visit could not tell "this visit's check-in" from "any check-in", and one
    // MR's queue holds many.
    const other = witnessedStage(visit('planned'), [
      q('check_in', '66666666-6666-4666-8666-666666666602'),
    ]);
    expect(other.stage).toBe('before');
    expect(other.pending).toBe(false);
  });

  it('does not re-open a visit the SERVER has already closed', () => {
    // Once the server says `completed`, a stale queued check-in must not drag it back to
    // `during`. That would be the client overruling the server rather than anticipating it,
    // which is the line this whole change is careful not to cross.
    const closed = witnessedStage(visit('completed'), [q('check_in', V)]);
    expect(closed.stage).toBe('after');
    expect(closed.pending).toBe(false);
  });

  it('agrees with stageOf whenever the queue is empty', () => {
    // The compatibility control: with nothing queued this must be exactly the old behaviour,
    // for every status, or the change has moved something it did not mean to.
    for (const status of ['planned', 'in_progress', 'completed', 'not_met', 'cancelled'] as const) {
      expect(witnessedStage(visit(status), []).stage).toBe(stageOf(visit(status)));
    }
  });
});
