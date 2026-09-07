import { describe, expect, it } from 'vitest';
import { recordCheckIn } from './check-in';
import type { RpcCaller } from './client';

/**
 * FE-W15 and the error contract, on the client side.
 *
 * The round trip against a real database lives in `services/api/tests/write-path.spec.ts`
 * — this file covers what the app does with what comes back, which is the half a database
 * test cannot reach.
 */

const ROW = {
  id: '22222222-2222-4222-8222-222222222222',
  visit_id: '11111111-1111-4111-8111-111111111111',
  mr_id: '33333333-3333-4333-8333-333333333333',
  latitude: 18.52,
  longitude: 73.85,
  accuracy_metres: null,
  geofence_status: 'unavailable',
  distance_from_clinic_metres: null,
  source: 'automatic',
  occurred_at: '2026-09-07T12:00:00+05:30',
  received_at: '2026-09-07T17:12:39+05:30',
  created_at: '2026-09-07T17:12:39+05:30',
  // The server sends this and the contract has no field for it. It must not throw.
  shift_window_source: 'territory',
};

const REQUEST = {
  id: '22222222-2222-4222-8222-222222222222',
  visitId: '11111111-1111-4111-8111-111111111111',
  coordinates: {
    latitude: 18.52,
    longitude: 73.85,
    accuracyMetres: null,
    capturedAt: '2026-09-07T12:00:00+05:30',
  },
  occurredAt: '2026-09-07T12:00:00+05:30',
  source: 'automatic' as const,
};

const caller = (result: {
  data?: unknown;
  error?: { code?: string | null; message: string } | null;
}): RpcCaller => ({
  rpc: () => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }),
});

describe('recordCheckIn', () => {
  it('maps the server row into the contract entity', async () => {
    const outcome = await recordCheckIn(REQUEST, caller({ data: ROW }));
    expect(outcome.kind).toBe('recorded');
    if (outcome.kind !== 'recorded') return;
    expect(outcome.checkIn.id).toBe(ROW.id);
    expect(outcome.checkIn.visitId).toBe(ROW.visit_id);
    // snake_case latitude/longitude become the contract's nested coordinates.
    expect(outcome.checkIn.coordinates.latitude).toBe(18.52);
    expect(outcome.checkIn.coordinates.longitude).toBe(73.85);
  });

  it('keeps the server clock and the device clock apart', async () => {
    // `occurredAt` is what the handset claimed; `receivedAt` is when the server took
    // delivery. Collapsing them would destroy the only evidence of a late sync.
    const outcome = await recordCheckIn(REQUEST, caller({ data: ROW }));
    if (outcome.kind !== 'recorded') throw new Error('expected a recorded check-in');
    expect(outcome.checkIn.occurredAt).not.toBe(outcome.checkIn.receivedAt);
  });

  it('throws on a row that does not match the contract, rather than passing it on', async () => {
    const missingLatitude = Object.fromEntries(
      Object.entries(ROW).filter(([key]) => key !== 'latitude'),
    );
    await expect(recordCheckIn(REQUEST, caller({ data: missingLatitude }))).rejects.toThrow();
  });
});

describe('a refusal reaches the MR as a refusal', () => {
  it.each([
    ['45003', 'outside_shift_window', true],
    ['45002', 'shift_window_not_configured', false],
    ['45001', 'consent_notice_superseded', true],
    ['42501', 'not_permitted', false],
    ['28000', 'not_authenticated', true],
    ['23001', 'append_only', false],
  ])('maps SQLSTATE %s to %s', async (sqlState, code, actionable) => {
    const outcome = await recordCheckIn(
      REQUEST,
      caller({ error: { code: sqlState, message: 'whatever the server said' } }),
    );
    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') return;
    expect(outcome.refusal.code).toBe(code);
    expect(outcome.refusal.actionable).toBe(actionable);
  });

  it('does not guess at a SQLSTATE it does not know', async () => {
    // The rule that matters most here. A wrong explanation sends the MR to do the wrong
    // thing and they have no way to tell it was wrong; "the app does not recognise this"
    // is worse copy and better behaviour.
    const outcome = await recordCheckIn(
      REQUEST,
      caller({ error: { code: 'XX999', message: 'something nobody has mapped' } }),
    );
    if (outcome.kind !== 'refused') throw new Error('expected a refusal');
    expect(outcome.refusal.code).toBe('unrecognised');
    expect(outcome.refusal.sqlState).toBe('XX999');
    expect(outcome.refusal.actionable).toBe(false);
  });

  it('treats a missing SQLSTATE as unrecognised too', async () => {
    const outcome = await recordCheckIn(REQUEST, caller({ error: { message: 'no code at all' } }));
    if (outcome.kind !== 'refused') throw new Error('expected a refusal');
    expect(outcome.refusal.code).toBe('unrecognised');
  });

  it('asserts on the code and never on the message', async () => {
    // The English is not the contract. Two different messages, same code, same meaning.
    const first = await recordCheckIn(
      REQUEST,
      caller({ error: { code: '45003', message: 'one wording' } }),
    );
    const second = await recordCheckIn(
      REQUEST,
      caller({ error: { code: '45003', message: 'a completely different wording' } }),
    );
    if (first.kind !== 'refused' || second.kind !== 'refused') throw new Error('expected refusals');
    expect(first.refusal.code).toBe(second.refusal.code);
  });
});
